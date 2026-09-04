import type { QueryRunner } from 'typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { CORE_ENTITIES } from './core-entities.js';
import { EgressDecisionRequestEntity } from './entities/egress-decision-request.entity.js';
import { CreateEgressDecisionRequests1788503000000 } from './migrations/1788503000000-create-egress-decision-requests.js';

const normalize = (sql: string) =>
  sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('CreateEgressDecisionRequests1788503000000', () => {
  it('creates all ownership, state, consistency and active-payload constraints', async () => {
    const statements: string[] = [];
    const runner = {
      query: async (sql: string) => void statements.push(normalize(sql)),
    } as unknown as QueryRunner;
    await new CreateEgressDecisionRequests1788503000000().up(runner);
    const sql = statements.join('\n');

    expect(sql).toContain('create table egress_decision_requests');
    expect(sql).toContain(
      'foreign key (owner_id, task_id) references chat_tasks(owner_id, id)',
    );
    expect(sql).toContain(
      "state in ('pending','ready_allow','ready_redact','consumed','blocked','expired','cancelled','invalidated')",
    );
    expect(sql).toContain("decision in ('allow','redact','block')");
    expect(sql).toContain('check (version > 0)');
    expect(sql).toContain('check (expires_at > created_at)');
    expect(sql).toContain('constraint egress_decision_state_decision_check');
    expect(sql).toContain(
      "on egress_decision_requests (expires_at) where state = 'pending'",
    );
    expect(sql).toContain(
      'on egress_decision_requests (owner_id, state, created_at desc)',
    );
    expect(sql).toContain(
      "where state in ('pending','ready_allow','ready_redact')",
    );
    expect(sql).not.toMatch(
      /payload json|authorization text|api_key text|matched_value/,
    );
  });

  it('supports an up, down, up migration cycle', async () => {
    const statements: string[] = [];
    const runner = {
      query: async (sql: string) => void statements.push(normalize(sql)),
    } as unknown as QueryRunner;
    const migration = new CreateEgressDecisionRequests1788503000000();
    await migration.up(runner);
    await migration.down(runner);
    await migration.up(runner);
    expect(
      statements.filter((sql) =>
        sql.startsWith('create table egress_decision_requests'),
      ),
    ).toHaveLength(2);
    expect(statements).toContain(
      'drop table if exists egress_decision_requests',
    );
  });

  it('registers the entity in the shared production entity list', () => {
    expect(CORE_ENTITIES).toContain(EgressDecisionRequestEntity);
    const table = getMetadataArgsStorage().tables.find(
      (metadata) => metadata.target === EgressDecisionRequestEntity,
    );
    expect(table?.name).toBe('egress_decision_requests');
  });
});
