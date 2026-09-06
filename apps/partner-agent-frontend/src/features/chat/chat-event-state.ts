import { SENSITIVE_CATEGORIES, type PrivacyDecisionStatus, type ServerPushEventV1 } from '@partner-agent/contracts';
import type { MutableRefObject } from 'react';

import type { RecoverableTaskStatus } from '@/api/chat-api';
import {
  applyTextDeltaToStore,
  applyThinkingDeltaToStore,
  isTerminalTaskStatus,
  useChatStore,
  type ChatTaskStatus,
} from '@/store/chat-store';
import { mapServerPushEventToChatItems } from './chat-event-routing';

export { mapServerPushEventToChatItems } from './chat-event-routing';

export interface AgentEventApplyResult {
  recoveryRequired: boolean;
  terminalObserved: boolean;
}

const NO_RECOVERY: AgentEventApplyResult = { recoveryRequired: false, terminalObserved: false };

export function applyAgentEvent(
  event: ServerPushEventV1,
  assistantIdRef: MutableRefObject<string | undefined>,
): AgentEventApplyResult {
  const state = useChatStore.getState();
  if (event.operation_id) state.clearSubmissionNotice(event.operation_id);
  if (event.event_type === 'history') {
    state.mergeSessionMessages(event.data.messages);
    assistantIdRef.current = findLatestAssistantId();
    return NO_RECOVERY;
  }
  if (event.event_type === 'todo_update') {
    state.setTaskTodos(event.task_id, event.data.items);
    state.setTaskStatus('running');
    state.setStreaming(true);
    return NO_RECOVERY;
  }
  if (event.event_type === 'text_delta') {
    const result = applyTextDeltaToStore({
      itemId: event.item_id, itemRevision: event.item_revision, messageId: event.message_id,
      textOffset: event.text_offset, data: event.data, sessionId: event.session_id,
      taskId: event.task_id, operationId: event.operation_id, timestamp: event.timestamp,
    });
    if (result === 'recovery_required') return { recoveryRequired: true, terminalObserved: false };
    if (result === 'ignored' && isTerminalTaskStatus(state.taskStatus)) return NO_RECOVERY;
    if (!state.setTaskStatus('running')) return NO_RECOVERY;
    if (event.task_id) {
      useChatStore.setState((current) => ({
        items: current.items.map((item) => item.type === 'thinking'
          && item.task_id === event.task_id && item.status === 'streaming'
          ? { ...item, status: 'completed', updated_at: event.timestamp }
          : item),
      }));
    }
    assistantIdRef.current = event.item_id;
    state.setStreaming(true);
    state.setThinking(false);
    return NO_RECOVERY;
  }
  if (event.event_type === 'thinking_delta') {
    const result = applyThinkingDeltaToStore({
      itemId: event.item_id, itemRevision: event.item_revision, textOffset: event.text_offset,
      data: event.data, sessionId: event.session_id, taskId: event.task_id,
      operationId: event.operation_id, timestamp: event.timestamp,
    });
    if (result === 'recovery_required') return { recoveryRequired: true, terminalObserved: false };
    if (!state.setTaskStatus('running')) return NO_RECOVERY;
    state.setStreaming(true);
    state.setThinking(true);
    return NO_RECOVERY;
  }

  const mappedItems = mapServerPushEventToChatItems(event);
  for (const item of mappedItems) state.upsertItem(item);
  switch (event.event_type) {
    case 'tool_execution_start':
      state.setTaskStatus('running');
      return { recoveryRequired: true, terminalObserved: false };
    case 'tool_execution_end':
    case 'tool_undo_available':
      return { recoveryRequired: true, terminalObserved: false };
    case 'tool_confirmation_pending':
      return { recoveryRequired: true, terminalObserved: false };
    case 'tool_confirmation_confirmed':
    case 'tool_confirmation_dismissed':
    case 'tool_undo_completed':
      return { recoveryRequired: true, terminalObserved: false };
    case 'task_state': {
      applyTaskState(event.data.state, event.data.message, assistantIdRef, event.data.privacy_decision);
      return { recoveryRequired: event.data.state === 'waiting_tool_approval',
        terminalObserved: isTerminalTaskStatus(event.data.state) };
    }
    case 'done':
      applyTaskState('completed', undefined, assistantIdRef);
      return { recoveryRequired: false, terminalObserved: true };
    case 'cancelled':
      applyTaskState('cancelled', undefined, assistantIdRef);
      return { recoveryRequired: false, terminalObserved: true };
    case 'error':
      if (event.data.code === 'EGRESS_002') {
        if (state.setTaskStatus('waiting_privacy_decision')) {
          state.setStreaming(true);
          state.setThinking(false);
        }
        return NO_RECOVERY;
      }
      applyTaskState('failed', event.data.message, assistantIdRef);
      return { recoveryRequired: false, terminalObserved: true };
    default:
      return NO_RECOVERY;
  }
}

export function applyRecoveredTask(
  task: RecoverableTaskStatus, assistantIdRef: MutableRefObject<string | undefined>,
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
  taskState: RecoverableTaskStatus['state'], error: string | undefined,
  assistantIdRef: MutableRefObject<string | undefined>, privacyDecision?: PrivacyDecisionStatus,
): void {
  const state = useChatStore.getState();
  const taskStatus: ChatTaskStatus = taskState;
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
    state.addMessage({ id: `task-error:${state.activeTaskId ?? 'unknown'}`, role: 'system', content: error });
  }
}

function finishStream(
  assistantIdRef: MutableRefObject<string | undefined>,
  taskStatus: Extract<ChatTaskStatus, 'completed' | 'cancelled' | 'failed'>,
): void {
  const state = useChatStore.getState();
  const taskId = state.activeTaskId;
  if (taskId) {
    useChatStore.setState((current) => ({
      items: current.items.map((item) => item.task_id === taskId && item.status === 'streaming'
        ? { ...item, status: taskStatus }
        : item),
    }));
  }
  state.setStreaming(false);
  state.setThinking(false);
  state.setTaskStatus(taskStatus);
  state.clearTaskTodos();
  state.setActiveTaskId(undefined);
  state.setActiveOperationId(undefined);
  assistantIdRef.current = undefined;
}

function findLatestAssistantId(): string | undefined {
  const items = useChatStore.getState().items.filter((item) =>
    item.type === 'message' && item.payload.role === 'assistant');
  return items.at(-1)?.id;
}
