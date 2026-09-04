import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddToolControlOutboxRemediation1788513000000 implements MigrationInterface {
  name = 'AddToolControlOutboxRemediation1788513000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table tool_control_outbox (
        event_id uuid primary key,
        event_key text not null,
        owner_id text not null,
        session_id text not null,
        task_id uuid not null,
        operation_id text not null,
        event_type text not null,
        event_data jsonb not null default '{}'::jsonb,
        sequence_no integer not null,
        attempt_count integer not null default 0,
        available_at timestamptz not null default now(),
        lease_owner uuid,
        lease_token bigint not null default 0,
        lease_expires_at timestamptz,
        delivered_at timestamptz,
        last_error_code text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint tool_control_outbox_event_key unique (event_key),
        constraint tool_control_outbox_session_sequence_key
          unique (session_id, sequence_no),
        constraint tool_control_outbox_task_owner_fk foreign key (owner_id, task_id)
          references chat_tasks(owner_id, id) on delete cascade,
        constraint tool_control_outbox_attempt_check check (attempt_count >= 0),
        constraint tool_control_outbox_sequence_check check (sequence_no >= 0),
        constraint tool_control_outbox_event_type_check check (event_type in (
          'tool_confirmation_confirmed','tool_confirmation_dismissed',
          'tool_execution_start','tool_execution_end',
          'tool_undo_available','tool_undo_completed'
        ))
      )
    `);
    await queryRunner.query(`
      create index tool_control_outbox_claim_idx
        on tool_control_outbox
          (delivered_at, available_at, lease_expires_at, created_at, sequence_no)
    `);
    await queryRunner.query(`
      create index tool_control_outbox_session_pending_idx
        on tool_control_outbox (session_id, sequence_no)
        where delivered_at is null
    `);
    await queryRunner.query(`
      create table outbox_remediation_audits (
        id uuid primary key,
        outbox_kind text not null,
        event_id uuid not null,
        action text not null,
        operator_label text not null,
        confirmation_phrase text not null,
        previous_attempt_count integer not null,
        previous_error_code text,
        created_at timestamptz not null default now(),
        constraint outbox_remediation_audits_kind_check
          check (outbox_kind in ('chat_task','tool_control')),
        constraint outbox_remediation_audits_action_check
          check (action in ('retry','discard')),
        constraint outbox_remediation_audits_attempt_check
          check (previous_attempt_count >= 8)
      )
    `);
    await queryRunner.query(`
      create index outbox_remediation_audits_event_idx
        on outbox_remediation_audits (outbox_kind, event_id, created_at desc)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop table if exists outbox_remediation_audits');
    await queryRunner.query('drop table if exists tool_control_outbox');
  }
}
