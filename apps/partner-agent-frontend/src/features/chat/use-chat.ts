import type {
  ReasoningLevel,
  ServerPushEventV1,
  SubscriptionAckV1,
  SubscriptionChannel,
  ToolControlAckV1,
} from '@partner-agent/contracts';
import * as Crypto from 'expo-crypto';
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import { initializeSession, rememberSession, useConversationStore } from './session-management';
import { applyChatSessionSnapshot } from './chat-session-snapshot';

import {
  closeAllAgentStreams,
  AgentStreamConnectError,
  subscribeAgentStream,
  SubscriptionRejectedError,
  type AgentStreamConnection,
} from '@/api/agent-stream';
import {
  cancelTask,
  getChatSession,
  getTaskStatus,
  type RecoverableChatSession,
  type RecoverableTaskStatus,
} from '@/api/chat-api';
import { useChatStore } from '@/store/chat-store';

import { applyAgentEvent, applyRecoveredTask } from './chat-event-state';
import { createChatToolControls, type ChatToolControlTransport, type ChatToolControls } from './chat-tool-controls';
import {
  channelId,
  dispatchApplicationEvent,
  desiredChannels,
  initialChatChannels,
  PENDING_CHAT_TASK_ID,
  routeAgentEvent,
} from './chat-event-routing';
import {
  sendChatMessage,
  type PendingChatSubmission,
} from './chat-message-submission';

interface ReconciliationQueries {
  getTaskStatus: typeof getTaskStatus;
  getChatSession: typeof getChatSession;
}

interface ReconcileChatOptions {
  queries?: ReconciliationQueries;
  assistantMessageIdRef?: MutableRefObject<string | undefined>;
  shouldApplyTask?: (task: RecoverableTaskStatus) => boolean;
}

type TaskQueryResult = PromiseSettledResult<RecoverableTaskStatus | undefined>;
type SessionQueryResult = PromiseSettledResult<RecoverableChatSession | undefined>;

export function loadChatReconciliation(
  taskId: string | undefined,
  sessionId: string | undefined,
  queries: ReconciliationQueries = { getTaskStatus, getChatSession },
): Promise<[TaskQueryResult, SessionQueryResult]> {
  const taskRequest = taskId
    ? queries.getTaskStatus(taskId)
    : Promise.resolve<RecoverableTaskStatus | undefined>(undefined);
  const sessionRequest = sessionId
    ? queries.getChatSession(sessionId)
    : Promise.resolve<RecoverableChatSession | undefined>(undefined);
  return Promise.allSettled([taskRequest, sessionRequest]);
}

export function findAuthoritativeUserMessageId(snapshot: unknown, operationId: string): string | undefined {
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  const record = snapshot as { items?: unknown; messages?: unknown };
  if (Array.isArray(record.items)) {
    const item = record.items.find((candidate) => candidate && typeof candidate === 'object'
      && (candidate as { type?: unknown }).type === 'message'
      && (candidate as { operation_id?: unknown }).operation_id === operationId
      && (candidate as { payload?: { role?: unknown } }).payload?.role === 'user');
    const messageId = (item as { message_id?: unknown } | undefined)?.message_id;
    if (typeof messageId === 'string') return messageId;
  }
  if (Array.isArray(record.messages)) {
    const message = record.messages.find((candidate) => candidate && typeof candidate === 'object'
      && (candidate as { role?: unknown }).role === 'user'
      && (candidate as { operation_id?: unknown }).operation_id === operationId);
    const messageId = (message as { id?: unknown } | undefined)?.id;
    if (typeof messageId === 'string') return messageId;
  }
  return undefined;
}

export function adoptPendingSubmissionSession(
  event: ServerPushEventV1,
  pending: PendingChatSubmission | undefined,
  currentTaskId: string | undefined,
): boolean {
  const state = useChatStore.getState();
  if (state.sessionPersisted || currentTaskId !== PENDING_CHAT_TASK_ID || !pending
    || pending.sessionId !== state.sessionId || event.channel !== 'user:self'
    || !event.session_id || event.operation_id !== pending.operationId) return false;
  state.setSessionId(event.session_id);
  state.setSessionPersisted(true);
  pending.sessionId = event.session_id;
  rememberSession(event.session_id);
  return true;
}

