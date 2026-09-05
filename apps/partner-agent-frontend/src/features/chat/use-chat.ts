import type {
  ServerPushEventV1,
  SubscriptionAckV1,
  SubscriptionChannel,
} from '@partner-agent/contracts';
import * as Crypto from 'expo-crypto';
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { initialize会话, useConversationStore } from './会话管理';

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
    useChatStore.getState().reconcileMessages(
      sessionResult.value.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
      })),
    );
    assistantMessageIdRef.current = findLatestAssistantId();
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

export function useChat() {
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
      const state = useChatStore.getState();
      const route = routeAgentEvent(event, {
        sessionId: state.sessionId,
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

  useEffect(() => { void initialize会话(); }, []);

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

  const sendMessage = useCallback(async (rawMessage: string) => {
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

  return { sendMessage, stopStreaming, isStreaming };
}

function findLatestAssistantId(): string | undefined {
  const messages = useChatStore.getState().messages.filter((message) => message.role === 'user' || message.role === 'assistant');
  const last = messages[messages.length - 1];
  return last?.role === 'assistant' ? last.id : undefined;
}

export { desiredChannels, initialChatChannels } from './chat-event-routing';
