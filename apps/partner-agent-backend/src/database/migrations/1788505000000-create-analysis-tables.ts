import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAnalysisTables1788505000000 implements MigrationInterface {
  name = 'CreateAnalysisTables1788505000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table analysis_runs (
        id uuid primary key default gen_random_uuid(),
        owner_id text not null references users(id),
        original_record_id uuid not null,
        chat_task_id uuid not null,
        analysis_type text not null,
        status text not null default 'queued',
        request_fingerprint text not null,
        error_summary text,
        started_at timestamptz,
        completed_at timestamptz,
        version bigint not null default 1,
        created_at timestamptz not null default transaction_timestamp(),
        updated_at timestamptz not null default transaction_timestamp(),
        constraint analysis_runs_owner_id_key unique (owner_id, id),
        constraint analysis_runs_owner_task_type_key unique (owner_id, chat_task_id, analysis_type),
        constraint analysis_runs_owner_record_fk foreign key (owner_id, original_record_id)
          references original_records(owner_id, id),
        constraint analysis_runs_owner_task_fk foreign key (owner_id, chat_task_id)
          references chat_tasks(owner_id, id),
        constraint analysis_runs_type_check check (
          analysis_type in ('idea_organize','experience_review','problem_analysis','content_extract','action')
        ),
        constraint analysis_runs_status_check check (
          status in ('queued','running','completed','partially_completed','failed','cancelled')
        ),
        constraint analysis_runs_version_check check (version >= 1)
      )
    `);
    await queryRunner.query(`
      create index analysis_runs_owner_status_created_idx
        on analysis_runs (owner_id, status, created_at desc)
    `);
    await queryRunner.query(`
      create index analysis_runs_owner_record_created_idx
        on analysis_runs (owner_id, original_record_id, created_at desc)
    `);
    await queryRunner.query(`
      create index analysis_runs_owner_task_created_idx
        on analysis_runs (owner_id, chat_task_id, created_at desc)
    `);

    await queryRunner.query(`
      create table structured_analyses (
        id uuid primary key default gen_random_uuid(),
        owner_id text not null references users(id),
        analysis_run_id uuid not null,
        schema_version integer not null default 1,
        status text not null,
        result_json jsonb not null,
        validation_errors jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default transaction_timestamp(),
        constraint structured_analyses_owner_id_key unique (owner_id, id),
        constraint structured_analyses_owner_run_key unique (owner_id, analysis_run_id),
        constraint structured_analyses_owner_run_fk foreign key (owner_id, analysis_run_id)
          references analysis_runs(owner_id, id) on delete cascade,
        constraint structured_analyses_schema_version_check check (schema_version >= 1),
        constraint structured_analyses_status_check check (
          status in ('valid','partially_valid','invalid')
        )
      )
    `);

    await queryRunner.query(`
      alter table confirmation_batches
        add constraint confirmation_batches_user_record_fk
          foreign key (user_id, source_record_id)
          references original_records(owner_id, id),
        add constraint confirmation_batches_user_analysis_fk
          foreign key (user_id, source_analysis_id)
          references structured_analyses(owner_id, id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table confirmation_batches
        drop constraint if exists confirmation_batches_user_analysis_fk,
        drop constraint if exists confirmation_batches_user_record_fk
    `);
    await queryRunner.query('drop table if exists structured_analyses');
    await queryRunner.query('drop table if exists analysis_runs');
  }
}
