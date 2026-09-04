import type {
  ServerPushEventV1,
  SubscriptionAckV1,
  SubscriptionChannel,
} from '@partner-agent/contracts';
import * as Crypto from 'expo-crypto';
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import {
  subscribeAgentStream,
  SubscriptionRejectedError,
  type AgentStreamConnection,
} from '@/api/agent-stream';
import {
  cancelTask,
  getChatSession,
  getTaskStatus,
  submitTextInput,
  type RecoverableChatSession,
  type RecoverableTaskStatus,
} from '@/api/chat-api';
import {
  isTerminalTaskStatus,
  useChatStore,
  type ChatTaskStatus,
} from '@/store/chat-store';

const PENDING_TASK_ID = '__pending_task__';

interface ReconciliationQueries {
  getTaskStatus: typeof getTaskStatus;
  getChatSession: typeof getChatSession;
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

export function useChat() {
  const sessionId = useChatStore((state) => state.sessionId);
  const activeTaskId = useChatStore((state) => state.activeTaskId);
  const activeOperationId = useChatStore((state) => state.activeOperationId);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const assistantMessageIdRef = useRef<string | undefined>(undefined);
  const currentTaskIdRef = useRef<string | undefined>(undefined);
  const previousTaskIdRef = useRef<string | undefined>(undefined);
  const streamConnectionRef = useRef<AgentStreamConnection | undefined>(undefined);
  const streamReadyRef = useRef<Promise<AgentStreamConnection> | undefined>(undefined);
  const reconciliationsRef = useRef(new Map<string, Promise<void>>());

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
      const key = `${taskId ?? 'session'}:${recoverySessionId ?? ''}`;
      const existing = reconciliationsRef.current.get(key);
      if (existing) return existing;

      const reconciliation = (async () => {
        const stateBefore = useChatStore.getState();
        const previousStatus = stateBefore.taskStatus;

        const [taskResult, sessionResult] = await loadChatReconciliation(
          taskId,
          recoverySessionId,
        );
        const state = useChatStore.getState();

        if (sessionResult.status === 'fulfilled' && sessionResult.value) {
          state.reconcileMessages(
            sessionResult.value.messages.map((message) => ({
              id: message.id,
              role: message.role,
              content: message.content,
            })),
          );
          assistantMessageIdRef.current = findLatestAssistantId();
        }

        if (taskResult.status === 'fulfilled' && taskResult.value) {
          if (!currentTaskIdRef.current || currentTaskIdRef.current === PENDING_TASK_ID) {
            currentTaskIdRef.current = taskResult.value.task_id;
          }
          if (taskResult.value.task_id === currentTaskIdRef.current) {
            applyRecoveredTask(taskResult.value, assistantMessageIdRef);
          }
        } else if (taskId && !isTerminalTaskStatus(previousStatus)) {
          state.setTaskStatus(previousStatus);
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
      if (event.task_id && currentTaskIdRef.current === PENDING_TASK_ID) {
        if (event.task_id === previousTaskIdRef.current) return;
        currentTaskIdRef.current = event.task_id;
      }
      if (
        event.task_id &&
        currentTaskIdRef.current &&
        event.task_id !== currentTaskIdRef.current
      ) {
        return;
      }
      if (event.event_type === 'recovery_required') {
        const state = useChatStore.getState();
        const taskId = event.task_id ?? channelId(event.channel, 'task') ?? state.activeTaskId;
        const recoverySessionId =
          event.session_id ?? channelId(event.channel, 'session') ?? state.sessionId;
        void reconcileFromRest(taskId, recoverySessionId).catch((error: unknown) =>
          reportError(error, 'REST 状态恢复失败，请稍后重试。'),
        );
        return;
      }
      applyAgentEvent(event, assistantMessageIdRef);
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

  useEffect(() => {
    if (sessionId) return;
    useChatStore.getState().setSessionId(Crypto.randomUUID());
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    let disposed = false;
    const opening = subscribeAgentStream({
      channels: stableChannels(sessionId),
      onEvent: handleAgentEvent,
      onSubscriptionAck: handleSubscriptionAck,
      onSubscriptionError: (error) => reportError(error, '实时订阅失败。'),
      onStatusChange: (status) => useChatStore.getState().setConnectionStatus(status),
    });
    streamReadyRef.current = opening;

    void opening
      .then((connection) => {
        if (disposed) {
          connection.close();
          return;
        }
        streamConnectionRef.current = connection;
        const state = useChatStore.getState();
        return connection.setChannels(
          desiredChannels(state.sessionId, state.activeTaskId, state.activeOperationId),
        );
      })
      .catch((error: unknown) => {
        if (!disposed && !(error instanceof SubscriptionRejectedError)) {
          reportError(error, '实时连接建立失败。');
        }
      });

    return () => {
      disposed = true;
      streamReadyRef.current = undefined;
      streamConnectionRef.current?.close();
      streamConnectionRef.current = undefined;
    };
  }, [handleAgentEvent, handleSubscriptionAck, reportError, sessionId]);

  useEffect(() => {
    const connection = streamConnectionRef.current;
    if (!connection || !sessionId) return;
    void connection
      .setChannels(desiredChannels(sessionId, activeTaskId, activeOperationId))
      .catch((error: unknown) => {
        if (!(error instanceof SubscriptionRejectedError)) {
          reportError(error, '实时频道更新失败。');
        }
      });
  }, [activeOperationId, activeTaskId, reportError, sessionId]);

  const sendMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return false;
    const stateBefore = useChatStore.getState();
    if (!stateBefore.sessionId || stateBefore.isStreaming) return false;

    let connection: AgentStreamConnection;
    try {
      const opening = streamReadyRef.current;
      if (!opening) throw new Error('实时连接尚未初始化，请稍后重试。');
      connection = await opening;
    } catch (error) {
      reportError(error, '实时连接尚未就绪。');
      return true;
    }

    const state = useChatStore.getState();
    if (state.isStreaming) return false;
    const optimisticMessageId = Crypto.randomUUID();
    previousTaskIdRef.current = currentTaskIdRef.current;
    currentTaskIdRef.current = PENDING_TASK_ID;
    state.beginTask();
    state.addMessage({ id: optimisticMessageId, role: 'user', content: message });
    assistantMessageIdRef.current = undefined;

    try {
      const result = await submitTextInput({ text: message, sessionId: state.sessionId });
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
      if (stableMessageId) state.bindOptimisticMessageId(optimisticMessageId, stableMessageId);
      if (acceptedSessionId !== state.sessionId) state.setSessionId(acceptedSessionId);
      currentTaskIdRef.current = taskId;
      previousTaskIdRef.current = undefined;
      state.setActiveOperationId(result.operation_id);
      state.setActiveTaskId(taskId);

      try {
        await connection.setChannels(
          desiredChannels(acceptedSessionId, taskId, result.operation_id),
        );
      } catch (error) {
        if (!(error instanceof SubscriptionRejectedError)) {
          reportError(error, '任务实时频道订阅失败。');
        }
        await reconcileFromRest(taskId, acceptedSessionId);
      }
      return true;
    } catch (error) {
      currentTaskIdRef.current = undefined;
      previousTaskIdRef.current = undefined;
      state.setStreaming(false);
      state.setThinking(false);
      state.setTaskStatus('failed');
      state.addMessage({
        id: Crypto.randomUUID(),
        role: 'system',
        content: error instanceof Error ? error.message : '消息提交失败，请稍后重试。',
      });
      return true;
    }
  }, [reconcileFromRest, reportError]);

  const stopStreaming = useCallback(async () => {
    const state = useChatStore.getState();
    if (!state.activeTaskId) return;
    const previousTaskStatus = state.taskStatus;
    state.setTaskStatus('cancelling');
    try {
      const result = await cancelTask(state.activeTaskId);
      if (result.status === 'rejected') {
        throw new Error(result.validation_errors?.[0]?.message ?? '取消请求被拒绝。');
      }
      state.setActiveOperationId(result.operation_id);
      const connection = streamConnectionRef.current ?? (await streamReadyRef.current);
      if (!connection) throw new Error('实时连接尚未就绪。');
      await connection.setChannels(
        desiredChannels(state.sessionId, state.activeTaskId, result.operation_id),
      );
    } catch (error) {
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

  return { sendMessage, stopStreaming, isStreaming };
}

export function applyAgentEvent(
  event: ServerPushEventV1,
  assistantIdRef: MutableRefObject<string | undefined>,
): void {
  const state = useChatStore.getState();
  switch (event.event_type) {
    case 'history':
      state.reconcileMessages(
        event.data.messages.map((message, index) => ({
          id: `history:${event.session_id ?? 'unknown'}:${message.timestamp}:${index}`,
          role: message.role,
          content: message.content,
        })),
      );
      assistantIdRef.current = findLatestAssistantId();
      return;
    case 'text_delta': {
      if (!state.setTaskStatus('running')) return;
      let assistantId = assistantIdRef.current;
      if (!assistantId) {
        assistantId = Crypto.randomUUID();
        assistantIdRef.current = assistantId;
        state.addMessage({ id: assistantId, role: 'assistant', content: '' });
      }
      state.setStreaming(true);
      state.setThinking(false);
      state.appendAssistantContent(assistantId, event.data);
      return;
    }
    case 'thinking_delta':
      if (!state.setTaskStatus('running')) return;
      state.setStreaming(true);
      state.setThinking(true);
      return;
    case 'tool_execution_start':
      if (!state.setTaskStatus('running')) return;
      state.addMessage({
        id: `tool:${event.data.tool_call_id}`,
        role: 'tool',
        content: `正在执行 ${event.data.tool}`,
        tool: event.data.tool,
        toolCallId: event.data.tool_call_id,
      });
      return;
    case 'tool_execution_end':
      if (isTerminalTaskStatus(state.taskStatus)) return;
      state.completeTool(event.data.tool_call_id, event.data.success);
      return;
    case 'task_state':
      applyTaskState(event.data.state, event.data.message, assistantIdRef);
      return;
    case 'done':
      applyTaskState('completed', undefined, assistantIdRef);
      return;
    case 'cancelled': {
      const wasTerminal = isTerminalTaskStatus(state.taskStatus);
      applyTaskState('cancelled', undefined, assistantIdRef);
      if (!wasTerminal && useChatStore.getState().taskStatus === 'cancelled') {
        state.addMessage({
          id: `cancelled:${event.task_id ?? event.event_id}`,
          role: 'system',
          content: '已取消本次回复。',
        });
      }
      return;
    }
    case 'error':
      if (event.data.code === 'EGRESS_002') {
        if (!state.setTaskStatus('waiting_privacy_decision')) return;
        state.setStreaming(true);
        state.setThinking(false);
        return;
      }
      if (isTerminalTaskStatus(state.taskStatus)) return;
      applyTaskState('failed', event.data.message, assistantIdRef);
  }
}

function applyRecoveredTask(
  task: RecoverableTaskStatus,
  assistantIdRef: MutableRefObject<string | undefined>,
): void {
  applyTaskState(task.state, task.error, assistantIdRef);
}

function applyTaskState(
  taskState: RecoverableTaskStatus['state'],
  error: string | undefined,
  assistantIdRef: MutableRefObject<string | undefined>,
): void {
  const state = useChatStore.getState();
  const taskStatus = toChatTaskStatus(taskState);
  const previousStatus = state.taskStatus;
  if (!state.setTaskStatus(taskStatus)) return;
  if (isTerminalTaskStatus(taskStatus)) {
    finishStream(assistantIdRef, taskStatus);
  } else {
    state.setStreaming(true);
    state.setThinking(taskStatus === 'queued' || taskStatus === 'running');
  }
  if (taskStatus === 'failed' && error && previousStatus !== 'failed') {
    state.addMessage({
      id: `task-error:${state.activeTaskId ?? error}`,
      role: 'system',
      content: error,
    });
  }
}

function toChatTaskStatus(state: RecoverableTaskStatus['state']): ChatTaskStatus {
  return state;
}

function finishStream(
  assistantIdRef: MutableRefObject<string | undefined>,
  taskStatus: Extract<ChatTaskStatus, 'completed' | 'cancelled' | 'failed'>,
): void {
  const state = useChatStore.getState();
  state.setStreaming(false);
  state.setThinking(false);
  state.setTaskStatus(taskStatus);
  state.setActiveTaskId(undefined);
  state.setActiveOperationId(undefined);
  assistantIdRef.current = undefined;
}

function findLatestAssistantId(): string | undefined {
  return [...useChatStore.getState().messages]
    .reverse()
    .find((message) => message.role === 'assistant')?.id;
}

function stableChannels(sessionId: string): SubscriptionChannel[] {
  return ['user:self', `session:${sessionId}`];
}

function desiredChannels(
  sessionId: string,
  taskId?: string,
  operationId?: string,
): SubscriptionChannel[] {
  const channels = stableChannels(sessionId);
  if (taskId) channels.push(`task:${taskId}`);
  if (operationId) channels.push(`operation:${operationId}`);
  return channels;
}

function channelId(
  channel: SubscriptionChannel,
  kind: 'task' | 'session',
): string | undefined {
  const prefix = `${kind}:`;
  return channel.startsWith(prefix) ? channel.slice(prefix.length) : undefined;
}
