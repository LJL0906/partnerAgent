import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChatTaskOutbox1788509000000 implements MigrationInterface {
  name = 'CreateChatTaskOutbox1788509000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table ws_v1_events add column idempotency_key text null
    `);
    await queryRunner.query(`
      alter table ws_v1_events add constraint ws_v1_events_stream_idempotency_key
      unique (stream_key, idempotency_key)
    `);
    await queryRunner.query(`
      create table chat_task_lifecycle_outbox (
        event_id uuid primary key,
        event_key text not null,
        owner_id text not null,
        task_id uuid not null,
        operation_id text not null,
        session_id text not null,
        state text not null,
        event_data jsonb not null default '{}'::jsonb,
        attempt_count integer not null default 0,
        available_at timestamptz not null default transaction_timestamp(),
        lease_owner uuid null,
        lease_token bigint not null default 0,
        lease_expires_at timestamptz null,
        delivered_at timestamptz null,
        last_error_code text null,
        created_at timestamptz not null default transaction_timestamp(),
        updated_at timestamptz not null default transaction_timestamp(),
        constraint chat_task_lifecycle_outbox_event_key unique (event_key),
        constraint chat_task_lifecycle_outbox_task_fk foreign key (owner_id, task_id)
          references chat_tasks(owner_id, id) on delete cascade,
        constraint chat_task_lifecycle_outbox_state_check check (
          state in ('queued','running','waiting_privacy_decision',
                    'waiting_tool_approval','completed','failed','cancelled')
        ),
        constraint chat_task_lifecycle_outbox_attempt_check check (attempt_count >= 0),
        constraint chat_task_lifecycle_outbox_lease_token_check check (lease_token >= 0)
      )
    `);
    await queryRunner.query(`
      create index chat_task_lifecycle_outbox_claim_idx
      on chat_task_lifecycle_outbox (available_at, lease_expires_at, created_at)
      where delivered_at is null
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop table if exists chat_task_lifecycle_outbox');
    await queryRunner.query(
      'alter table ws_v1_events drop constraint if exists ws_v1_events_stream_idempotency_key',
    );
    await queryRunner.query(
      'alter table ws_v1_events drop column if exists idempotency_key',
    );
  }
}
