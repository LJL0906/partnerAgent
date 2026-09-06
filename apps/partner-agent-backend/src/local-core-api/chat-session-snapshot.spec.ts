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
});
