import type { QueryRunner } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { CreateChatTaskTables1788501000000 } from './migrations/1788501000000-create-chat-task-tables.js';

const normalize = (sql: string) =>
  sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('CreateChatTaskTables1788501000000', () => {
  it('creates persistent command, input and task ownership boundaries', async () => {
    const statements: string[] = [];
    const runner = {
      query: async (sql: string) => void statements.push(normalize(sql)),
    } as unknown as QueryRunner;
    await new CreateChatTaskTables1788501000000().up(runner);
    const sql = statements.join('\n');
    expect(sql).toContain('create table original_records');
    expect(sql).toContain(
      'constraint original_records_owner_input_key unique (owner_id, input_id)',
    );
    expect(sql).toContain('create table local_core_operations');
    expect(sql).toContain(
      'constraint local_core_operations_owner_operation_key unique (owner_id, operation_id)',
    );
    expect(sql).toContain('create table chat_tasks');
    expect(sql).toContain(
      "'queued','running','waiting_privacy_decision','completed','failed','cancelled'",
    );
    expect(sql).toContain(
      'foreign key (owner_id, original_record_id) references original_records(owner_id, id)',
    );
    expect(sql).toContain(
      'foreign key (owner_id, user_message_id) references session_messages(owner_id, id)',
    );
    expect(sql).toContain(
      'foreign key (owner_id, operation_id) references local_core_operations(owner_id, operation_id)',
    );
  });

  it('removes all task tables and the compatibility key on rollback', async () => {
    const statements: string[] = [];
    const runner = {
      query: async (sql: string) => void statements.push(normalize(sql)),
    } as unknown as QueryRunner;
    await new CreateChatTaskTables1788501000000().down(runner);
    expect(statements.join('\n')).toContain(
      'drop constraint if exists session_messages_owner_id_key',
    );
    expect(statements.join('\n')).toContain('drop table if exists chat_tasks');
  });
});
