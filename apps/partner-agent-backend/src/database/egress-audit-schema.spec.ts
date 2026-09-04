import type { QueryRunner } from 'typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { EgressAuditEntity } from './entities/egress-audit.entity.js';
import { StrengthenEgressAuditLogs1788504000000 } from './migrations/1788504000000-strengthen-egress-audit-logs.js';

const normalize = (sql: string) =>
  sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('StrengthenEgressAuditLogs1788504000000', () => {
  it('adds metadata-only columns, safe backfill, constraints and query indexes', async () => {
    const statements: string[] = [];
    const runner = {
      query: async (sql: string) => void statements.push(normalize(sql)),
    } as unknown as QueryRunner;

    await new StrengthenEgressAuditLogs1788504000000().up(runner);
    const sql = statements.join('\n');

    expect(sql).toContain('add column egress_id uuid');
    expect(sql).toContain('add column owner_id text');
    expect(sql).toContain('add column session_id text');
    expect(sql).toContain('add column operation_id text');
    expect(sql).toContain('add column request_fingerprint text');
    expect(sql).toContain('add column model_id text');
    expect(sql).toContain('update egress_audit_logs audit');
    expect(sql).toContain('from chat_tasks task');
    expect(sql).toContain('foreign key (owner_id) references users(id)');
    expect(sql).toContain(
      'constraint egress_audit_metadata_completeness_check',
    );
    expect(sql).toContain(
      '(request_fingerprint is null and model_id is null) or ( owner_id is not null and session_id is not null and request_fingerprint is not null and model_id is not null )',
    );
    expect(sql).toContain('on egress_audit_logs (owner_id, created_at desc)');
    expect(sql).toContain(
      'on egress_audit_logs (request_fingerprint, created_at desc)',
    );
    expect(sql).not.toMatch(
      /context_json|prompt|message_content|matched_(text|value)|authorization|request_body|response_body/,
    );
  });

  it('supports an up, down, up migration cycle', async () => {
    const statements: string[] = [];
    const runner = {
      query: async (sql: string) => void statements.push(normalize(sql)),
    } as unknown as QueryRunner;
    const migration = new StrengthenEgressAuditLogs1788504000000();

    await migration.up(runner);
    await migration.down(runner);
    await migration.up(runner);

    expect(
      statements.filter((sql) => sql.includes('add column egress_id uuid')),
    ).toHaveLength(2);
    expect(statements).toContain(
      'drop index if exists egress_audit_fingerprint_created_idx',
    );
    expect(
      statements.some((sql) => sql.includes('drop column if exists egress_id')),
    ).toBe(true);
  });

  it('maps every strengthened column and index on the entity', () => {
    const metadata = getMetadataArgsStorage();
    const columns = metadata.columns
      .filter((column) => column.target === EgressAuditEntity)
      .map((column) => column.options.name ?? column.propertyName);
    const indexes = metadata.indices
      .filter((index) => index.target === EgressAuditEntity)
      .map((index) => index.name);

    expect(columns).toEqual(
      expect.arrayContaining([
        'request_id',
        'egress_id',
        'owner_id',
        'session_id',
        'task_id',
        'operation_id',
        'request_fingerprint',
        'source',
        'provider',
        'model_id',
        'categories',
        'policy_result',
        'created_at',
      ]),
    );
    expect(indexes).toEqual(
      expect.arrayContaining([
        'egress_audit_owner_created_idx',
        'egress_audit_task_created_idx',
        'egress_audit_fingerprint_created_idx',
      ]),
    );
  });
});
