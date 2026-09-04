import type { MigrationInterface, QueryRunner } from 'typeorm';

export class StrengthenEgressAuditLogs1788504000000 implements MigrationInterface {
  name = 'StrengthenEgressAuditLogs1788504000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table egress_audit_logs
        add column egress_id uuid,
        add column owner_id text,
        add column session_id text,
        add column operation_id text,
        add column request_fingerprint text,
        add column model_id text
    `);
    await queryRunner.query(`
      update egress_audit_logs audit
      set owner_id = task.owner_id,
          session_id = task.session_id,
          operation_id = task.operation_id
      from chat_tasks task
      where audit.task_id = task.id
        and (audit.owner_id is null or audit.session_id is null or audit.operation_id is null)
    `);
    await queryRunner.query(`
      alter table egress_audit_logs
        add constraint egress_audit_owner_fk foreign key (owner_id)
          references users(id),
        add constraint egress_audit_owner_nonempty_check
          check (owner_id is null or btrim(owner_id) <> ''),
        add constraint egress_audit_session_nonempty_check
          check (session_id is null or btrim(session_id) <> ''),
        add constraint egress_audit_operation_nonempty_check
          check (operation_id is null or btrim(operation_id) <> ''),
        add constraint egress_audit_fingerprint_nonempty_check
          check (request_fingerprint is null or btrim(request_fingerprint) <> ''),
        add constraint egress_audit_model_nonempty_check
          check (model_id is null or btrim(model_id) <> ''),
        add constraint egress_audit_metadata_completeness_check check (
          (request_fingerprint is null and model_id is null)
          or (
            owner_id is not null
            and session_id is not null
            and request_fingerprint is not null
            and model_id is not null
          )
        )
    `);
    await queryRunner.query(`
      create index egress_audit_owner_created_idx
        on egress_audit_logs (owner_id, created_at desc)
    `);
    await queryRunner.query(`
      create index egress_audit_fingerprint_created_idx
        on egress_audit_logs (request_fingerprint, created_at desc)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'drop index if exists egress_audit_fingerprint_created_idx',
    );
    await queryRunner.query(
      'drop index if exists egress_audit_owner_created_idx',
    );
    await queryRunner.query(`
      alter table egress_audit_logs
        drop constraint if exists egress_audit_metadata_completeness_check,
        drop constraint if exists egress_audit_model_nonempty_check,
        drop constraint if exists egress_audit_fingerprint_nonempty_check,
        drop constraint if exists egress_audit_operation_nonempty_check,
        drop constraint if exists egress_audit_session_nonempty_check,
        drop constraint if exists egress_audit_owner_nonempty_check,
        drop constraint if exists egress_audit_owner_fk,
        drop column if exists model_id,
        drop column if exists request_fingerprint,
        drop column if exists operation_id,
        drop column if exists session_id,
        drop column if exists owner_id,
        drop column if exists egress_id
    `);
  }
}
