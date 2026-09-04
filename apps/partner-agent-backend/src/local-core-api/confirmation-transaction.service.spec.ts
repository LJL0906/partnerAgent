import { ConfigService } from '@nestjs/config';
import type { DataSource, QueryRunner } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { TypeOrmSessionStore } from '../database/typeorm-session.store.js';
import { ConfirmationTransactionService } from './confirmation-transaction.service.js';

const userId = 'owner';
const operationId = '10000000-0000-4000-8000-000000000001';
const batchId = '20000000-0000-4000-8000-000000000001';
const candidateId = '30000000-0000-4000-8000-000000000001';
const objectId = '40000000-0000-4000-8000-000000000001';
const now = new Date('2026-09-04T00:00:00.000Z');

describe('ConfirmationTransactionService', () => {
  it('commits a confirmation using the fixed lock order and records all effects', async () => {
    const database = fakeDatabase((sql) => {
      if (sql.includes('where user_id=$1 and operation_id=$2')) return [];
      if (sql.includes('select distinct batch_id'))
        return [{ batch_id: batchId }];
      if (
        sql.includes('from confirmation_batches') &&
        sql.includes('for update')
      ) {
        return [batch('normal')];
      }
      if (sql.includes('from candidate_items') && sql.includes('order by id')) {
        return [candidate()];
      }
      if (sql.includes('transaction_timestamp')) return [{ now }];
      if (sql.includes('insert into business_objects'))
        return [businessObject()];
      if (sql.includes('select to_jsonb(d)')) {
        return [{ value: { id: objectId, title: '目标' } }];
      }
      return [];
    });

    const result = await service(database).submit(command());

    expect(result.status).toBe('completed');
    expect(result.data?.confirmed).toHaveLength(1);
    expect(database.commits).toBe(1);
    expect(database.rollbacks).toBe(0);
    expect(database.releases).toBe(1);
    expect(
      indexOf(database.sql, 'from confirmation_batches', 'for update'),
    ).toBeLessThan(
      indexOf(
        database.sql,
        'from candidate_items',
        'order by id',
        'for update',
      ),
    );
    expect(database.sql.join('\n')).toContain('insert into object_versions');
    expect(database.sql.join('\n')).toContain('insert into object_index_jobs');
    expect(database.sql.join('\n')).toContain(
      'update confirmation_actions set submitted_payload',
    );
  });

  it('returns the stored result for an idempotent retry and rejects a fingerprint collision', async () => {
    const stored = {
      operation_id: operationId,
      status: 'completed',
      data: {
        batch_ref: { kind: 'confirmation_batch', id: batchId },
        confirmed: [],
      },
    };
    const database = fakeDatabase((sql) =>
      sql.includes('where user_id=$1 and operation_id=$2')
        ? [
            {
              request_fingerprint: 'fingerprint',
              submitted_payload: { result: stored },
            },
          ]
        : [],
    );
    const duplicate = await service(database).submit(command());
    expect(duplicate).toMatchObject({
      status: 'duplicate',
      operation_id: operationId,
    });
    expect(database.commits).toBe(0);
    expect(database.rollbacks).toBe(1);

    const collision = fakeDatabase((sql) =>
      sql.includes('where user_id=$1 and operation_id=$2')
        ? [
            {
              request_fingerprint: 'different',
              submitted_payload: { result: stored },
            },
          ]
        : [],
    );
    await expect(service(collision).submit(command())).rejects.toMatchObject({
      status: 409,
    });
    expect(collision.rollbacks).toBe(1);
  });

  it('persists expiry using database time without applying formal objects', async () => {
    const database = fakeDatabase((sql) => {
      if (sql.includes('where user_id=$1 and operation_id=$2')) return [];
      if (sql.includes('select distinct batch_id'))
        return [{ batch_id: batchId }];
      if (
        sql.includes('from confirmation_batches') &&
        sql.includes('for update')
      ) {
        return [
          { ...batch('normal'), expires_at: new Date(now.getTime() - 1) },
        ];
      }
      if (sql.includes('from candidate_items') && sql.includes('order by id')) {
        return [candidate()];
      }
      if (sql.includes('transaction_timestamp')) return [{ now }];
      return [];
    });

    await expect(service(database).submit(command())).rejects.toMatchObject({
      status: 409,
    });
    expect(database.commits).toBe(1);
    expect(database.rollbacks).toBe(0);
    expect(database.sql.join('\n')).toContain("candidate_status = 'expired'");
    expect(database.sql.join('\n')).not.toContain(
      'insert into business_objects',
    );
  });

  it('rejects a multi-item high-risk batch before object writes', async () => {
    const secondId = '30000000-0000-4000-8000-000000000002';
    const database = fakeDatabase((sql) => {
      if (sql.includes('where user_id=$1 and operation_id=$2')) return [];
      if (sql.includes('select distinct batch_id'))
        return [{ batch_id: batchId }];
      if (
        sql.includes('from confirmation_batches') &&
        sql.includes('for update')
      ) {
        return [batch('high')];
      }
      if (sql.includes('from candidate_items') && sql.includes('order by id')) {
        return [candidate('high'), { ...candidate('high'), id: secondId }];
      }
      if (sql.includes('transaction_timestamp')) return [{ now }];
      return [];
    });
    const input = command();
    input.envelope.payload.items.push({
      ...input.envelope.payload.items[0],
      candidate_id: secondId,
    });

    await expect(service(database).submit(input)).rejects.toMatchObject({
      status: 409,
    });
    expect(database.rollbacks).toBe(1);
    expect(database.sql.join('\n')).not.toContain(
      'insert into business_objects',
    );
  });

  it('rolls back every write when a later transactional effect fails', async () => {
    const database = fakeDatabase((sql) => {
      if (sql.includes('where user_id=$1 and operation_id=$2')) return [];
      if (sql.includes('select distinct batch_id'))
        return [{ batch_id: batchId }];
      if (
        sql.includes('from confirmation_batches') &&
        sql.includes('for update')
      )
        return [batch('normal')];
      if (sql.includes('from candidate_items') && sql.includes('order by id'))
        return [candidate()];
      if (sql.includes('transaction_timestamp')) return [{ now }];
      if (sql.includes('insert into business_objects'))
        return [businessObject()];
      if (sql.includes('select to_jsonb(d)'))
        return [{ value: { title: '目标' } }];
      if (sql.includes('insert into object_index_jobs'))
        throw new Error('index job failed');
      return [];
    });

    await expect(service(database).submit(command())).rejects.toThrow(
      'index job failed',
    );
    expect(database.commits).toBe(0);
    expect(database.rollbacks).toBe(1);
  });
});

