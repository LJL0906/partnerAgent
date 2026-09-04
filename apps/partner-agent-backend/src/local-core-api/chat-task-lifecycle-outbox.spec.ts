import type { DataSource, EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { TypeOrmChatTaskLifecycleOutbox } from './chat-task-lifecycle-outbox.js';

describe('TypeOrmChatTaskLifecycleOutbox', () => {
  it('claims with SKIP LOCKED, lease fencing and a maximum-attempt guard', async () => {
    const managerQuery = vi.fn(async (sql: string) =>
      sql.startsWith('select *') ? [] : [],
    );
    const transaction = vi.fn(
      async (work: (manager: EntityManager) => unknown) =>
        work({ query: managerQuery } as unknown as EntityManager),
    );
    const outbox = new TypeOrmChatTaskLifecycleOutbox({
      transaction,
    } as unknown as DataSource);

    await expect(
      outbox.claim('00000000-0000-4000-8000-000000000001', 25, 30_000, 8),
    ).resolves.toEqual([]);
    expect(managerQuery).toHaveBeenCalledWith(
      expect.stringContaining('for update skip locked'),
      [8, 25],
    );
    expect(managerQuery.mock.calls[0]?.[0]).toContain('attempt_count < $1');
  });

  it('allows only the current lease token to acknowledge or retry', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[], 0])
      .mockResolvedValueOnce([[{ event_id: 'event-1' }], 1]);
    const outbox = new TypeOrmChatTaskLifecycleOutbox({ query } as unknown as DataSource);
    const event = {
      eventId: 'event-1',
      eventKey: 'stable-key',
      ownerId: 'owner',
      taskId: 'task',
      operationId: 'operation',
      sessionId: 'session',
      state: 'failed' as const,
      data: {},
      attemptCount: 8,
      leaseOwner: '00000000-0000-4000-8000-000000000001',
      leaseToken: '3',
    };

    await expect(outbox.acknowledge(event)).resolves.toBe(false);
    await expect(outbox.fail(event, 1_000)).resolves.toBe(true);
    for (const call of query.mock.calls) {
      expect(call[0]).toContain('lease_owner = $2 and lease_token = $3');
    }
  });
});
