import type { CommandResult, SubmitTextInputResult } from '@partner-agent/contracts';
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
import { useChatStore } from '@/store/chat-store';

import { desiredChannels, PENDING_CHAT_TASK_ID } from './chat-event-routing';

export interface PendingChatSubmission {
  inputId: string;
  operationId: string;
  optimisticMessageId: string;
  sessionId: string;
  text: string;
}

interface SendChatMessageContext {
  assistantMessageIdRef: MutableRefObject<string | undefined>;
  currentTaskIdRef: MutableRefObject<string | undefined>;
  pendingSubmissionRef: MutableRefObject<PendingChatSubmission | undefined>;
  previousTaskIdRef: MutableRefObject<string | undefined>;
  reconcileFromRest: (taskId: string, sessionId: string) => Promise<void>;
  reportError: (error: unknown, fallback: string) => void;
  streamReadyRef: MutableRefObject<Promise<AgentStreamConnection> | undefined>;
  submit?: (
    params: SubmitTextInputParams,
  ) => Promise<CommandResult<SubmitTextInputResult>>;
}

export async function sendChatMessage(
  rawMessage: string,
  context: SendChatMessageContext,
): Promise<boolean> {
  const message = rawMessage.trim();
  if (!message) return false;
  const stateBefore = useChatStore.getState();
  if (!stateBefore.sessionId || stateBefore.isStreaming) return false;

  let connection: AgentStreamConnection;
  try {
    const opening = context.streamReadyRef.current;
    if (!opening) throw new Error('实时连接尚未初始化，请稍后重试。');
    connection = await opening;
  } catch (error) {
    context.reportError(error, '实时连接尚未就绪。');
    return false;
  }

  const state = useChatStore.getState();
  if (state.isStreaming) return false;
  const attempt = getOrCreateSubmission(
    context.pendingSubmissionRef.current,
    message,
    state.sessionId,
  );
  context.pendingSubmissionRef.current = attempt;
  context.previousTaskIdRef.current = context.currentTaskIdRef.current;
  context.currentTaskIdRef.current = PENDING_CHAT_TASK_ID;
  state.beginTask();
  state.addMessage({ id: attempt.optimisticMessageId, role: 'user', content: message });
  context.assistantMessageIdRef.current = undefined;

  try {
    const result = await (context.submit ?? submitTextInput)({
      text: message,
      sessionId: state.sessionId,
      inputId: attempt.inputId,
      operationId: attempt.operationId,
    });
    if (result.status === 'rejected') {
      throw new Error(result.validation_errors?.[0]?.message ?? '消息提交被拒绝。');
    }
    const acceptedSessionId =
      result.data?.session_id ??
      result.resource_refs?.find((ref) => ref.kind === 'session')?.id ??
      state.sessionId;
    const taskId = result.data?.chat_task.task_id ?? result.task_refs?.[0]?.task_id;
    if (!taskId) throw new Error('服务端未返回聊天任务标识。');
    const stableMessageId =
      result.data?.message_ref.id ??
      result.resource_refs?.find((ref) => ref.kind === 'chat_message')?.id;
    if (stableMessageId) {
      state.bindOptimisticMessageId(attempt.optimisticMessageId, stableMessageId);
    }
    if (acceptedSessionId !== state.sessionId) state.setSessionId(acceptedSessionId);
    context.currentTaskIdRef.current = taskId;
    context.previousTaskIdRef.current = undefined;
    state.setActiveOperationId(result.operation_id);
    state.setActiveTaskId(taskId);

    try {
      await connection.setChannels(
        desiredChannels(acceptedSessionId, taskId, result.operation_id),
      );
    } catch (error) {
      if (!(error instanceof SubscriptionRejectedError)) {
        context.reportError(error, '任务实时频道订阅失败。');
      }
      await context.reconcileFromRest(taskId, acceptedSessionId);
    }
    context.pendingSubmissionRef.current = undefined;
    return true;
  } catch (error) {
    context.currentTaskIdRef.current = undefined;
    context.previousTaskIdRef.current = undefined;
    state.setStreaming(false);
    state.setThinking(false);
    state.setTaskStatus('failed');
    state.addMessage({
      id: Crypto.randomUUID(),
      role: 'system',
      content: error instanceof Error ? error.message : '消息提交失败，请稍后重试。',
    });
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
