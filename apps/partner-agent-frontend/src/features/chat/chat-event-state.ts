import { SENSITIVE_CATEGORIES } from '@partner-agent/contracts';
import type { PrivacyDecisionStatus, ServerPushEventV1 } from '@partner-agent/contracts';
import * as Crypto from 'expo-crypto';
import type { MutableRefObject } from 'react';

import type { RecoverableTaskStatus } from '@/api/chat-api';
import {
  isTerminalTaskStatus,
  useChatStore,
  type ChatTaskStatus,
} from '@/store/chat-store';

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
