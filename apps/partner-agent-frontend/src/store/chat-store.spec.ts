import { describe, expect, it } from 'vitest';
import type { ChatItem } from '@partner-agent/contracts';
import { useChatStore } from './chat-store';

describe('chat item merge', () => {
  it('keeps observed terminal item status against late running events', () => {
    useChatStore.getState().resetChat();
    useChatStore.getState().setSessionId('s1');
    const base = { schema_version: 1 as const, session_id: 's1', task_id: 't1', operation_id: 'o1', created_at: 1, updated_at: 1, collapsed: true };
    useChatStore.getState().upsertItem({ ...base, id: 't1:call', type: 'tool', status: 'completed', tool_call_id: 'call', execution_id: 'exec', payload: { tool: 'search' } } as ChatItem);
    useChatStore.getState().upsertItem({ ...base, id: 't1:call', type: 'tool', status: 'running', tool_call_id: 'call', payload: { tool: 'search' } } as ChatItem);
    expect(useChatStore.getState().items[0].status).toBe('completed');
  });
});
