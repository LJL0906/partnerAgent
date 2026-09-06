import type { ReasoningLevel, SubmitTextInputCommandResult } from '@partner-agent/contracts';
import * as Crypto from 'expo-crypto';
import type { MutableRefObject } from 'react';

import {
  SubscriptionRejectedError,
  type AgentStreamConnection,
} from '@/api/agent-stream';
import {
  submitTextInput,
  type SubmitTextInputParams,
} from '@/api/chat-api';
import { submissionUnknownNoticeId, useChatStore } from '@/store/chat-store';

import { rememberSession } from './session-management';
import { desiredChannels, PENDING_CHAT_TASK_ID } from './chat-event-routing';

export interface PendingChatSubmission {
  inputId: string;
  operationId: string;
  optimisticMessageId: string;
  sessionId: string;
  text: string;
}

type ChatSubmissionParams = Omit<SubmitTextInputParams, 'sessionId'> & { sessionId?: string };

interface SendChatMessageContext {
  assistantMessageIdRef: MutableRefObject<string | undefined>;
  currentTaskIdRef: MutableRefObject<string | undefined>;
  pendingSubmissionRef: MutableRefObject<PendingChatSubmission | undefined>;
  previousTaskIdRef: MutableRefObject<string | undefined>;
  reconcileFromRest: (taskId: string | undefined, sessionId: string) => Promise<void>;
  reportError: (error: unknown, fallback: string) => void;
  streamReadyRef: MutableRefObject<Promise<AgentStreamConnection> | undefined>;
  modelConfigId: string;
  reasoningLevel: ReasoningLevel;
  submit?: (params: ChatSubmissionParams) => Promise<SubmitTextInputCommandResult>;
}

export async function sendChatMessage(
  rawMessage: string,
  context: SendChatMessageContext,
): Promise<boolean> {
  const message = rawMessage.trim();
  if (!message) return false;
  const stateBefore = useChatStore.getState();
  if (!stateBefore.sessionId || stateBefore.isStreaming) return false;

  const isCurrent = () => useChatStore.getState().sessionRevision === stateBefore.sessionRevision;
  let connection: AgentStreamConnection;
  let serverRejected = false;
  try {
    const opening = context.streamReadyRef.current;
    if (!opening) throw new Error('实时连接尚未初始化，请稍后重试。');
    connection = await opening;
  } catch (error) {
    if (isCurrent()) context.reportError(error, '实时连接尚未就绪。');
    return false;
  }

  const state = useChatStore.getState();
  if (!isCurrent() || state.isStreaming) return false;
  const attempt = getOrCreateSubmission(
    context.pendingSubmissionRef.current,
    message,
    state.sessionId,
  );
  context.pendingSubmissionRef.current = attempt;
  context.previousTaskIdRef.current = context.currentTaskIdRef.current;
  context.currentTaskIdRef.current = PENDING_CHAT_TASK_ID;
  state.beginTask();
  state.addMessage({ id: attempt.optimisticMessageId, role: 'user', content: message, createdAt: new Date().toISOString() });
  context.assistantMessageIdRef.current = undefined;

  try {
    const submit = context.submit ?? (submitTextInput as (params: ChatSubmissionParams) => Promise<SubmitTextInputCommandResult>);
    const result = await submit({
      text: message,
      ...(state.sessionPersisted ? { sessionId: state.sessionId } : {}),
      inputId: attempt.inputId,
      operationId: attempt.operationId,
      modelConfigId: context.modelConfigId,
      reasoningLevel: context.reasoningLevel,
      outputMode: 'chat',
    });
    if (!isCurrent()) return false;
    if (result.status === 'rejected') {
      serverRejected = true;
      throw new Error(result.validation_errors?.[0]?.message ?? '消息提交被拒绝。');
    }
    const acceptedSessionId = result.data.session_id;
    const taskId = result.data.chat_task.task_id;
    const stableMessageId = result.data.message_ref.id;
    state.bindOptimisticMessageId(attempt.optimisticMessageId, stableMessageId);
    state.clearSubmissionNotice(attempt.operationId);
    if (acceptedSessionId !== state.sessionId) state.setSessionId(acceptedSessionId);
    state.setSessionPersisted(true);
    rememberSession(acceptedSessionId);
    context.currentTaskIdRef.current = taskId;
    context.previousTaskIdRef.current = undefined;
    state.setActiveOperationId(result.operation_id);
    state.setActiveTaskId(taskId);

    try {
      await connection.setChannels(
        desiredChannels(acceptedSessionId, taskId, result.operation_id),
      );
    } catch (error) {
      if (!isCurrent()) return false;
      if (!(error instanceof SubscriptionRejectedError)) {
        context.reportError(error, '任务实时频道订阅失败。');
      }
      await context.reconcileFromRest(taskId, acceptedSessionId);
    }
    if (!isCurrent()) return false;
    context.pendingSubmissionRef.current = undefined;
    return true;
  } catch (error) {
    if (!isCurrent()) return false;
    state.setThinking(false);
    if (serverRejected) {
      state.clearSubmissionNotice(attempt.operationId);
      state.setStreaming(false);
      context.currentTaskIdRef.current = undefined;
      context.previousTaskIdRef.current = undefined;
      context.pendingSubmissionRef.current = undefined;
      state.setTaskStatus('idle');
    } else {
      // The server may already have accepted the operation. Keep the stable
      // input/operation ids and pending route so a late WS event or retry can recover it.
      state.setTaskStatus('recovering');
      state.setStreaming(true);
      await context.reconcileFromRest(undefined, state.sessionId).catch(() => undefined);
      if (!isCurrent()) return false;
      const recovered = useChatStore.getState();
      const authoritativeUserItem = recovered.items.find((item) =>
        item.type === 'message' && item.payload.role === 'user'
        && item.operation_id === attempt.operationId && item.revision > 0);
      if (authoritativeUserItem?.type === 'message' && authoritativeUserItem.message_id) {
        recovered.bindOptimisticMessageId(attempt.optimisticMessageId, authoritativeUserItem.message_id);
        context.pendingSubmissionRef.current = undefined;
        context.currentTaskIdRef.current = recovered.activeTaskId;
        context.previousTaskIdRef.current = undefined;
      }
      if (recovered.taskStatus === 'recovering' && !recovered.activeTaskId) {
        recovered.setStreaming(false);
      }
    }
    const latest = useChatStore.getState();
    const resultConverged = latest.taskStatus !== 'recovering'
      || latest.items.some((item) => item.type === 'message' && item.payload.role === 'user'
        && item.operation_id === attempt.operationId && item.revision > 0);
    if (serverRejected || !resultConverged) {
      latest.addMessage({
        id: serverRejected ? Crypto.randomUUID() : submissionUnknownNoticeId(attempt.operationId),
        role: 'system',
        content: serverRejected && error instanceof Error
          ? error.message
          : '消息提交结果尚未确认；可稍后重试，系统会沿用同一请求标识。',
      });
    }
    return false;
  }
}

function getOrCreateSubmission(
  pending: PendingChatSubmission | undefined,
  text: string,
  sessionId: string,
): PendingChatSubmission {
  if (pending?.text === text && pending.sessionId === sessionId) return pending;
  return {
    inputId: Crypto.randomUUID(),
    operationId: Crypto.randomUUID(),
    optimisticMessageId: Crypto.randomUUID(),
    sessionId,
    text,
  };
}