/**
 * 统一以 REST 快照修复聊天状态。隐私决定提交成功后也调用此入口，避免客户端
 * 推测任务终态；两个请求独立结算，任一成功的快照都会被应用。
 */
export async function reconcileChatFromRest(
  taskId: string | undefined,
  sessionId: string | undefined,
  options: ReconcileChatOptions = {},
): Promise<[TaskQueryResult, SessionQueryResult]> {
  const initial = useChatStore.getState();
  const revision = initial.sessionRevision;
  const sessionMatches = !initial.sessionId || !sessionId || initial.sessionId === sessionId;
  const results = await loadChatReconciliation(
    taskId,
    sessionId,
    options.queries ?? { getTaskStatus, getChatSession },
  );
  if (!sessionMatches || useChatStore.getState().sessionRevision !== revision) return results;
  const [taskResult, sessionResult] = results;
  const assistantMessageIdRef =
    options.assistantMessageIdRef ?? ({ current: undefined } as MutableRefObject<string | undefined>);

  if (sessionResult.status === 'fulfilled' && sessionResult.value) {
    try {
      applyChatSessionSnapshot(sessionResult.value, sessionId ?? initial.sessionId);
      assistantMessageIdRef.current = findLatestAssistantId();
      const activeTask = sessionResult.value.active_task
        ?? (initial.taskStatus === 'recovering'
          && initial.activeOperationId === sessionResult.value.latest_task?.operation_id
          ? sessionResult.value.latest_task
          : undefined);
      if (activeTask) {
        const state = useChatStore.getState();
        state.setActiveTaskId(activeTask.task_id);
        state.setActiveOperationId(activeTask.operation_id);
        state.clearSubmissionNotice(activeTask.operation_id);
        applyRecoveredTask({
          task_id: activeTask.task_id,
          state: activeTask.state,
          created_at: sessionResult.value.created_at,
          updated_at: sessionResult.value.updated_at,
        }, assistantMessageIdRef);
      }
    } catch (error) {
      // A bad session response must not suppress an independently valid task result.
      results[1] = { status: 'rejected', reason: error };
    }
  }

  if (
    taskResult.status === 'fulfilled' &&
    taskResult.value &&
    (!taskId || taskResult.value.task_id === taskId) &&
    (options.shouldApplyTask?.(taskResult.value) ?? true)
  ) {
    applyRecoveredTask(taskResult.value, assistantMessageIdRef);
  }

  return results;
}

/** 鉴权退出的单一清理入口：先断开流，再清除全部本地聊天运行态。 */
export function resetChatRuntime(): void {
  closeAllAgentStreams();
  useChatStore.getState().resetChat();
}

export interface UseChatOptions {
  toolControls?: ChatToolControlTransport;
}

export function createUseChatToolControls(
  getSessionId: () => string | undefined,
  getTransport: () => ChatToolControlTransport | undefined,
): ChatToolControls {
  return createChatToolControls(getSessionId, getTransport);
}

