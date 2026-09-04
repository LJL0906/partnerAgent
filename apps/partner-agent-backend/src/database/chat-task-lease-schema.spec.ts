import type { QueryRunner } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { AddChatTaskLeases1788506000000 } from './migrations/1788506000000-add-chat-task-leases.js';

const normalize = (sql: string) =>
  sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('AddChatTaskLeases1788506000000', () => {
  it('adds fenced leases, per-session exclusion and tool task ownership', async () => {
    const statements: string[] = [];
    const runner = {
      query: async (sql: string) => void statements.push(normalize(sql)),
    } as unknown as QueryRunner;

    await new AddChatTaskLeases1788506000000().up(runner);
    const sql = statements.join('\n');
    expect(sql).toContain('add column lease_owner text');
    expect(sql).toContain('add column lease_expires_at timestamptz');
    expect(sql).toContain('add column waiting_tool_confirmation_id uuid');
    expect(sql).toContain("'waiting_tool_approval'");
    expect(sql).toContain("'undone','indeterminate'");
    expect(sql).toContain(
      'create unique index chat_tasks_one_running_per_session_key',
    );
    expect(sql).toContain("where state = 'running'");
    expect(sql).toContain('add column task_id uuid');
    expect(sql).toContain('add column operation_id text');
    expect(sql).toContain('add column result_json jsonb');
    expect(sql).toContain(
      'foreign key (owner_id, task_id) references chat_tasks(owner_id, id)',
    );
    expect(sql).toContain(
      'foreign key (owner_id, operation_id) references local_core_operations(owner_id, operation_id)',
    );
  });

  it('removes tool links and lease state on rollback', async () => {
    const statements: string[] = [];
    const runner = {
      query: async (sql: string) => void statements.push(normalize(sql)),
    } as unknown as QueryRunner;

    await new AddChatTaskLeases1788506000000().down(runner);
    const sql = statements.join('\n');
    expect(sql).toContain(
      'drop index if exists tool_confirmations_owner_task_idx',
    );
    expect(sql).toContain('drop column if exists operation_id');
    expect(sql).toContain('drop column if exists result_json');
    expect(sql).toContain('drop column if exists task_id');
    expect(sql).toContain('drop column if exists attempt_count');
    expect(sql).toContain('drop column if exists lease_expires_at');
    expect(sql).toContain('drop column if exists lease_owner');
    expect(sql).toContain('drop column if exists waiting_tool_confirmation_id');
    expect(sql).toContain(
      "set status = 'failed' where status = 'indeterminate'",
    );
  });
});
