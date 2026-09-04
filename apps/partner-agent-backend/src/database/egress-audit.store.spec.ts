import type { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
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
    store.record({
      requestId: '10000000-0000-4000-8000-000000000001',
      taskId: '20000000-0000-4000-8000-000000000001',
      source: 'pi_agent',
      categories: ['password', 'api_key'],
      decision: 'redacted',
      provider: 'deepseek',
      createdAt: new Date('2026-09-04T00:00:00Z'),
      payload: 'password=do-not-store',
    } as never);
    await store.flush();

    expect(inserted).toEqual([
      {
        requestId: '10000000-0000-4000-8000-000000000001',
        taskId: '20000000-0000-4000-8000-000000000001',
        source: 'pi_agent',
        categories: ['password', 'api_key'],
        policyResult: 'redacted',
        provider: 'deepseek',
        createdAt: new Date('2026-09-04T00:00:00Z'),
      },
    ]);
    expect(JSON.stringify(inserted)).not.toContain('do-not-store');
  });
});

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