function service(database: FakeDatabase) {
  const store = new TypeOrmSessionStore(
    new ConfigService(),
    database as unknown as DataSource,
  );
  return new ConfirmationTransactionService(store);
}

function command() {
  return {
    userId,
    input: {},
    envelope: {
      operation_id: operationId,
      client_source: 'web',
      request_fingerprint: 'fingerprint',
      payload: {
        mode: 'confirm' as const,
        items: [
          {
            candidate_id: candidateId,
            kind: 'goal' as const,
            action: 'create' as const,
            risk: 'normal' as const,
          },
        ],
      },
    },
  };
}

function batch(risk: 'normal' | 'high') {
  return {
    id: batchId,
    user_id: userId,
    batch_status: 'pending',
    risk_level: risk,
    expires_at: new Date(now.getTime() + 86_400_000),
    version: '1',
  };
}

function candidate(risk: 'normal' | 'high' = 'normal') {
  return {
    id: candidateId,
    batch_id: batchId,
    kind: 'goal',
    action: 'create',
    candidate_status: 'pending',
    risk,
    payload: { title: '目标' },
    edited_payload: null,
    target_object_id: null,
    expected_version: null,
    source_refs: [],
    expires_at: new Date(now.getTime() + 86_400_000),
  };
}

function businessObject() {
  return {
    id: objectId,
    user_id: userId,
    kind: 'goal',
    version: '1',
    lifecycle_status: 'active',
    created_by_batch_id: batchId,
    last_confirmation_batch_id: batchId,
    archived_at: null,
    deleted_at: null,
    purged_at: null,
  };
}

interface FakeDatabase {
  sql: string[];
  commits: number;
  rollbacks: number;
  releases: number;
  createQueryRunner(): QueryRunner;
}

function fakeDatabase(
  respond: (sql: string, parameters?: unknown[]) => unknown,
): FakeDatabase {
  const database: FakeDatabase = {
    sql: [],
    commits: 0,
    rollbacks: 0,
    releases: 0,
    createQueryRunner() {
      return {
        connect: async () => undefined,
        startTransaction: async () => undefined,
        commitTransaction: async () => {
          database.commits += 1;
        },
        rollbackTransaction: async () => {
          database.rollbacks += 1;
        },
        release: async () => {
          database.releases += 1;
        },
        query: async (sql: string, parameters?: unknown[]) => {
          const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
          database.sql.push(normalized);
          return respond(normalized, parameters);
        },
      } as unknown as QueryRunner;
    },
  };
  return database;
}

function indexOf(statements: string[], ...parts: string[]) {
  return statements.findIndex((statement) =>
    parts.every((part) => statement.includes(part)),
  );
}
