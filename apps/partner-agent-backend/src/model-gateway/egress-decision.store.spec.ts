import type { DataSource, EntityManager } from 'typeorm';
import { describe, expect, it } from 'vitest';
import {
  EgressDecisionConflictError,
  EgressDecisionExpiredError,
  EgressDecisionIdempotencyConflictError,
} from './egress-decision.store.js';
import { MemoryEgressDecisionStore } from './memory-egress-decision.store.js';
import { TypeOrmEgressDecisionStore } from './typeorm-egress-decision.store.js';

const binding = {
  ownerId: 'owner-1',
  taskId: '10000000-0000-4000-8000-000000000001',
  sessionId: 'session-1',
  operationId: 'task-operation-1',
  requestFingerprint: 'fingerprint-1',
  provider: 'deepseek',
  modelId: 'deepseek-chat',
  source: 'pi_agent',
  categories: ['password'] as const,
  ttlMs: 900_000,
};

describe('MemoryEgressDecisionStore', () => {
  it('reuses the same active payload and invalidates a changed payload', async () => {
    let id = 0;
    const store = new MemoryEgressDecisionStore(
      () => new Date('2026-09-04T00:00:00Z'),
      () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    );
    const first = await store.createOrGetPending(binding);
    expect((await store.createOrGetPending(binding)).id).toBe(first.id);

    const changed = await store.createOrGetPending({
      ...binding,
      requestFingerprint: 'fingerprint-2',
    });
    expect(changed.id).not.toBe(first.id);
    expect(
      (await store.findByIdForOwner(first.id, binding.ownerId))?.state,
    ).toBe('cancelled');
    expect(
      await store.findByIdForOwner(first.id, 'another-owner'),
    ).toBeUndefined();
  });

  it('atomically accepts one decision, replays it, and consumes allow once', async () => {
    const store = new MemoryEgressDecisionStore();
    const pending = await store.createOrGetPending(binding);
    const input = {
      ownerId: binding.ownerId,
      egressId: pending.id,
      decision: 'allow' as const,
      commandOperationId: 'decision-operation-1',
      commandRequestFingerprint: 'decision-fingerprint-1',
    };
    const attempts = await Promise.allSettled([
      store.submitDecision(input),
      store.submitDecision({
        ...input,
        commandOperationId: 'decision-operation-2',
      }),
    ]);
    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      attempts[1].status === 'rejected' && attempts[1].reason,
    ).toBeInstanceOf(EgressDecisionConflictError);

    const replay = await store.submitDecision(input);
    expect(replay.result.status).toBe('duplicate');
    await expect(
      store.submitDecision({
        ...input,
        commandRequestFingerprint: 'different-command',
      }),
    ).rejects.toBeInstanceOf(EgressDecisionIdempotencyConflictError);

    const consumed = await store.consumeMatchingDecision(binding);
    expect(consumed.status).toBe('consumed');
    expect((await store.consumeMatchingDecision(binding)).status).toBe(
      'missing',
    );
  });

  it('uses the injected clock for expiry and never makes an expired request ready', async () => {
    let now = new Date('2026-09-04T00:00:00Z');
    const store = new MemoryEgressDecisionStore(() => new Date(now));
    const pending = await store.createOrGetPending({
      ...binding,
      ttlMs: 1_000,
    });
    now = new Date('2026-09-04T00:00:01Z');
    await expect(
      store.submitDecision({
        ownerId: binding.ownerId,
        egressId: pending.id,
        decision: 'allow',
        commandOperationId: 'late-operation',
        commandRequestFingerprint: 'late-fingerprint',
      }),
    ).rejects.toBeInstanceOf(EgressDecisionExpiredError);
    expect(
      (await store.findByIdForOwner(pending.id, binding.ownerId))?.state,
    ).toBe('expired');
  });

  it('lists recoverable decisions and cancels ready decisions with the task', async () => {
    const store = new MemoryEgressDecisionStore();
    const pending = await store.createOrGetPending(binding);
    await store.submitDecision({
      ownerId: binding.ownerId,
      egressId: pending.id,
      decision: 'redact',
      commandOperationId: 'redact-operation',
      commandRequestFingerprint: 'redact-fingerprint',
    });
    expect(await store.listRecoverableDecisions()).toHaveLength(1);
    const cancelled = await store.cancelPendingForTask(
      binding.taskId,
      binding.ownerId,
    );
    expect(cancelled[0].state).toBe('cancelled');
    expect(await store.listRecoverableDecisions()).toHaveLength(0);
  });
});

describe('TypeOrmEgressDecisionStore', () => {
  it('locks the row and writes the decision and operation using database time in one transaction', async () => {
    const sql: string[] = [];
    const row = databaseRow();
    const manager = {
      query: async (statement: string) => {
        const normalized = statement.replace(/\s+/g, ' ').trim().toLowerCase();
        sql.push(normalized);
        if (normalized.startsWith('select pg_advisory')) return [];
        if (normalized.startsWith('select * from local_core_operations'))
          return [];
        if (normalized.includes('as database_now'))
          return [{ ...row, database_now: new Date('2026-09-04T00:01:00Z') }];
        if (normalized.startsWith('update egress_decision_requests'))
          return [
            [
              {
                ...row,
                state: 'ready_allow',
                decision: 'allow',
                version: 2,
                decided_at: new Date('2026-09-04T00:01:00Z'),
                updated_at: new Date('2026-09-04T00:01:00Z'),
              },
            ],
            1,
          ];
        return [[], 0];
      },
    } as unknown as EntityManager;
    const dataSource = {
      transaction: async <T>(run: (value: EntityManager) => Promise<T>) =>
        run(manager),
    } as unknown as DataSource;
    const store = new TypeOrmEgressDecisionStore(dataSource);
    const result = await store.submitDecision({
      ownerId: binding.ownerId,
      egressId: String(row.id),
      decision: 'allow',
      commandOperationId: 'decision-operation',
      commandRequestFingerprint: 'decision-fingerprint',
    });
    expect(result.record.state).toBe('ready_allow');
    expect(sql.some((statement) => statement.endsWith('for update'))).toBe(
      true,
    );
    expect(sql.join('\n')).toContain("'submitprivacydecision'");
    expect(sql.join('\n')).toContain('transaction_timestamp()');
  });

  it('expires due rows with database time and skip-locked concurrency', async () => {
    let statement = '';
    const dataSource = {
      query: async (sql: string) => {
        statement = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        return [];
      },
    } as unknown as DataSource;
    await expect(
      new TypeOrmEgressDecisionStore(dataSource).expireDue(10),
    ).resolves.toEqual([]);
    expect(statement).toContain('expires_at <= transaction_timestamp()');
    expect(statement).toContain('for update skip locked');
  });
});

function databaseRow() {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    owner_id: binding.ownerId,
    task_id: binding.taskId,
    session_id: binding.sessionId,
    operation_id: binding.operationId,
    request_fingerprint: binding.requestFingerprint,
    provider: binding.provider,
    model_id: binding.modelId,
    source: binding.source,
    categories: ['password'],
    state: 'pending',
    decision: null,
    version: 1,
    created_at: new Date('2026-09-04T00:00:00Z'),
    updated_at: new Date('2026-09-04T00:00:00Z'),
    expires_at: new Date('2026-09-04T00:15:00Z'),
    decided_at: null,
    consumed_at: null,
  };
}
