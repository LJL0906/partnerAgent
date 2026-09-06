import type { ChatItem, SessionToolView } from '@partner-agent/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyTextDeltaToStore, findSessionToolViewForItem, useChatStore } from './chat-store';

const operationId = '11111111-1111-4111-8111-111111111111';

function message(revision: number, content: string): ChatItem {
  return {
    schema_version: 1, id: 'task:task-1:assistant', type: 'message',
    status: revision >= 3 ? 'completed' : 'streaming', collapsed: false,
    created_at: 1, updated_at: revision, revision, sequence: 2,
    session_id: 'session-1', task_id: 'task-1', operation_id: operationId,
    message_id: 'message-1', payload: { role: 'assistant', content, format: 'markdown' },
  };
}

function preview(revision: number, title: string, sessionId = 'session-1'): ChatItem {
  return {
    schema_version: 1, id: 'preview:preview-1', type: 'structured_preview', status: 'completed',
    collapsed: true, created_at: 3, updated_at: revision, revision,
    session_id: sessionId, task_id: 'task-1', operation_id: operationId,
    message_id: 'message-1', preview_id: 'preview-1',
    payload: { schema_version: 1, preview_id: 'preview-1', kind: 'action',
      confirmation_status: 'unconfirmed', applied: false,
      source_refs: [{ kind: 'chat_message', id: 'message-1' }],
      content: { title, confidence: 0.8 }, warnings: [] },
  };
}

describe('chat item revision merge', () => {
  beforeEach(() => {
    useChatStore.getState().resetChat();
    useChatStore.getState().selectSession('session-1', true);
  });

  it('keeps a newer realtime item when an older snapshot arrives later', () => {
    useChatStore.getState().upsertItem(message(2, '💡新正文'));
    useChatStore.getState().mergeSnapshot([message(1, '旧正文')], []);
    expect(useChatStore.getState().items).toEqual([message(2, '💡新正文')]);
  });

  it('does not delete a newer item omitted from a snapshot', () => {
    useChatStore.getState().upsertItem(message(2, '实时正文'));
    useChatStore.getState().mergeSnapshot([], []);
    expect(useChatStore.getState().items).toHaveLength(1);
  });

  it('applies only a contiguous UTF-16 delta and rejects a gap without mutation', () => {
    expect(applyTextDeltaToStore({ itemId: 'task:task-1:assistant', itemRevision: 1,
      messageId: 'message-1', textOffset: 0, data: '💡', sessionId: 'session-1',
      taskId: 'task-1', operationId, timestamp: 1 })).toBe('applied');
    expect(applyTextDeltaToStore({ itemId: 'task:task-1:assistant', itemRevision: 2,
      messageId: 'message-1', textOffset: 1, data: '错位', sessionId: 'session-1',
      taskId: 'task-1', operationId, timestamp: 2 })).toBe('recovery_required');
    expect(useChatStore.getState().items[0]).toMatchObject({ revision: 1, payload: { content: '💡' } });
    expect(applyTextDeltaToStore({ itemId: 'task:task-1:assistant', itemRevision: 2,
      messageId: 'message-1', textOffset: 2, data: '继续', sessionId: 'session-1',
      taskId: 'task-1', operationId, timestamp: 2 })).toBe('applied');
    expect(useChatStore.getState().items[0]).toMatchObject({ revision: 2, payload: { content: '💡继续' } });
  });

  it('deduplicates the same item revision delivered on multiple channels', () => {
    const delta = { itemId: 'task:task-1:assistant', itemRevision: 1, messageId: 'message-1',
      textOffset: 0, data: '唯一', sessionId: 'session-1', taskId: 'task-1', operationId,
      timestamp: 1 };
    expect(applyTextDeltaToStore(delta)).toBe('applied');
    expect(applyTextDeltaToStore(delta)).toBe('ignored');
    expect(useChatStore.getState().messages[0]?.content).toBe('唯一');
  });

  it('restores the same preview id without duplication and keeps the newer revision', () => {
    useChatStore.getState().mergeSnapshot([preview(1, '初版')], []);
    useChatStore.getState().mergeSnapshot([preview(1, '重复快照')], []);
    useChatStore.getState().mergeSnapshot([preview(2, '修订版')], []);

    expect(useChatStore.getState().items).toEqual([preview(2, '修订版')]);
  });

  it('clears another session preview and restores the original preview from its snapshot', () => {
    useChatStore.getState().mergeSnapshot([preview(1, '原会话')], []);
    useChatStore.getState().selectSession('session-2', true);
    expect(useChatStore.getState().items).toEqual([]);
    useChatStore.getState().mergeSnapshot([preview(1, '错误会话', 'session-1')], []);
    expect(useChatStore.getState().items).toEqual([]);

    useChatStore.getState().selectSession('session-1', true);
    useChatStore.getState().mergeSnapshot([preview(1, '原会话')], []);
    expect(useChatStore.getState().items).toEqual([preview(1, '原会话')]);
  });
});

describe('tool view authority', () => {
  it('merges by tool_call_id and version and resolves a view for its item', () => {
    useChatStore.getState().resetChat();
    useChatStore.getState().selectSession('session-1', true);
    const older: SessionToolView = { session_id: 'session-1', tool_call_id: 'call-1',
      confirmation_id: 'confirmation-1', task_id: 'task-1', operation_id: operationId,
      tool_name: 'send_message', status: 'pending', version: 1, request_summary: '发送',
      risk_level: 'high', allowed_actions: ['confirm', 'dismiss'] };
    const newer: SessionToolView = { ...older, execution_id: 'execution-1', status: 'succeeded',
      version: 2, allowed_actions: ['undo'], result_summary: '已发送' };
    useChatStore.getState().mergeSnapshot([], [newer]);
    useChatStore.getState().mergeSnapshot([], [older]);
    const item: ChatItem = { schema_version: 1, id: 'tool:call-1', type: 'tool', status: 'completed',
      collapsed: true, created_at: 1, updated_at: 2, revision: 2, session_id: 'session-1',
      task_id: 'task-1', operation_id: operationId, tool_call_id: 'call-1', execution_id: 'execution-1',
      payload: { tool: 'send_message', output_summary: '已发送' } };
    expect(findSessionToolViewForItem(useChatStore.getState().toolViews, item)).toEqual(newer);
  });
});
