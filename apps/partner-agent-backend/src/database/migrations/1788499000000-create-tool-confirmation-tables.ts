import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateToolConfirmationTables1788499000000
  implements MigrationInterface
{
  name = 'CreateToolConfirmationTables1788499000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table tool_confirmation_requests (
        id uuid primary key,
        owner_id text not null,
        session_id text not null references chat_sessions(id) on delete cascade,
        tool_call_id text not null,
        tool_name text not null,
        risk_level text not null check (risk_level in ('read_only','low','medium','high')),
        status text not null check (status in ('pending','executing','succeeded','failed','dismissed','expired','undone')),
        arguments_json text not null,
        request_summary text not null,
        result_summary text,
        created_at timestamptz not null,
        expires_at timestamptz not null
      )
    `);
    await queryRunner.query(`create index tool_confirmations_owner_session_status_idx on tool_confirmation_requests (owner_id, session_id, status)`);
    await queryRunner.query(`create index tool_confirmations_expires_idx on tool_confirmation_requests (expires_at)`);
    await queryRunner.query(`
      create table tool_audit_logs (
        id uuid primary key,
        owner_id text not null,
        session_id text not null,
        tool_call_id text not null,
        tool_name text not null,
        risk_level text not null,
        action text not null,
        confirmation_id uuid,
        execution_id uuid,
        request_summary text,
        result_summary text,
        created_at timestamptz not null
      )
    `);
    await queryRunner.query(`create index tool_audits_owner_session_created_idx on tool_audit_logs (owner_id, session_id, created_at)`);
    await queryRunner.query(`
      create table tool_execution_receipts (
        id uuid primary key,
        confirmation_id uuid not null unique references tool_confirmation_requests(id),
        owner_id text not null,
        session_id text not null references chat_sessions(id) on delete cascade,
        tool_name text not null,
        undo_payload_json text not null,
        status text not null check (status in ('applied','undoing','undone','undo_failed')),
        applied_at timestamptz not null,
        undo_expires_at timestamptz not null
      )
    `);
    await queryRunner.query(`create index tool_receipts_owner_session_idx on tool_execution_receipts (owner_id, session_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop table if exists tool_execution_receipts');
    await queryRunner.query('drop table if exists tool_audit_logs');
    await queryRunner.query('drop table if exists tool_confirmation_requests');
  }
}
