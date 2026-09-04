import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddToolReconciliation1788512000000 implements MigrationInterface {
  name = 'AddToolReconciliation1788512000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table tool_confirmation_requests
        add column reconciliation_snapshot_json jsonb,
        add column version integer not null default 1,
        add constraint tool_confirmation_requests_version_check
          check (version between 1 and 2147483647)
    `);
    await queryRunner.query(`
      update tool_confirmation_requests
      set reconciliation_snapshot_json = jsonb_build_object(
        'confirmationId', id,
        'ownerId', owner_id,
        'sessionId', session_id,
        'taskId', task_id,
        'operationId', operation_id,
        'toolCallId', tool_call_id,
        'toolName', tool_name,
        'requestSummary', request_summary,
        'resultSummary', result_summary,
        'capturedAt', greatest(created_at, expires_at)
      )
      where status = 'indeterminate'
        and task_id is not null
        and operation_id is not null
        and length(btrim(request_summary)) > 0
    `);
    await queryRunner.query(`
      create table tool_reconciliation_audits (
        id uuid primary key,
        confirmation_id uuid not null,
        owner_id text not null,
        expected_version integer not null,
        confirmation_version_after integer not null,
        expected_status text not null,
        outcome text not null,
        operator_label text not null,
        confirmation_phrase text not null,
        snapshot_json jsonb not null,
        created_at timestamptz not null,
        constraint tool_reconciliation_audits_confirmation_key
          unique (confirmation_id),
        constraint tool_reconciliation_audits_owner_confirmation_key
          unique (owner_id, confirmation_id),
        constraint tool_reconciliation_audits_owner_confirmation_fk
          foreign key (owner_id, confirmation_id)
          references tool_confirmation_requests(owner_id, id),
        constraint tool_reconciliation_audits_version_check
          check (
            expected_version between 1 and 2147483646
            and confirmation_version_after = expected_version + 1
          ),
        constraint tool_reconciliation_audits_status_check
          check (expected_status = 'indeterminate'),
        constraint tool_reconciliation_audits_outcome_check
          check (outcome in (
            'verified_applied','verified_not_applied','abandoned'
          )),
        constraint tool_reconciliation_audits_operator_check
          check (
            operator_label ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$'
          )
      )
    `);
    await queryRunner.query(`
      create index tool_reconciliation_audits_owner_created_idx
        on tool_reconciliation_audits (owner_id, created_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop table if exists tool_reconciliation_audits');
    await queryRunner.query(`
      alter table tool_confirmation_requests
        drop constraint if exists tool_confirmation_requests_version_check,
        drop column if exists version,
        drop column if exists reconciliation_snapshot_json
    `);
  }
}
