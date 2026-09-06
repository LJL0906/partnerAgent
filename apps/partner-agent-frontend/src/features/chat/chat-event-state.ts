import * as Crypto from 'expo-crypto';
import type { MutableRefObject } from 'react';

import { SENSITIVE_CATEGORIES } from '@partner-agent/contracts';
import type { PrivacyDecisionStatus, ServerPushEventV1 } from '@partner-agent/contracts';
import type { RecoverableTaskStatus } from '@/api/chat-api';
import { mapServerPushEventToChatItems } from './chat-event-routing';

import {
  isTerminalTaskStatus,
  useChatStore,
  type ChatTaskStatus,
} from '@/store/chat-store';

export { mapServerPushEventToChatItems } from './chat-event-routing';

export function applyAgentEvent(
  event: ServerPushEventV1,
  assistantIdRef: MutableRefObject<string | undefined>,
): void {
  const state = useChatStore.getState();
  for (const item of mapServerPushEventToChatItems(event)) {
    if (!(item.type === 'message' && event.event_type === 'text_delta') && !(item.type === 'thinking' && event.event_type === 'thinking_delta')) state.upsertItem(item);
  }
  switch (event.event_type) {
    case 'history':
      state.reconcileMessages(
        event.data.messages.map((message, index) => ({
          id: `history:${event.session_id ?? 'unknown'}:${message.timestamp}:${index}`,
          role: message.role,
          content: message.content,
          createdAt: new Date(message.timestamp).toISOString(),
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
        state.addMessage({ id: assistantId, role: 'assistant', content: '', createdAt: new Date().toISOString() });
      }
      state.setStreaming(true);
      state.setThinking(false);
      state.upsertItem({ schema_version: 1, id: assistantId, type: 'message', status: 'streaming', collapsed: false, created_at: Date.now(), updated_at: Date.now(), session_id: event.session_id, task_id: event.task_id, operation_id: event.operation_id, message_id: assistantId, payload: { role: 'assistant', content: event.data, format: 'markdown' } });
      return;
    }
    case 'thinking_delta': {
      if (!state.setTaskStatus('running')) return;
      state.setStreaming(true);
      state.setThinking(true);
      const [item] = mapServerPushEventToChatItems(event);
      if (item) state.upsertItem(item);
      return;
    }
    case 'tool_execution_start':
      state.setTaskStatus('running');
      return;
    case 'tool_execution_end':
      if (isTerminalTaskStatus(state.taskStatus)) return;
      return;
    case 'task_state':
      applyTaskState(
        event.data.state,
        event.data.message,
        assistantIdRef,
        event.data.privacy_decision,
      );
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

export function applyRecoveredTask(
  task: RecoverableTaskStatus,
  assistantIdRef: MutableRefObject<string | undefined>,
): void {
  applyTaskState(task.state, task.error, assistantIdRef, task.privacy_decision);
}

export function toPrivacyDecisionSummary(
  privacyDecision: PrivacyDecisionStatus | undefined,
): PrivacyDecisionStatus | undefined {
  if (!privacyDecision) return undefined;
  const allowedCategories = new Set<string>(SENSITIVE_CATEGORIES);
  return {
    egress_id: privacyDecision.egress_id,
    categories: privacyDecision.categories.filter((category) => allowedCategories.has(category)),
    provider: privacyDecision.provider,
    model_id: privacyDecision.model_id,
    expires_at: privacyDecision.expires_at,
  };
}

function applyTaskState(
  taskState: RecoverableTaskStatus['state'],
  error: string | undefined,
  assistantIdRef: MutableRefObject<string | undefined>,
  privacyDecision?: PrivacyDecisionStatus,
): void {
  const state = useChatStore.getState();
  const taskStatus = toChatTaskStatus(taskState);
  const previousStatus = state.taskStatus;
  if (!state.setTaskStatus(taskStatus)) return;
  if (taskStatus === 'waiting_privacy_decision') {
    state.setPrivacyDecision(toPrivacyDecisionSummary(privacyDecision));
  }
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
  const messages = useChatStore.getState().messages.filter((message) => message.role === 'user' || message.role === 'assistant');
  const last = messages[messages.length - 1];
  return last?.role === 'assistant' ? last.id : undefined;
}




