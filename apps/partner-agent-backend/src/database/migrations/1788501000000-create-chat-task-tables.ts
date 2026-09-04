import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChatTaskTables1788501000000 implements MigrationInterface {
  name = 'CreateChatTaskTables1788501000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table original_records (
        id uuid primary key,
        owner_id text not null references users(id),
        session_id text not null,
        input_id text not null,
        request_fingerprint text not null,
        content text not null,
        created_at timestamptz not null,
        constraint original_records_owner_input_key unique (owner_id, input_id),
        constraint original_records_owner_id_key unique (owner_id, id),
        constraint original_records_owner_session_fk foreign key (owner_id, session_id)
          references chat_sessions(owner_id, id)
      )
    `);
    await queryRunner.query(`
      alter table session_messages
        add constraint session_messages_owner_id_key unique (owner_id, id)
    `);
    await queryRunner.query(`
      create table local_core_operations (
        id uuid primary key,
        owner_id text not null references users(id),
        operation_id text not null,
        request_fingerprint text not null,
        command_name text not null,
        result_json jsonb not null,
        created_at timestamptz not null,
        constraint local_core_operations_owner_operation_key unique (owner_id, operation_id)
      )
    `);
    await queryRunner.query(`
      create table chat_tasks (
        id uuid primary key,
        owner_id text not null references users(id),
        session_id text not null,
        operation_id text not null,
        input_id text not null,
        original_record_id uuid not null,
        user_message_id uuid not null,
        result_message_id uuid,
        state text not null check (state in ('queued','running','waiting_privacy_decision','completed','failed','cancelled')),
        error_code text,
        error_message text,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        started_at timestamptz,
        completed_at timestamptz,
        constraint chat_tasks_owner_id_key unique (owner_id, id),
        constraint chat_tasks_owner_session_fk foreign key (owner_id, session_id)
          references chat_sessions(owner_id, id),
        constraint chat_tasks_owner_operation_fk foreign key (owner_id, operation_id)
          references local_core_operations(owner_id, operation_id),
        constraint chat_tasks_owner_original_record_fk foreign key (owner_id, original_record_id)
          references original_records(owner_id, id),
        constraint chat_tasks_owner_user_message_fk foreign key (owner_id, user_message_id)
          references session_messages(owner_id, id),
        constraint chat_tasks_owner_result_message_fk foreign key (owner_id, result_message_id)
          references session_messages(owner_id, id)
      )
    `);
    await queryRunner.query(
      `create index chat_tasks_owner_updated_idx on chat_tasks (owner_id, updated_at desc)`,
    );
    await queryRunner.query(
      `create index chat_tasks_operation_idx on chat_tasks (owner_id, operation_id)`,
    );
    await queryRunner.query(
      `create index chat_tasks_session_idx on chat_tasks (owner_id, session_id, created_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop table if exists chat_tasks');
    await queryRunner.query('drop table if exists local_core_operations');
    await queryRunner.query('drop table if exists original_records');
    await queryRunner.query(
      'alter table session_messages drop constraint if exists session_messages_owner_id_key',
    );
  }
}
