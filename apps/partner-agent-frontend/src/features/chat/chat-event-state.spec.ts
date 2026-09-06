import { vi } from 'vitest';
vi.mock('expo-crypto', () => ({ randomUUID: () => 'assistant-1' }));
import { describe, expect, it } from 'vitest';
import type { CandidateEventV1, ChatItem, ServerPushEventV1 } from '@partner-agent/contracts';
import { mapServerPushEventToChatItems } from './chat-event-routing';

describe('ChatItem event routing', () => {
  it('maps event types into distinct canonical item types', () => {
    const base = { schema_version: 1 as const, event_id: 'e1', channel: 'session:s1' as const, sequence: 1, session_id: 's1', task_id: 't1', operation_id: 'o1', timestamp: 1 };
    const candidate: CandidateEventV1 = {
      ...base,
      event_type: 'candidate',
      data: {
        analysis_ref: { kind: 'analysis_run', id: 'analysis-1' },
        batch_ref: { kind: 'confirmation_batch', id: 'batch-1' },
        candidate_refs: [{ kind: 'candidate', id: 'candidate-1' }],
        task_ref: { kind: 'analysis', task_id: 'task-1', analysis_run_id: 'analysis-1', analysis_types: ['action'] },
        candidate_count: 1,
        risk_level: 'normal',
        safe_summary: '候选摘要',
        occurred_at: 1,
      },
    };
    const events: ServerPushEventV1[] = [
      { ...base, event_type: 'thinking_delta', data: 'think' },
      { ...base, event_id: 'e2', event_type: 'tool_execution_start', data: { tool: 'search', tool_call_id: 'c1' } },
      candidate,
      { ...base, event_id: 'e4', event_type: 'error', data: { code: 'E', message: 'bad' } },
    ];
    expect(events.flatMap(mapServerPushEventToChatItems).map((entry) => (entry as ChatItem).type)).toEqual(['thinking', 'tool', 'candidate', 'error']);
  });
});




import { applyAgentEvent } from './chat-event-state';
import { useChatStore } from '@/store/chat-store';

describe('canonical realtime event application', () => {
  it('does not create legacy duplicate thinking or tool cards', () => {
    useChatStore.getState().resetChat();
    useChatStore.getState().setSessionId('s1');
    const ref = { current: undefined as string | undefined };
    const base = { schema_version: 1 as const, channel: 'session:s1' as const, session_id: 's1', task_id: 't1', operation_id: 'o1', sequence: 1, timestamp: 10 };
    applyAgentEvent({ ...base, event_id: 'think-1', event_type: 'thinking_delta', data: 'abc' }, ref);
    applyAgentEvent({ ...base, event_id: 'tool-1', event_type: 'tool_execution_start', data: { tool: 'search', tool_call_id: 'call-1' } }, ref);
    const items = useChatStore.getState().items;
    expect(items.filter((item) => item.type === 'thinking')).toHaveLength(1);
    expect(items.filter((item) => item.type === 'tool')).toHaveLength(1);
  });

  it('merges tool completion and undo by stable call/execution identity', () => {
    useChatStore.getState().resetChat();
    useChatStore.getState().setSessionId('s1');
    const ref = { current: undefined as string | undefined };
    const base = { schema_version: 1 as const, channel: 'session:s1' as const, session_id: 's1', task_id: 't1', operation_id: 'o1', sequence: 1, timestamp: 10 };
    applyAgentEvent({ ...base, event_id: 'tool-1', event_type: 'tool_execution_start', data: { tool: 'search', tool_call_id: 'call-1' } }, ref);
    applyAgentEvent({ ...base, event_id: 'tool-2', event_type: 'tool_execution_end', data: { tool: 'search', tool_call_id: 'call-1', execution_id: 'exec-1', success: true, undo_available: true } }, ref);
    applyAgentEvent({ ...base, event_id: 'undo-1', event_type: 'tool_undo_available', data: { tool: 'search', execution_id: 'exec-1', expires_at: 20 } }, ref);
    expect(useChatStore.getState().items.filter((item) => item.type === 'tool')).toHaveLength(1);
    expect(useChatStore.getState().items[0]).toMatchObject({ tool_call_id: 'call-1', execution_id: 'exec-1', status: 'completed' });
  });
});



describe('canonical live item updates', () => {
  it('does not duplicate a tool item when start and end events arrive', () => {
    useChatStore.setState({ sessionId: 's1', activeTaskId: 't1', activeOperationId: 'o1', items: [], messages: [], taskStatus: 'queued' });
    const ref: { current: string | undefined } = { current: undefined };
    applyAgentEvent({ schema_version: 1, event_id: 'start', event_type: 'tool_execution_start', channel: 'task:t1', sequence: 1, session_id: 's1', task_id: 't1', operation_id: 'o1', timestamp: 1, data: { tool: 'search', tool_call_id: 'call-1' } }, ref);
    applyAgentEvent({ schema_version: 1, event_id: 'end', event_type: 'tool_execution_end', channel: 'task:t1', sequence: 2, session_id: 's1', task_id: 't1', operation_id: 'o1', timestamp: 2, data: { tool: 'search', tool_call_id: 'call-1', success: true, execution_id: 'exec-1', undo_available: true } }, ref);
    expect(useChatStore.getState().items.filter((item) => item.type === 'tool')).toHaveLength(1);
    expect(useChatStore.getState().items.find((item) => item.type === 'tool')?.status).toBe('completed');
  });

  it('keeps thinking as a separate item without an empty assistant bubble', () => {
    useChatStore.setState({ sessionId: 's1', activeTaskId: 't1', activeOperationId: 'o1', items: [], messages: [], taskStatus: 'queued' });
    const ref: { current: string | undefined } = { current: undefined };
    applyAgentEvent({ schema_version: 1, event_id: 'think', event_type: 'thinking_delta', channel: 'task:t1', sequence: 1, session_id: 's1', task_id: 't1', operation_id: 'o1', timestamp: 1, data: '分析中' }, ref);
    expect(useChatStore.getState().items.filter((item) => item.type === 'thinking')).toHaveLength(1);
    expect(useChatStore.getState().items.filter((item) => item.type === 'message')).toHaveLength(0);
  });
});
