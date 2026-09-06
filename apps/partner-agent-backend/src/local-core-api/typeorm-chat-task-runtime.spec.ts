import type { DataSource, EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { ChatTaskEntity } from '../database/entities/chat-task.entity.js';
import { buildChatItemsSnapshot } from './chat-item-adapter.js';
import { TypeOrmChatTaskRuntime } from './typeorm-chat-task-runtime.js';

describe('TypeOrmChatTaskRuntime runnable depth', () => {
  it('increments a persisted revision once for a visible release transition', async () => {
    const priorUpdatedAt = new Date('2026-09-06T00:00:00.000Z');
    const task = {
      id: 'task-1', ownerId: 'owner', sessionId: 'session-1',
      operationId: 'operation-1', state: 'running', revision: 6,
      leaseOwner: 'worker-1', leaseExpiresAt: new Date(Date.now() + 30_000),
      waitingToolConfirmationId: null, updatedAt: priorUpdatedAt,
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
    expect(task.updatedAt.getTime()).toBeGreaterThan(priorUpdatedAt.getTime());
    expect(outboxRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'chat-task:task-1:revision:7',
        eventData: { revision: 7 },
      }),
    );
  });

  it('renews only the lease expiry without changing the public task projection', async () => {
    const task = {
      id: 'task-1',
      ownerId: 'owner',
      sessionId: 'session-1',
      operationId: 'operation-1',
      state: 'running',
      revision: 6,
      updatedAt: new Date('2026-09-06T08:00:00.000Z'),
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 30_000),
    } as ChatTaskEntity;
    const project = () => buildChatItemsSnapshot({
      messages: [],
      tasks: [{
        taskId: task.id,
        sessionId: task.sessionId,
        operationId: task.operationId,
        state: task.state,
        revision: task.revision,
        updatedAt: task.updatedAt,
      }],
      toolViews: [],
      previews: [],
    });
    const update = vi.fn(async (_criteria, patch: Partial<ChatTaskEntity>) => {
      if (patch.leaseExpiresAt) task.leaseExpiresAt = patch.leaseExpiresAt;
      if (patch.updatedAt) task.updatedAt = patch.updatedAt;
      return { affected: 1 };
    });
    const runtime = new TypeOrmChatTaskRuntime(
      {
        getRepository: vi.fn(() => ({ update })),
      } as unknown as DataSource,
      vi.fn(),
    );

    const before = project();
    await expect(
      runtime.renewLease('task-1', 'owner', 'worker-1', 30_000),
    ).resolves.toBe(true);
    expect(project()).toEqual(before);
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('revision');
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('updatedAt');
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
