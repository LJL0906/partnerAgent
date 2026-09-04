import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEgressDecisionRequests1788503000000 implements MigrationInterface {
  name = 'CreateEgressDecisionRequests1788503000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table egress_decision_requests (
        id uuid primary key,
        owner_id text not null references users(id),
        task_id uuid not null,
        session_id text not null,
        operation_id text not null,
        request_fingerprint text not null,
        provider text not null,
        model_id text not null,
        source text not null,
        categories text[] not null,
        state text not null,
        decision text,
        version integer not null default 1,
        created_at timestamptz not null default transaction_timestamp(),
        updated_at timestamptz not null default transaction_timestamp(),
        expires_at timestamptz not null,
        decided_at timestamptz,
        consumed_at timestamptz,
        constraint egress_decision_owner_task_fk foreign key (owner_id, task_id)
          references chat_tasks(owner_id, id) on delete cascade,
        constraint egress_decision_owner_session_fk foreign key (owner_id, session_id)
          references chat_sessions(owner_id, id),
        constraint egress_decision_owner_operation_fk foreign key (owner_id, operation_id)
          references local_core_operations(owner_id, operation_id),
        constraint egress_decision_state_check check (
          state in ('pending','ready_allow','ready_redact','consumed','blocked','expired','cancelled','invalidated')
        ),
        constraint egress_decision_decision_check check (
          decision is null or decision in ('allow','redact','block')
        ),
        constraint egress_decision_version_check check (version > 0),
        constraint egress_decision_expiry_check check (expires_at > created_at),
        constraint egress_decision_categories_check check (cardinality(categories) > 0),
        constraint egress_decision_state_decision_check check (
          (state = 'pending' and decision is null and decided_at is null and consumed_at is null)
          or (state = 'ready_allow' and decision = 'allow' and decided_at is not null and consumed_at is null)
          or (state = 'ready_redact' and decision = 'redact' and decided_at is not null and consumed_at is null)
          or (state = 'consumed' and decision in ('allow','redact') and decided_at is not null and consumed_at is not null)
          or (state = 'blocked' and decision = 'block' and decided_at is not null and consumed_at is null)
          or (state = 'expired' and decision is null and decided_at is null and consumed_at is null)
          or (state = 'cancelled' and consumed_at is null and (
            (decision is null and decided_at is null)
            or (decision in ('allow','redact') and decided_at is not null)
          ))
          or (state = 'invalidated' and decision in ('allow','redact') and decided_at is not null and consumed_at is null)
        )
      )
    `);
    await queryRunner.query(`
      create index egress_decision_pending_expiry_idx
        on egress_decision_requests (expires_at)
        where state = 'pending'
    `);
    await queryRunner.query(`
      create index egress_decision_owner_state_created_idx
        on egress_decision_requests (owner_id, state, created_at desc)
    `);
    await queryRunner.query(`
      create unique index egress_decision_active_payload_key
        on egress_decision_requests
          (owner_id, task_id, request_fingerprint, provider, model_id, source)
        where state in ('pending','ready_allow','ready_redact')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop table if exists egress_decision_requests');
  }
}
