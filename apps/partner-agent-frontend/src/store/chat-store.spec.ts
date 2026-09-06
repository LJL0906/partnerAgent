import type { ChatItem, SessionToolView } from '@partner-agent/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyTextDeltaToStore, findSessionToolViewForItem, useChatStore } from './chat-store';

const operationId = '11111111-1111-4111-8111-111111111111';

function message(revision: number, content: string): Extract<ChatItem, { type: 'message' }> {
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

function candidate(
  revision: number,
  options: { authoritative?: boolean; sequence?: number } = {},
): Extract<ChatItem, { type: 'candidate' }> {
  return {
    schema_version: 1, id: 'candidate:candidate-1', type: 'candidate', status: 'pending',
    collapsed: true, created_at: 3, updated_at: revision, revision,
    sequence: options.sequence, session_id: 'session-1', task_id: 'task-1', operation_id: operationId,
    candidate_id: 'candidate-1', payload: {
      candidate_id: 'candidate-1', kind: 'action', preview: { title: '候选方案' }, applied: false,
      ...(options.authoritative ? { batch_ref: { kind: 'confirmation_batch', id: 'batch-1' } } : {}),
    },
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

  it('keeps reasoning before the assistant result when their timestamps tie', () => {
    const reasoning: ChatItem = {
      schema_version: 1, id: 'task:task-1:thinking', type: 'thinking', status: 'streaming',
      collapsed: true, created_at: 1, updated_at: 1, revision: 1,
      session_id: 'session-1', task_id: 'task-1', operation_id: operationId,
      payload: { text: '先分析', display: 'progress' },
    };
    const result = { ...message(1, '后回答'), sequence: undefined };

    useChatStore.getState().mergeSnapshot([result, reasoning], []);

    expect(useChatStore.getState().items.map((item) => item.type)).toEqual(['thinking', 'message']);
  });

  it('keeps restored reasoning above its assistant result even when the result has an earlier sequence and timestamp', () => {
    const user: ChatItem = {
      schema_version: 1, id: 'message:user-1', type: 'message', status: 'completed', collapsed: false,
      created_at: 0, updated_at: 0, revision: 1, sequence: 1, session_id: 'session-1', task_id: 'task-1',
      operation_id: operationId, message_id: 'user-1', payload: { role: 'user', content: '问题', format: 'text' },
    };
    const reasoning: ChatItem = {
      schema_version: 1, id: 'task:task-1:thinking', type: 'thinking', status: 'completed', collapsed: true,
      created_at: 2, updated_at: 2, revision: 1, session_id: 'session-1', task_id: 'task-1',
      operation_id: operationId, payload: { text: '先分析', display: 'summary' },
    };
    const result = { ...message(3, '后回答'), created_at: 1, sequence: 2 };

    useChatStore.getState().mergeSnapshot([result, reasoning, user], []);

    expect(useChatStore.getState().items.map((item) => item.id)).toEqual([
      'message:user-1', 'task:task-1:thinking', 'task:task-1:assistant',
    ]);
  });

  it('keeps each thinking item attached to its own assistant result across multiple turns', () => {
    const firstUser: ChatItem = {
      schema_version: 1, id: 'message:user-1', type: 'message', status: 'completed', collapsed: false,
      created_at: 1, updated_at: 1, revision: 1, sequence: 1, session_id: 'session-1', task_id: 'task-1',
      operation_id: operationId, message_id: 'user-1', payload: { role: 'user', content: '问题一', format: 'text' },
    };
    const firstThinking: ChatItem = {
      schema_version: 1, id: 'task:task-1:thinking', type: 'thinking', status: 'completed', collapsed: true,
      created_at: 3, updated_at: 3, revision: 1, session_id: 'session-1', task_id: 'task-1',
      operation_id: operationId, payload: { text: '分析一', display: 'summary' },
    };
    const firstAnswer = { ...message(3, '回答一'), created_at: 2, sequence: 2 };
    const secondUser: ChatItem = { ...firstUser, id: 'message:user-2', task_id: 'task-2', message_id: 'user-2',
      operation_id: '22222222-2222-4222-8222-222222222222', created_at: 4, updated_at: 4, sequence: 3,
      payload: { role: 'user', content: '问题二', format: 'text' } };
    const secondThinking: ChatItem = { ...firstThinking, id: 'task:task-2:thinking', task_id: 'task-2',
      operation_id: secondUser.operation_id, created_at: 6, updated_at: 6, payload: { text: '分析二', display: 'summary' } };
    const secondAnswer: ChatItem = { ...firstAnswer, id: 'task:task-2:assistant', task_id: 'task-2',
      operation_id: secondUser.operation_id, message_id: 'message-2', created_at: 5, updated_at: 5, sequence: 4,
      payload: { role: 'assistant', content: '回答二', format: 'markdown' } };

    useChatStore.getState().mergeSnapshot([
      secondThinking, firstAnswer, secondAnswer, firstThinking, secondUser, firstUser,
    ], []);

    expect(useChatStore.getState().items.map((item) => item.id)).toEqual([
      'message:user-1', 'task:task-1:thinking', 'task:task-1:assistant',
      'message:user-2', 'task:task-2:thinking', 'task:task-2:assistant',
    ]);
  });

  it('restores a persisted thinking summary before its assistant message', () => {
    useChatStore.getState().mergeSessionMessages([{
      id: 'assistant-restored', session_id: 'session-1', sequence: 2,
      role: 'assistant', content: '最终回答', status: 'complete', revision: 3,
      task_id: 'task-restored', operation_id: operationId,
      thinking_summary: '先比较两个候选，再整理最终回答。',
      created_at: '2026-09-07T00:00:00.000Z',
    }]);

    expect(useChatStore.getState().items).toEqual([
      expect.objectContaining({
        id: 'task:task-restored:thinking', type: 'thinking',
        payload: { text: '先比较两个候选，再整理最终回答。', display: 'summary' },
      }),
      expect.objectContaining({ id: 'task:task-restored:assistant', type: 'message' }),
    ]);
  });

  it('restores the same preview id without duplication and keeps the newer revision', () => {
    useChatStore.getState().mergeSnapshot([preview(1, '初版')], []);
    useChatStore.getState().mergeSnapshot([preview(1, '重复快照')], []);
    useChatStore.getState().mergeSnapshot([preview(2, '修订版')], []);

    expect(useChatStore.getState().items).toEqual([preview(2, '修订版')]);
  });

  it('deduplicates realtime and snapshot formal candidates by canonical identity', () => {
    const laterMessage: ChatItem = {
      ...message(1, '后续回复'), id: 'task:task-2:assistant', task_id: 'task-2',
      message_id: 'message-2', created_at: 4, sequence: 3,
    };
    useChatStore.getState().upsertItem(candidate(1, { sequence: 2 }));
    useChatStore.getState().mergeSnapshot([
      laterMessage, candidate(1, { authoritative: true, sequence: 2 }),
    ], []);

    expect(useChatStore.getState().items.map((item) => item.id)).toEqual([
      'task:task-2:assistant',
      'candidate:candidate-1',
    ]);
    expect(useChatStore.getState().items.find((item) => item.type === 'candidate')).toMatchObject({
      payload: { batch_ref: { id: 'batch-1' } },
    });
  });

  it('keeps a historical formal candidate at its assistant turn and removes its duplicate preview', () => {
    const firstAnswer = { ...message(3, '第一轮回答'), created_at: 2, sequence: 2 };
    const formalCandidate: ChatItem = {
      ...candidate(1), id: 'candidate:first', candidate_id: 'first', task_id: 'task-1',
      created_at: 3, payload: { candidate_id: 'first', kind: 'action',
        preview: { title: '第一轮候选' }, applied: false },
    };
    const firstPreview: ChatItem = {
      ...preview(1, '第一轮预览'), task_id: 'task-1', created_at: 3,
    };
    const secondUser: ChatItem = {
      schema_version: 1, id: 'message:user-2', type: 'message', status: 'completed', collapsed: false,
      created_at: 4, updated_at: 4, revision: 1, sequence: 3, session_id: 'session-1',
      task_id: 'task-2', operation_id: operationId, message_id: 'user-2',
      payload: { role: 'user', content: '第二轮问题', format: 'text' },
    };
    const secondAnswer: ChatItem = {
      ...message(3, '第二轮回答'), id: 'task:task-2:assistant', task_id: 'task-2',
      message_id: 'message-2', created_at: 5, sequence: 4,
    };
    const thirdUser: ChatItem = {
      ...secondUser, id: 'message:user-3', message_id: 'user-3', task_id: 'task-3',
      created_at: 7, updated_at: 7, sequence: 5, payload: { role: 'user', content: '第三轮问题', format: 'text' },
    };

    useChatStore.getState().mergeSnapshot([
      formalCandidate, thirdUser, firstPreview, secondAnswer, secondUser, firstAnswer,
    ], []);

    expect(useChatStore.getState().items.map((item) => item.id)).toEqual([
      'task:task-1:assistant', 'candidate:first',
      'message:user-2', 'task:task-2:assistant',
      'message:user-3',
    ]);
  });

  it('keeps an unanswered structured preview directly after its assistant reply', () => {
    const answer = { ...message(3, '需要你选择'), created_at: 2, sequence: 2 };
    const unansweredPreview: ChatItem = {
      ...preview(1, '待选择'), task_id: 'task-1', created_at: 3,
    };

    useChatStore.getState().mergeSnapshot([unansweredPreview, answer], []);

    expect(useChatStore.getState().items.map((item) => item.id)).toEqual([
      'task:task-1:assistant', 'preview:preview-1',
    ]);
  });

  it('keeps a structured preview at its original turn when the user replies', () => {
    useChatStore.getState().mergeSnapshot([
      { ...message(3, '需要你选择'), created_at: 2, sequence: 2 },
      { ...preview(1, '待选择'), task_id: 'task-1', created_at: 3 },
    ], []);

    useChatStore.getState().addMessage({ id: 'local-reply', role: 'user', content: '选择第二个' });

    expect(useChatStore.getState().items.map((item) => item.id)).toEqual([
      'task:task-1:assistant', 'preview:preview-1', 'local-reply',
    ]);
  });

  it('removes a stale preview omitted by the authoritative snapshot without deleting messages', () => {
    useChatStore.getState().upsertItem(message(2, '保留正文'));
    useChatStore.getState().upsertItem(preview(1, '旧预览'));

    useChatStore.getState().mergeSnapshot([message(2, '保留正文')], []);

    expect(useChatStore.getState().items).toEqual([message(2, '保留正文')]);
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
