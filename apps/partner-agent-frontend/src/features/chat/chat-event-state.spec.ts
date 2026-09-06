import type { ServerPushEventV1 } from '@partner-agent/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat-store';
import { applyAgentEvent } from './chat-event-state';

const operationId = '11111111-1111-4111-8111-111111111111';
const assistantRef: { current: string | undefined } = { current: undefined };

function base() {
  return { schema_version: 1 as const, channel: 'task:task-1' as const, sequence: 1,
    session_id: 'session-1', task_id: 'task-1', operation_id: operationId, timestamp: 1 };
}

describe('canonical realtime event application', () => {
  beforeEach(() => {
    assistantRef.current = undefined;
    useChatStore.getState().resetChat();
    useChatStore.getState().selectSession('session-1', true);
    useChatStore.getState().setActiveTaskId('task-1');
    useChatStore.getState().setActiveOperationId(operationId);
    useChatStore.getState().beginTask();
    useChatStore.getState().setActiveTaskId('task-1');
    useChatStore.getState().setActiveOperationId(operationId);
  });

  it('applies stable text deltas and reports an offset gap for REST recovery', () => {
    const first: ServerPushEventV1 = { ...base(), event_id: 'text-1', event_type: 'text_delta',
      item_id: 'task:task-1:assistant', item_revision: 1, message_id: 'message-1',
      text_offset: 0, data: '完整' };
    const gap: ServerPushEventV1 = { ...first, event_id: 'text-2', sequence: 2,
      item_revision: 2, text_offset: 10, data: '缺口' };
    expect(applyAgentEvent(first, assistantRef)).toEqual({ recoveryRequired: false, terminalObserved: false });
    expect(applyAgentEvent(gap, assistantRef)).toEqual({ recoveryRequired: true, terminalObserved: false });
    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'task:task-1:assistant', content: '完整' }),
    ]);
  });

  it('merges tool events by the shared tool item id and revision', () => {
    const start: ServerPushEventV1 = { ...base(), event_id: 'tool-1', event_type: 'tool_execution_start',
      item_id: 'tool:call-1', item_revision: 1, data: { tool: 'search', tool_call_id: 'call-1' } };
    const end: ServerPushEventV1 = { ...base(), event_id: 'tool-2', sequence: 2,
      event_type: 'tool_execution_end', item_id: 'tool:call-1', item_revision: 2,
      data: { tool: 'search', tool_call_id: 'call-1', execution_id: 'exec-1', success: true,
        undo_available: true } };
    expect(applyAgentEvent(start, assistantRef).recoveryRequired).toBe(true);
    expect(applyAgentEvent(end, assistantRef).recoveryRequired).toBe(true);
    expect(useChatStore.getState().items.filter((item) => item.type === 'tool')).toEqual([
      expect.objectContaining({ id: 'tool:call-1', revision: 2, status: 'completed', execution_id: 'exec-1' }),
    ]);
  });

  it('requests authoritative tool views for pending approval task states', () => {
    const pending: ServerPushEventV1 = { ...base(), event_id: 'approval-1',
      event_type: 'tool_confirmation_pending', item_id: 'approval:confirmation-1', item_revision: 1,
      data: { confirmation_id: 'confirmation-1', tool_call_id: 'call-1', tool: 'send_message',
        request_summary: '发送消息', risk_level: 'high', expires_at: 1788682200000 } };
    const waiting: ServerPushEventV1 = { ...base(), event_id: 'state-waiting', sequence: 2,
      event_type: 'task_state', item_id: 'task:task-1:runtime', item_revision: 2,
      data: { state: 'waiting_tool_approval' } };

    expect(applyAgentEvent(pending, assistantRef).recoveryRequired).toBe(true);
    expect(applyAgentEvent(waiting, assistantRef).recoveryRequired).toBe(true);
  });

  it('refreshes tool views for every tool lifecycle event even when a view already exists', () => {
    useChatStore.getState().mergeSnapshot([], [{ session_id: 'session-1', tool_call_id: 'call-1',
      task_id: 'task-1', operation_id: operationId, tool_name: 'search', status: 'executing',
      version: 1, request_summary: '搜索', risk_level: 'low', allowed_actions: [] }]);
    const start: ServerPushEventV1 = { ...base(), event_id: 'tool-refresh',
      event_type: 'tool_execution_start', item_id: 'tool:call-1', item_revision: 2,
      data: { tool: 'search', tool_call_id: 'call-1' } };
    expect(applyAgentEvent(start, assistantRef).recoveryRequired).toBe(true);
  });

  it('keeps thinking separate and uses its offset/revision', () => {
    const event: ServerPushEventV1 = { ...base(), event_id: 'thinking-1', event_type: 'thinking_delta',
      item_id: 'task:task-1:thinking', item_revision: 1, text_offset: 0, data: '分析中' };
    applyAgentEvent(event, assistantRef);
    expect(useChatStore.getState().items).toEqual([
      expect.objectContaining({ id: 'task:task-1:thinking', revision: 1, type: 'thinking' }),
    ]);
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('reports terminal task state so use-chat can perform final REST reconciliation', () => {
    const event: ServerPushEventV1 = { ...base(), event_id: 'state-1', event_type: 'task_state',
      item_id: 'task:task-1:runtime', item_revision: 2, data: { state: 'completed' } };
    expect(applyAgentEvent(event, assistantRef)).toEqual({ recoveryRequired: false, terminalObserved: true });
    expect(useChatStore.getState().taskStatus).toBe('completed');
  });
});
