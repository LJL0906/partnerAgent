import { describe, expect, it, vi } from 'vitest';
import { InMemoryObservabilitySink } from '../observability/observability.types.js';
import type { ChatTaskStore } from './chat-task.store.js';
import { ChatTaskSchedulerObservability } from './chat-task-scheduler-observability.js';

describe('ChatTaskSchedulerObservability', () => {
  it('records lease recovery, claims, drained queue and stale fences', async () => {
    const sink = new InMemoryObservabilitySink();
    const metrics = new ChatTaskSchedulerObservability(sink);
    const store = {
      recoverExpiredLeases: vi.fn().mockResolvedValue(2),
      countRunnable: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(0),
      claimNextRunnable: vi.fn().mockResolvedValue(undefined),
      renewLease: vi.fn().mockResolvedValue(false),
    } as unknown as ChatTaskStore;

    await metrics.recoverExpired(store);
    await metrics.claim(store, 'worker-a', 1_000);
    await metrics.renew(store, 'task-a', 'owner-a', 'worker-a', 1_000);

    expect(sink.events).toEqual([
      { kind: 'chat_task_lease_expired', count: 2 },
      { kind: 'chat_task_queue_depth', depth: 3 },
      { kind: 'chat_task_claim', result: 'empty' },
      { kind: 'chat_task_queue_depth', depth: 0 },
      { kind: 'chat_task_fence_rejected', operation: 'renew' },
    ]);
  });

  it('never lets a metrics failure alter scheduler store results', async () => {
    const metrics = new ChatTaskSchedulerObservability({
      record() {
        throw new Error('metrics unavailable');
      },
    });
    const store = {
      countRunnable: vi.fn().mockRejectedValue(new Error('depth unavailable')),
      claimNextRunnable: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatTaskStore;
    await expect(
      metrics.claim(store, 'worker-a', 1_000),
    ).resolves.toBeUndefined();
    expect(store.claimNextRunnable).toHaveBeenCalledOnce();
  });
});
