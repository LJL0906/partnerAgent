import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TypeOrmEgressAuditStore } from '../src/database/egress-audit.store.js';
import { EgressAuditEntity } from '../src/database/entities/egress-audit.entity.js';
import { EgressPolicyGateway } from '../src/model-gateway/egress-policy.gateway.js';
import { MemoryEgressDecisionStore } from '../src/model-gateway/memory-egress-decision.store.js';

const databaseUrl = process.env.REAL_POSTGRES_DATABASE_URL;
const describeReal = databaseUrl ? describe : describe.skip;

describeReal('PostgreSQL egress audit fail-closed boundary', () => {
  let dataSource: DataSource;
  const ownerId = `egress-real-${randomUUID()}`;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      entities: [EgressAuditEntity],
    });
    await dataSource.initialize();
    await dataSource.query('insert into users(id) values ($1)', [ownerId]);
  });

  afterAll(async () => {
    await dataSource?.query(
      'drop trigger if exists egress_audit_failure_test_trigger on egress_audit_logs',
    );
    await dataSource?.query(
      'drop function if exists fail_selected_egress_audit_insert()',
    );
    await dataSource?.destroy();
  });

  it('has the strengthened columns, constraints and query indexes', async () => {
    const columns = await dataSource.query(
      `select column_name from information_schema.columns
       where table_schema = current_schema() and table_name = 'egress_audit_logs'`,
    );
    expect(columns.map((row: { column_name: string }) => row.column_name)).toEqual(
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
    const constraints = await dataSource.query(
      `select conname from pg_constraint
       where conrelid = 'egress_audit_logs'::regclass`,
    );
    expect(constraints.map((row: { conname: string }) => row.conname)).toEqual(
      expect.arrayContaining([
        'egress_audit_owner_fk',
        'egress_audit_metadata_completeness_check',
      ]),
    );
    const indexes = await dataSource.query(
      `select indexname from pg_indexes where tablename = 'egress_audit_logs'`,
    );
    expect(indexes.map((row: { indexname: string }) => row.indexname)).toEqual(
      expect.arrayContaining([
        'egress_audit_owner_created_idx',
        'egress_audit_task_created_idx',
        'egress_audit_fingerprint_created_idx',
      ]),
    );
  });

  it('resolves the PostgreSQL insert before exposing an approved request', async () => {
    const order: string[] = [];
    const persisted = new TypeOrmEgressAuditStore(dataSource);
    const audit = {
      async record(record: Parameters<typeof persisted.record>[0]) {
        order.push('audit:start');
        await persisted.record(record);
        order.push('audit:resolved');
      },
    } as TypeOrmEgressAuditStore;
    const policy = new EgressPolicyGateway(
      new ConfigService(),
      audit,
      new MemoryEgressDecisionStore(),
    );
    const provider = vi.fn(() => order.push('provider'));
    const result = await policy.evaluate(request('普通问题', 'real-pg-success'));
    if (result.request) provider(result.request);

    expect(order).toEqual(['audit:start', 'audit:resolved', 'provider']);
    expect(provider).toHaveBeenCalledOnce();
  });

  it('keeps provider calls at zero on an injected PostgreSQL audit failure', async () => {
    const secret = 'password=real-postgres-secret';
    await dataSource.query(`
      create or replace function fail_selected_egress_audit_insert()
      returns trigger language plpgsql as $$
      begin
        if new.model_id = 'real-pg-audit-failure' then
          raise exception 'injected database failure with hidden detail';
        end if;
        return new;
      end $$
    `);
    await dataSource.query(`
      create trigger egress_audit_failure_test_trigger
      before insert on egress_audit_logs
      for each row execute function fail_selected_egress_audit_insert()
    `);
    const policy = new EgressPolicyGateway(
      new ConfigService({ EGRESS_SENSITIVE_ACTION: 'allow' }),
      new TypeOrmEgressAuditStore(dataSource),
      new MemoryEgressDecisionStore(),
    );
    const provider = vi.fn();
    const attempt = (async () => {
      const result = await policy.evaluate(
        request(secret, 'real-pg-audit-failure'),
      );
      if (result.request) provider(result.request);
      return result;
    })();

    await expect(attempt).rejects.toMatchObject({
      code: 'EGRESS_001',
      message: '外发安全检查暂时不可用，本次内容未发送。',
    });
    await expect(attempt).rejects.not.toThrow(secret);
    expect(provider).not.toHaveBeenCalled();
    const leaked = await dataSource.query(
      `select count(*)::int as count from egress_audit_logs
       where row_to_json(egress_audit_logs)::text like $1`,
      [`%${secret}%`],
    );
    expect(leaked[0].count).toBe(0);
  });

  function request(content: string, modelId: string) {
    return {
      metadata: {
        ownerId,
        sessionId: randomUUID(),
        source: 'real_postgres_egress_test',
        provider: 'deepseek',
      },
      model: { provider: 'deepseek', id: modelId } as never,
      context: { messages: [{ role: 'user' as const, content }] },
    };
  }
});
