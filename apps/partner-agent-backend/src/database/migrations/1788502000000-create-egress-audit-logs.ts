import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEgressAuditLogs1788502000000 implements MigrationInterface {
  name = 'CreateEgressAuditLogs1788502000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table egress_audit_logs (
        request_id uuid primary key,
        task_id uuid references chat_tasks(id) on delete set null,
        source text not null,
        categories text[] not null,
        policy_result text not null
          check (policy_result in ('allowed','redacted','pending_user_decision','blocked')),
        provider text not null,
        created_at timestamptz not null
      )
    `);
    await queryRunner.query(
      `create index egress_audit_task_created_idx on egress_audit_logs (task_id, created_at desc)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop table if exists egress_audit_logs');
  }
}
