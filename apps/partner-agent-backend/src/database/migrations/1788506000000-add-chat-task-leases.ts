import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatTaskLeases1788506000000 implements MigrationInterface {
  name = 'AddChatTaskLeases1788506000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table chat_tasks
        add column lease_owner text,
        add column lease_expires_at timestamptz,
        add column attempt_count integer not null default 0,
        add column waiting_tool_confirmation_id uuid
    `);
    await queryRunner.query(`
      alter table chat_tasks
        drop constraint chat_tasks_state_check,
        add constraint chat_tasks_state_check check (
          state in (
            'queued','running','waiting_privacy_decision','waiting_tool_approval',
            'completed','failed','cancelled'
          )
        )
    `);
    await queryRunner.query(`
      update chat_tasks
      set state = 'queued',
          started_at = null,
          updated_at = transaction_timestamp()
      where state = 'running'
    `);
    await queryRunner.query(`
      alter table chat_tasks
        add constraint chat_tasks_attempt_count_check check (attempt_count >= 0),
        add constraint chat_tasks_lease_state_check check (
          (state = 'running' and lease_owner is not null and lease_expires_at is not null)
          or
          (state <> 'running' and lease_owner is null and lease_expires_at is null)
        ),
        add constraint chat_tasks_waiting_tool_check check (
          (state = 'waiting_tool_approval' and waiting_tool_confirmation_id is not null)
          or
          (state <> 'waiting_tool_approval' and waiting_tool_confirmation_id is null)
        )
    `);
    await queryRunner.query(`
      create unique index chat_tasks_one_running_per_session_key
        on chat_tasks (session_id)
        where state = 'running'
    `);
    await queryRunner.query(`
      create index chat_tasks_runnable_idx
        on chat_tasks (state, created_at)
        where state in ('queued', 'running')
    `);
    await queryRunner.query(`
      alter table tool_confirmation_requests
        add column task_id uuid,
        add column operation_id text,
        add column result_json jsonb,
        add constraint tool_confirmation_requests_owner_task_fk
          foreign key (owner_id, task_id) references chat_tasks(owner_id, id),
        add constraint tool_confirmation_requests_owner_operation_fk
          foreign key (owner_id, operation_id)
          references local_core_operations(owner_id, operation_id)
    `);
    await queryRunner.query(`
      alter table tool_confirmation_requests
        drop constraint tool_confirmation_requests_status_check,
        add constraint tool_confirmation_requests_status_check check (
          status in (
            'pending','executing','succeeded','failed','dismissed','expired',
            'undone','indeterminate'
          )
        )
    `);
    await queryRunner.query(`
      create index tool_confirmations_owner_task_idx
        on tool_confirmation_requests (owner_id, task_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'drop index if exists tool_confirmations_owner_task_idx',
    );
    await queryRunner.query(`
      update tool_confirmation_requests
      set status = 'failed'
      where status = 'indeterminate'
    `);
    await queryRunner.query(`
      alter table tool_confirmation_requests
        drop constraint if exists tool_confirmation_requests_status_check,
        add constraint tool_confirmation_requests_status_check check (
          status in (
            'pending','executing','succeeded','failed','dismissed','expired','undone'
          )
        )
    `);
    await queryRunner.query(`
      alter table tool_confirmation_requests
        drop constraint if exists tool_confirmation_requests_owner_operation_fk,
        drop constraint if exists tool_confirmation_requests_owner_task_fk,
        drop column if exists result_json,
        drop column if exists operation_id,
        drop column if exists task_id
    `);
    await queryRunner.query('drop index if exists chat_tasks_runnable_idx');
    await queryRunner.query(
      'drop index if exists chat_tasks_one_running_per_session_key',
    );
    await queryRunner.query(`
      update chat_tasks
      set state = 'failed',
          error_code = coalesce(error_code, 'INTERNAL_000'),
          error_message = coalesce(error_message, '工具审批等待被回滚'),
          completed_at = coalesce(completed_at, transaction_timestamp()),
          waiting_tool_confirmation_id = null,
          updated_at = transaction_timestamp()
      where state = 'waiting_tool_approval'
    `);
    await queryRunner.query(`
      alter table chat_tasks
        drop constraint if exists chat_tasks_state_check,
        add constraint chat_tasks_state_check check (
          state in ('queued','running','waiting_privacy_decision','completed','failed','cancelled')
        ),
        drop constraint if exists chat_tasks_lease_state_check,
        drop constraint if exists chat_tasks_waiting_tool_check,
        drop constraint if exists chat_tasks_attempt_count_check,
        drop column if exists waiting_tool_confirmation_id,
        drop column if exists attempt_count,
        drop column if exists lease_expires_at,
        drop column if exists lease_owner
    `);
  }
}
