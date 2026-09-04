import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { TypeOrmEgressAuditStore } from './egress-audit.store.js';
import { CreateEgressAuditLogs1788502000000 } from './migrations/1788502000000-create-egress-audit-logs.js';

describe('TypeOrmEgressAuditStore', () => {
  it('persists only the approved metadata fields', async () => {
    const inserted: unknown[] = [];
    const dataSource = {
      getRepository: () => ({
        insert: async (value: unknown) => {
          inserted.push(value);
        },
      }),
    } as unknown as DataSource;
    const store = new TypeOrmEgressAuditStore(dataSource);
    await store.record({
      requestId: '10000000-0000-4000-8000-000000000001',
      egressId: '30000000-0000-4000-8000-000000000001',
      ownerId: 'owner-1',
      sessionId: 'session-1',
      taskId: '20000000-0000-4000-8000-000000000001',
      operationId: 'operation-1',
      requestFingerprint: 'sha256:fingerprint',
      source: 'pi_agent',
      categories: ['password', 'api_key'],
      decision: 'redacted',
      provider: 'deepseek',
      modelId: 'deepseek-chat',
      createdAt: new Date('2026-09-04T00:00:00Z'),
      payload: 'password=do-not-store',
    } as never);

    expect(inserted).toEqual([
      {
        requestId: '10000000-0000-4000-8000-000000000001',
        egressId: '30000000-0000-4000-8000-000000000001',
        ownerId: 'owner-1',
        sessionId: 'session-1',
        taskId: '20000000-0000-4000-8000-000000000001',
        operationId: 'operation-1',
        requestFingerprint: 'sha256:fingerprint',
        source: 'pi_agent',
        provider: 'deepseek',
        modelId: 'deepseek-chat',
        categories: ['password', 'api_key'],
        policyResult: 'redacted',
        createdAt: new Date('2026-09-04T00:00:00Z'),
      },
    ]);
    expect(JSON.stringify(inserted)).not.toContain('do-not-store');
  });

  it('does not resolve record before the database insert resolves', async () => {
    let release!: () => void;
    const insertFinished = new Promise<void>((resolve) => {
      release = resolve;
    });
    const insert = vi.fn(() => insertFinished);
    const dataSource = {
      getRepository: () => ({ insert }),
    } as unknown as DataSource;
    const store = new TypeOrmEgressAuditStore(dataSource);
    let recordResolved = false;

    const recording = store.record(minimalAudit()).then(() => {
      recordResolved = true;
    });
    await Promise.resolve();

    expect(insert).toHaveBeenCalledOnce();
    expect(recordResolved).toBe(false);
    release();
    await recording;
    expect(recordResolved).toBe(true);
  });

  it('rejects when the database insert fails', async () => {
    const failure = new Error('database unavailable');
    const dataSource = {
      getRepository: () => ({ insert: async () => Promise.reject(failure) }),
    } as unknown as DataSource;

    await expect(
      new TypeOrmEgressAuditStore(dataSource).record(minimalAudit()),
    ).rejects.toBe(failure);
  });
});

function minimalAudit() {
  return {
    requestId: '10000000-0000-4000-8000-000000000001',
    ownerId: 'owner-1',
    sessionId: 'session-1',
    requestFingerprint: 'sha256:fingerprint',
    source: 'pi_agent',
    categories: [],
    decision: 'allowed',
    provider: 'deepseek',
    modelId: 'deepseek-chat',
    createdAt: new Date('2026-09-04T00:00:00Z'),
  } as never;
}

describe('CreateEgressAuditLogs migration', () => {
  it('creates a metadata-only audit table after chat tasks', async () => {
    const sql: string[] = [];
    const runner = {
      query: async (statement: string) => {
        sql.push(statement.replace(/\s+/g, ' ').trim().toLowerCase());
      },
    };
    const migration = new CreateEgressAuditLogs1788502000000();
    await migration.up(runner as never);
    const schema = sql.join('\n');
    expect(schema).toContain('create table egress_audit_logs');
    expect(schema).toContain('policy_result');
    expect(schema).toContain('pending_user_decision');
    expect(schema).not.toContain('payload');
    expect(schema).not.toContain('credential');
  });
});
