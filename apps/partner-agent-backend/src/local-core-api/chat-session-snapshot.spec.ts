import { describe, expect, it, vi } from 'vitest';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { getChatSessionSnapshot } from './chat-session-snapshot.js';
import { MemoryChatTaskStore } from './memory-chat-task.store.js';

describe('getChatSessionSnapshot task revisions', () => {
  it('restores formal candidates at their owning assistant message sequence', async () => {
    const session = {
      id: 'session-chat-preview-only', ownerId: 'owner', title: '预览', messages: [],
      createdAt: new Date('2026-09-06T00:00:00.000Z'),
      lastActiveAt: new Date('2026-09-06T00:00:00.000Z'),
    };
    const messages = [{
      id: 'assistant-1', session_id: session.id, sequence: 2, role: 'assistant', content: '请选择',
      status: 'complete', revision: 1, task_id: 'task-1', operation_id: 'operation-1',
      created_at: '2026-09-06T00:00:01.000Z',
    }];
    const listSessionFormalCandidates = vi.fn(async () => [{
      candidate_id: 'formal-1', batch_id: 'batch-1', session_id: session.id,
      task_id: 'task-1', operation_id: 'operation-1', kind: 'action',
      payload: { title: '提交周报' }, source_refs: [], confidence: 0.9,
      risk: 'normal', version: 1, created_at: new Date('2026-09-06T00:00:02.000Z'),
    }]);
    const tasks = {
      listSessionMessages: vi.fn(async () => messages),
      getSessionTaskRefs: vi.fn(async () => ({})),
      getTask: vi.fn(async () => undefined),
      listSessionChatPreviews: vi.fn(async () => []),
      listSessionFormalCandidates,
    };

    const snapshot = await getChatSessionSnapshot(
      { userId: 'owner', input: { session_id: session.id } } as never,
      { sessions: { find: vi.fn(async () => session) } as never, tasks: tasks as never },
    );

    expect(listSessionFormalCandidates).toHaveBeenCalledWith('owner', session.id);
    expect(snapshot.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'candidate:formal-1', type: 'candidate', sequence: 2, task_id: 'task-1',
      }),
    ]));
  });

  it('restores historical previews even after a later user reply', async () => {
    const session = {
      id: 'session-unanswered-preview', ownerId: 'owner', title: '预览', messages: [],
      createdAt: new Date('2026-09-06T00:00:00.000Z'),
      lastActiveAt: new Date('2026-09-06T00:00:04.000Z'),
    };
    const messages = [
      { id: 'user-1', session_id: session.id, sequence: 1, role: 'user', content: '第一问',
        status: 'complete', revision: 1, created_at: '2026-09-06T00:00:01.000Z' },
      { id: 'assistant-1', session_id: session.id, sequence: 2, role: 'assistant', content: '第一答',
        status: 'complete', revision: 1, task_id: 'task-1', operation_id: 'operation-1',
        created_at: '2026-09-06T00:00:02.000Z' },
      { id: 'user-2', session_id: session.id, sequence: 3, role: 'user', content: '继续说明',
        status: 'complete', revision: 1, created_at: '2026-09-06T00:00:03.000Z' },
      { id: 'assistant-2', session_id: session.id, sequence: 4, role: 'assistant', content: '第二答',
        status: 'complete', revision: 1, task_id: 'task-2', operation_id: 'operation-2',
        created_at: '2026-09-06T00:00:04.000Z' },
    ];
    const makePreview = (previewId: string, messageId: string, taskId: string, operationId: string) => ({
      session_id: session.id, task_id: taskId, operation_id: operationId,
      message_id: messageId, message_revision: 1,
      preview: { schema_version: 1 as const, preview_id: previewId, kind: 'action' as const,
        confirmation_status: 'unconfirmed' as const, applied: false as const,
        source_refs: [{ kind: 'chat_message' as const, id: messageId }],
        content: { title: previewId, confidence: 0.5 }, warnings: [] },
    });
    const tasks = {
      listSessionMessages: vi.fn(async () => messages),
      getSessionTaskRefs: vi.fn(async () => ({})),
      getTask: vi.fn(async () => undefined),
      listSessionChatPreviews: vi.fn(async () => [
        makePreview('old-preview', 'assistant-1', 'task-1', 'operation-1'),
        makePreview('current-preview', 'assistant-2', 'task-2', 'operation-2'),
      ]),
      listSessionFormalCandidates: vi.fn(async () => []),
    };

    const snapshot = await getChatSessionSnapshot(
      { userId: 'owner', input: { session_id: session.id } } as never,
      { sessions: { find: vi.fn(async () => session) } as never, tasks: tasks as never },
    );

    expect(snapshot.items.filter((item) => item.type === 'structured_preview').map(
      (item) => item.type === 'structured_preview' ? item.preview_id : undefined,
    )).toEqual(['old-preview', 'current-preview']);
  });

  it('uses the stored task revision instead of the updated-at timestamp', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T00:00:00.000Z'));
    try {
      const sessions = new MemorySessionStore();
      const tasks = new MemoryChatTaskStore(sessions);
      const accepted = await tasks.submitText({
        ownerId: 'owner',
        operationId: 'operation-snapshot-revision',
        requestFingerprint: 'fingerprint-snapshot-revision',
        clientSource: 'web',
        text: '持久修订号',
        inputId: 'input-snapshot-revision',
        sessionId: 'session-snapshot-revision',
      });
      const running = await tasks.claimNextRunnable('worker-snapshot', 30_000);
      await tasks.markWaiting(
        running!.taskId,
        running!.ownerId,
        'worker-snapshot',
      );

      const snapshot = await getChatSessionSnapshot(
        {
          userId: 'owner',
          input: { session_id: accepted.task!.sessionId },
        } as never,
        { sessions, tasks },
      );

      expect(
        snapshot.items.find((item) => item.id === `task:${running!.taskId}:runtime`),
      ).toMatchObject({ revision: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the complete runtime projection stable across a lease heartbeat', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T00:00:00.000Z'));
    try {
      const sessions = new MemorySessionStore();
      const tasks = new MemoryChatTaskStore(sessions);
      const accepted = await tasks.submitText({
        ownerId: 'owner',
        operationId: 'operation-heartbeat-projection',
        requestFingerprint: 'fingerprint-heartbeat-projection',
        clientSource: 'web',
        text: '心跳不改变公开投影',
        inputId: 'input-heartbeat-projection',
        sessionId: 'session-heartbeat-projection',
      });
      const running = await tasks.claimNextRunnable('worker-heartbeat', 30_000);
      const request = {
        userId: 'owner',
        input: { session_id: accepted.task!.sessionId },
      } as never;
      const before = await getChatSessionSnapshot(request, { sessions, tasks });

      vi.advanceTimersByTime(1_000);
      await expect(tasks.renewLease(
        running!.taskId,
        running!.ownerId,
        'worker-heartbeat',
        30_000,
      )).resolves.toBe(true);
      const after = await getChatSessionSnapshot(request, { sessions, tasks });

      expect(after).toEqual(before);

      vi.advanceTimersByTime(1_000);
      await expect(tasks.markWaiting(
        running!.taskId,
        running!.ownerId,
        'worker-heartbeat',
      )).resolves.toBe(true);
      const lifecycle = await getChatSessionSnapshot(request, { sessions, tasks });
      expect(lifecycle.items.find(
        (item) => item.id === `task:${running!.taskId}:runtime`,
      )).toMatchObject({ revision: 3, updated_at: 1_788_652_802_000 });
    } finally {
      vi.useRealTimers();
    }
  });
});