export function useChat(options: UseChatOptions = {}) {
  const ready = useConversationStore((state) => state.ready);
  const sessionRevision = useChatStore((state) => state.sessionRevision);
  const sessionPersisted = useChatStore((state) => state.sessionPersisted);
  const sessionId = useChatStore((state) => state.sessionId);
  const activeTaskId = useChatStore((state) => state.activeTaskId);
  const activeOperationId = useChatStore((state) => state.activeOperationId);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const assistantMessageIdRef = useRef<string | undefined>(undefined);
  const currentTaskIdRef = useRef<string | undefined>(undefined);
  const previousTaskIdRef = useRef<string | undefined>(undefined);
  const pendingSubmissionRef = useRef<PendingChatSubmission | undefined>(undefined);
  const streamConnectionRef = useRef<AgentStreamConnection | undefined>(undefined);
  const streamReadyRef = useRef<Promise<AgentStreamConnection> | undefined>(undefined);
  const reconciliationsRef = useRef(new Map<string, Promise<void>>());
  const runTool = useCallback((action: keyof ChatToolControls, resourceId: string) => {
    return createUseChatToolControls(
      () => useChatStore.getState().sessionId,
      () => options.toolControls ?? streamConnectionRef.current,
    )[action](resourceId);
  }, [options.toolControls]);
  const toolControls = useMemo<ChatToolControls>(() => ({
    confirmTool: (id) => runTool('confirmTool', id),
    dismissTool: (id) => runTool('dismissTool', id),
    undoTool: (id) => runTool('undoTool', id),
  }), [runTool]);



  const reportError = useCallback((error: unknown, fallback: string) => {
    const state = useChatStore.getState();
    state.setConnectionStatus('error');
    state.addMessage({
      id: Crypto.randomUUID(),
      role: 'system',
      content: error instanceof Error ? error.message : fallback,
    });
  }, []);

  const reconcileFromRest = useCallback(
    (taskId: string | undefined, recoverySessionId: string | undefined): Promise<void> => {
      const revision = useChatStore.getState().sessionRevision;
      const key = `${revision}:${taskId ?? 'session'}:${recoverySessionId ?? ''}`;
      const existing = reconciliationsRef.current.get(key);
      if (existing) return existing;

      const reconciliation = (async () => {
        const [taskResult, sessionResult] = await reconcileChatFromRest(
          taskId,
          recoverySessionId,
          {
            assistantMessageIdRef,
            shouldApplyTask: (task) => {
              if (
                !currentTaskIdRef.current ||
                currentTaskIdRef.current === PENDING_CHAT_TASK_ID
              ) {
                currentTaskIdRef.current = task.task_id;
              }
              return task.task_id === currentTaskIdRef.current;
            },
          },
        );

        if (revision !== useChatStore.getState().sessionRevision) return;
        if (sessionResult.status === 'fulfilled' && sessionResult.value?.active_task) {
          const activeTask = sessionResult.value.active_task;
          currentTaskIdRef.current = activeTask.task_id;
          previousTaskIdRef.current = undefined;
        }
        const pending = pendingSubmissionRef.current;
        if (pending && sessionResult.status === 'fulfilled' && sessionResult.value) {
          const authoritativeMessageId = findAuthoritativeUserMessageId(
            sessionResult.value,
            pending.operationId,
          );
          if (authoritativeMessageId) {
            useChatStore.getState().bindOptimisticMessageId(
              pending.optimisticMessageId,
              authoritativeMessageId,
            );
            pendingSubmissionRef.current = undefined;
          }
        }
        const failures: string[] = [];
        if (taskResult.status === 'rejected') failures.push('任务状态');
        if (sessionResult.status === 'rejected') failures.push('会话消息');
        if (failures.length > 0) {
          reportError(undefined, `${failures.join('与')} REST 对账失败，请稍后重试。`);
        }
      })().finally(() => {
        reconciliationsRef.current.delete(key);
      });

      reconciliationsRef.current.set(key, reconciliation);
      return reconciliation;
    },
    [reportError],
  );

  const handleAgentEvent = useCallback(
    (event: ServerPushEventV1) => {
      let state = useChatStore.getState();
      const adoptedPendingSession = adoptPendingSubmissionSession(
        event,
        pendingSubmissionRef.current,
        currentTaskIdRef.current,
      );
      if (adoptedPendingSession) state = useChatStore.getState();
      const route = routeAgentEvent(event, {
        sessionId: state.sessionId,
        sessionPersisted: state.sessionPersisted,
        currentTaskId: currentTaskIdRef.current ?? state.activeTaskId,
        previousTaskId: previousTaskIdRef.current,
        activeOperationId: state.activeOperationId,
        pendingOperationId: pendingSubmissionRef.current?.operationId,
      });
      if (route === 'application') {
        dispatchApplicationEvent(event);
        return;
      }
      if (route === 'ignore') return;
      if (event.task_id && currentTaskIdRef.current === PENDING_CHAT_TASK_ID) {
        currentTaskIdRef.current = event.task_id;
        state.setActiveTaskId(event.task_id);
        if (event.operation_id) state.setActiveOperationId(event.operation_id);
      }
      if (event.event_type === 'recovery_required') {
        const taskId = event.task_id ?? channelId(event.channel, 'task') ?? state.activeTaskId;
        const recoverySessionId =
          event.session_id ?? channelId(event.channel, 'session') ?? state.sessionId;
        void reconcileFromRest(taskId, recoverySessionId).catch((error: unknown) =>
          reportError(error, 'REST 状态恢复失败，请稍后重试。'),
        );
        return;
      }
      const eventTaskId = event.task_id ?? channelId(event.channel, 'task') ?? state.activeTaskId;
      const result = applyAgentEvent(event, assistantMessageIdRef);
      if (adoptedPendingSession || result.recoveryRequired || result.terminalObserved) {
        void reconcileFromRest(eventTaskId, state.sessionId).catch((error: unknown) =>
          reportError(error, '任务完成后的 REST 对账失败。'),
        );
      }
    },
    [reconcileFromRest, reportError],
  );

  const handleSubscriptionAck = useCallback(
    (ack: SubscriptionAckV1) => {
      const state = useChatStore.getState();
      const taskChannel = state.activeTaskId
        ? (`task:${state.activeTaskId}` as SubscriptionChannel)
        : undefined;
      const operationChannel = state.activeOperationId
        ? (`operation:${state.activeOperationId}` as SubscriptionChannel)
        : undefined;
      if (
        !ack.accepted.some(
          (channel) => channel === taskChannel || channel === operationChannel,
        )
      ) {
        return;
      }
      void reconcileFromRest(state.activeTaskId, state.sessionId).catch((error: unknown) =>
        reportError(error, '订阅成功后的 REST 对账失败。'),
      );
    },
    [reconcileFromRest, reportError],
  );

  useEffect(() => { void initializeSession(); }, []);

  useEffect(() => {
    if (!sessionId || !ready) return;
    assistantMessageIdRef.current = undefined;
    currentTaskIdRef.current = useChatStore.getState().activeTaskId;
    previousTaskIdRef.current = undefined;
    pendingSubmissionRef.current = undefined;
    let disposed = false;
    const isCurrent = () => !disposed && useChatStore.getState().sessionRevision === sessionRevision;
    const opening = subscribeAgentStream({
      // 新生成的 sessionId 在首条 REST 提交前尚未归属当前用户，不能提前
      // 订阅。先以 user:self 完成鉴权与连接握手，REST 创建会话后再追加
      // session/task/operation，并通过权威 REST 快照补齐 ACK 前的事件。
      channels: useChatStore.getState().sessionPersisted
        ? desiredChannels(sessionId, useChatStore.getState().activeTaskId, useChatStore.getState().activeOperationId)
        : initialChatChannels(),
      onEvent: (event) => { if (isCurrent()) handleAgentEvent(event); },
      onInvalidEvent: () => {
        if (!isCurrent()) return;
        const state = useChatStore.getState();
        void reconcileFromRest(state.activeTaskId, state.sessionId).catch((error: unknown) =>
          reportError(error, '实时事件协议需要 REST 恢复。'),
        );
      },
      onSubscriptionAck: (ack) => { if (isCurrent()) handleSubscriptionAck(ack); },
      onSubscriptionError: (error) => { if (isCurrent()) reportError(error, '实时订阅失败。'); },
      onConnectionError: (error) => { if (isCurrent()) reportError(error, '无法连接实时服务，请稍后重试。'); },
      onStatusChange: (status) => { if (isCurrent()) useChatStore.getState().setConnectionStatus(status); },
    });
    streamReadyRef.current = opening;

    void opening
      .then((connection) => {
        if (!isCurrent()) {
          connection.close();
          return;
        }
        streamConnectionRef.current = connection;
        if (useChatStore.getState().sessionPersisted) void reconcileFromRest(useChatStore.getState().activeTaskId, sessionId);
      })
      .catch((error: unknown) => {
        if (
          isCurrent() &&
          !(error instanceof SubscriptionRejectedError) &&
          !(error instanceof AgentStreamConnectError)
        ) {
          reportError(error, '实时连接建立失败。');
        }
      });

    return () => {
      disposed = true;
      streamReadyRef.current = undefined;
      streamConnectionRef.current?.close();
      streamConnectionRef.current = undefined;
    };
  }, [handleAgentEvent, handleSubscriptionAck, reconcileFromRest, reportError, sessionId, sessionRevision, ready]);

  useEffect(() => {
    const connection = streamConnectionRef.current;
    if (!connection || !sessionId || !sessionPersisted || !ready) return;
    const revision = useChatStore.getState().sessionRevision;
    void connection
      .setChannels(desiredChannels(sessionId, activeTaskId, activeOperationId))
      .catch((error: unknown) => {
        if (revision !== useChatStore.getState().sessionRevision) return;
        if (!(error instanceof SubscriptionRejectedError)) {
          reportError(error, '实时频道更新失败。');
        }
      });
  }, [activeOperationId, activeTaskId, reportError, sessionId, sessionPersisted, ready]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      const state = useChatStore.getState();
      if (status === 'active' && state.sessionPersisted && useConversationStore.getState().ready) {
        void reconcileFromRest(state.activeTaskId, state.sessionId);
      }
    });
    return () => subscription.remove();
  }, [reconcileFromRest]);

  const sendMessage = useCallback(async (rawMessage: string, modelConfigId: string, reasoningLevel: ReasoningLevel, outputMode: 'chat' | 'structured_preview' = 'chat') => {
    if (!useConversationStore.getState().ready) return false;
    return sendChatMessage(rawMessage, {
      assistantMessageIdRef,
      currentTaskIdRef,
      pendingSubmissionRef,
      previousTaskIdRef,
      reconcileFromRest: (taskId, recoverySessionId) =>
        reconcileFromRest(taskId, recoverySessionId),
      reportError,
      streamReadyRef,
      modelConfigId,
      reasoningLevel,
      outputMode,
    });
  }, [reconcileFromRest, reportError]);

  const stopStreaming = useCallback(async () => {
    const state = useChatStore.getState();
    if (!state.activeTaskId) return;
    const isCurrent = () => useChatStore.getState().sessionRevision === state.sessionRevision;
    const previousTaskStatus = state.taskStatus;
    state.setTaskStatus('cancelling');
    try {
      const result = await cancelTask(state.activeTaskId);
      if (!isCurrent()) return;
      if (result.status === 'rejected') {
        throw new Error(result.validation_errors?.[0]?.message ?? '取消请求被拒绝。');
      }
      state.setActiveOperationId(result.operation_id);
      const connection = streamConnectionRef.current ?? (await streamReadyRef.current);
      if (!isCurrent()) return;
      if (!connection) throw new Error('实时连接尚未就绪。');
      await connection.setChannels(
        desiredChannels(state.sessionId, state.activeTaskId, result.operation_id),
      );
    } catch (error) {
      if (!isCurrent()) return;
      state.setTaskStatus(previousTaskStatus);
      if (!(error instanceof SubscriptionRejectedError)) {
        reportError(error, '取消请求失败，请稍后重试。');
      } else {
        await reconcileFromRest(state.activeTaskId, state.sessionId).catch(
          (reconcileError: unknown) => reportError(reconcileError, '取消后的 REST 对账失败。'),
        );
      }
    }
  }, [reconcileFromRest, reportError]);

  return {
    sendMessage,
    stopStreaming,
    isStreaming,
    ...toolControls,
    toolControls,
  } satisfies {
    sendMessage: typeof sendMessage;
    stopStreaming: typeof stopStreaming;
    isStreaming: typeof isStreaming;
    toolControls: ChatToolControls;
    confirmTool: (confirmationId: string) => Promise<ToolControlAckV1>;
    dismissTool: (confirmationId: string) => Promise<ToolControlAckV1>;
    undoTool: (executionId: string) => Promise<ToolControlAckV1>;
  };
}

function findLatestAssistantId(): string | undefined {
  const messages = useChatStore.getState().messages.filter((message) => message.role === 'user' || message.role === 'assistant');
  const last = messages[messages.length - 1];
  return last?.role === 'assistant' ? last.id : undefined;
}

export { desiredChannels, initialChatChannels } from './chat-event-routing';
