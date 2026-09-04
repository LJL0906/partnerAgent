import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSessionTables1788498000000 implements MigrationInterface {
  name = 'CreateSessionTables1788498000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table chat_sessions (
        id text primary key,
        owner_id text not null,
        title text,
        context_format text not null default 'pi-agent-v1',
        context_json text not null default '[]',
        context_revision integer not null default 0 check (context_revision >= 0),
        created_at timestamptz not null,
        last_active_at timestamptz not null,
        archived_at timestamptz,
        deleted_at timestamptz
      )
    `);
    await queryRunner.query(`
      create index chat_sessions_owner_last_active_idx
      on chat_sessions (owner_id, last_active_at desc)
      where deleted_at is null
    `);
    await queryRunner.query(`
      create table session_messages (
        id uuid primary key,
        session_id text not null references chat_sessions(id) on delete cascade,
        sequence integer not null check (sequence > 0),
        role text not null check (role in ('user', 'assistant')),
        content text not null,
        status text not null default 'complete' check (status = 'complete'),
        created_at timestamptz not null,
        constraint session_messages_session_sequence_key unique (session_id, sequence)
      )
    `);
    await queryRunner.query(`
      create index session_messages_session_sequence_idx
      on session_messages (session_id, sequence)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop table if exists session_messages');
    await queryRunner.query('drop table if exists chat_sessions');
  }
}
