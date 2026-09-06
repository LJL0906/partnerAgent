import type { DataSource, EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { ChatTaskEntity } from '../database/entities/chat-task.entity.js';
import { TypeOrmChatTaskRuntime } from './typeorm-chat-task-runtime.js';

describe('TypeOrmChatTaskRuntime runnable depth', () => {
  it('increments a persisted revision once for a visible release transition', async () => {
    const task = {
      id: 'task-1', ownerId: 'owner', sessionId: 'session-1',
      operationId: 'operation-1', state: 'running', revision: 6,
      leaseOwner: 'worker-1', leaseExpiresAt: new Date(Date.now() + 30_000),
      waitingToolConfirmationId: null,
    } as ChatTaskEntity;
    const taskRepository = {
      find: vi.fn(async () => [task]),
      save: vi.fn(async (value) => value),
    };
    const outboxRepository = {
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => value),
    };
    const manager = {
      getRepository: vi.fn((entity) =>
        entity === ChatTaskEntity ? taskRepository : outboxRepository,
      ),
    } as unknown as EntityManager;
    const runtime = new TypeOrmChatTaskRuntime(
      {
        transaction: vi.fn(async (work) => work(manager)),
      } as unknown as DataSource,
      vi.fn(),
    );

    await expect(runtime.releaseLeases('worker-1')).resolves.toBe(1);
    expect(task).toMatchObject({ state: 'queued', revision: 7 });
    expect(outboxRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'chat-task:task-1:revision:7',
        eventData: { revision: 7 },
      }),
    );
  });

  it('renews a lease without incrementing the task revision', async () => {
    const update = vi.fn(async () => ({ affected: 1 }));
    const runtime = new TypeOrmChatTaskRuntime(
      {
        getRepository: vi.fn(() => ({ update })),
      } as unknown as DataSource,
      vi.fn(),
    );

    await expect(
      runtime.renewLease('task-1', 'owner', 'worker-1', 30_000),
    ).resolves.toBe(true);
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('revision');
  });

  it('uses the authoritative runnable predicate with a bounded query', async () => {
    const query = vi.fn(async () => [{ count: '7' }]);
    const runtime = new TypeOrmChatTaskRuntime(
      { query } as unknown as DataSource,
      vi.fn(),
    );

    await expect(runtime.countRunnable(250)).resolves.toBe(7);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("active.state in"),
      [250],
    );
    expect(query.mock.calls[0]?.[0]).toContain('limit $1');
  });
});
