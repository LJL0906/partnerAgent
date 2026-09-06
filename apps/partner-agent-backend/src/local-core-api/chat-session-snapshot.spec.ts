import { describe, expect, it, vi } from 'vitest';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { getChatSessionSnapshot } from './chat-session-snapshot.js';
import { MemoryChatTaskStore } from './memory-chat-task.store.js';

describe('getChatSessionSnapshot task revisions', () => {
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
