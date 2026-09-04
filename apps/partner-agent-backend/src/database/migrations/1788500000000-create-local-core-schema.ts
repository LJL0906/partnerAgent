import type { MigrationInterface, QueryRunner } from 'typeorm';

// 固定锁序：batch -> candidates（按 id）-> objects（按 id）；再写审计、版本、来源和索引任务。
export const CONFIRMATION_TRANSACTION_LOCK_ORDER = [
  'confirmation_batches',
  'candidate_items:id',
  'business_objects:id',
] as const;

export class CreateLocalCoreSchema1788500000000 implements MigrationInterface {
  name = 'CreateLocalCoreSchema1788500000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('create extension if not exists pgcrypto');
    await queryRunner.query(`
      create table users (
        id text primary key,
        display_name text,
        timezone text not null default 'Asia/Shanghai',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await queryRunner.query(`
      insert into users (id)
      select distinct owner_id from chat_sessions
      on conflict (id) do nothing
    `);
    await queryRunner.query(`
      create function ensure_chat_session_user() returns trigger as $$
      begin
        insert into users (id) values (new.owner_id) on conflict (id) do nothing;
        return new;
      end;
      $$ language plpgsql
    `);
    await queryRunner.query(`
      create trigger chat_sessions_ensure_user_trigger
      before insert or update of owner_id on chat_sessions
      for each row execute function ensure_chat_session_user()
    `);
    await queryRunner.query(`
      alter table chat_sessions
        add column version bigint not null default 1 check (version >= 1),
        add column lifecycle_status text not null default 'active'
          check (lifecycle_status in ('active','archived','soft_deleted','purged')),
        add column updated_at timestamptz
    `);
    await queryRunner.query(`
      update chat_sessions set
        lifecycle_status = case
          when deleted_at is not null then 'soft_deleted'
          when archived_at is not null then 'archived'
          else 'active'
        end,
        updated_at = last_active_at
    `);
    await queryRunner.query(
      `alter table chat_sessions alter column updated_at set not null`,
    );
    await queryRunner.query(`
      alter table chat_sessions
        add constraint chat_sessions_owner_id_id_key unique (owner_id, id),
        add constraint chat_sessions_owner_fk foreign key (owner_id) references users(id)
    `);

    await queryRunner.query(
      `alter table session_messages add column owner_id text`,
    );
    await queryRunner.query(`
      update session_messages m set owner_id = s.owner_id
      from chat_sessions s where s.id = m.session_id
    `);
    await queryRunner.query(`
      create function fill_session_message_owner() returns trigger as $$
      begin
        select owner_id into new.owner_id from chat_sessions where id = new.session_id;
        if new.owner_id is null then
          raise exception 'chat session % does not exist', new.session_id;
        end if;
        return new;
      end;
      $$ language plpgsql
    `);
    await queryRunner.query(`
      create trigger session_messages_fill_owner_trigger
      before insert or update of session_id on session_messages
      for each row execute function fill_session_message_owner()
    `);
    await queryRunner.query(`
      alter table session_messages
        alter column owner_id set not null,
        add column input_id text,
        add column operation_id uuid,
        add column task_id uuid,
        add column original_record_id uuid,
        add column analysis_result_id uuid,
        add column completed_at timestamptz,
        add constraint session_messages_owner_session_fk
          foreign key (owner_id, session_id) references chat_sessions(owner_id, id)
          on delete cascade
    `);
    await queryRunner.query(
      `alter table session_messages drop constraint if exists session_messages_role_check`,
    );
    await queryRunner.query(
      `alter table session_messages drop constraint if exists session_messages_status_check`,
    );
    await queryRunner.query(`
      alter table session_messages
        add constraint session_messages_role_check
          check (role in ('user','assistant','system')),
        add constraint session_messages_status_check
          check (status in ('pending','streaming','complete','failed','cancelled')),
        add constraint session_messages_original_record_check
          check (role = 'user' or original_record_id is null)
    `);
    await queryRunner.query(`
      create unique index session_messages_owner_input_key
      on session_messages (owner_id, input_id) where input_id is not null
    `);
    await queryRunner.query(`
      create index session_messages_owner_created_idx
      on session_messages (owner_id, created_at desc)
    `);

    // 旧工具审批表保留用于兼容，但其 owner/session 关系必须由数据库约束，
    // 不能只依赖应用层分别写入两个字段。
    await queryRunner.query(`
      update tool_confirmation_requests t set owner_id = s.owner_id
      from chat_sessions s where s.id = t.session_id
    `);
    await queryRunner.query(`
      update tool_execution_receipts r set owner_id = c.owner_id, session_id = c.session_id
      from tool_confirmation_requests c where c.id = r.confirmation_id
    `);
    await queryRunner.query(`
      update tool_audit_logs a set owner_id = s.owner_id
      from chat_sessions s where s.id = a.session_id
    `);
    await queryRunner.query(`
      alter table tool_confirmation_requests
        add constraint tool_confirmation_requests_owner_id_id_key unique (owner_id, id),
        add constraint tool_confirmation_requests_owner_session_fk
          foreign key (owner_id, session_id) references chat_sessions(owner_id, id)
          on delete cascade
    `);
    await queryRunner.query(`
      alter table tool_execution_receipts
        drop constraint if exists tool_execution_receipts_confirmation_id_fkey,
        add constraint tool_receipts_owner_confirmation_key unique (owner_id, confirmation_id),
        add constraint tool_receipts_owner_session_fk
          foreign key (owner_id, session_id) references chat_sessions(owner_id, id)
          on delete cascade,
        add constraint tool_receipts_owner_confirmation_fk
          foreign key (owner_id, confirmation_id)
          references tool_confirmation_requests(owner_id, id)
    `);
    await queryRunner.query(`
      alter table tool_audit_logs
        add constraint tool_audits_owner_session_fk
          foreign key (owner_id, session_id) references chat_sessions(owner_id, id)
    `);

    await queryRunner.query(`
      create table confirmation_batches (
        id uuid primary key default gen_random_uuid(),
        user_id text not null references users(id),
        source_record_id uuid,
        source_analysis_id uuid,
        batch_status text not null default 'pending'
          check (batch_status in ('pending','partially_processed','confirmed','cancelled','expired')),
        risk_level text not null default 'normal' check (risk_level in ('normal','high')),
        expires_at timestamptz not null default (now() + interval '24 hours'),
        first_presented_at timestamptz,
        last_processed_at timestamptz,
        version bigint not null default 1 check (version >= 1),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint confirmation_batches_user_id_id_key unique (user_id, id)
      )
    `);
    await queryRunner.query(`
      create function enforce_confirmation_expiry() returns trigger as $$
      begin
        if tg_op = 'INSERT' then
          new.expires_at := transaction_timestamp() + interval '24 hours';
        elsif new.expires_at is distinct from old.expires_at then
          raise exception 'confirmation expiry is immutable';
        end if;
        return new;
      end;
      $$ language plpgsql
    `);
    await queryRunner.query(`
      create trigger confirmation_batches_fixed_expiry_trigger
      before insert or update of expires_at on confirmation_batches
      for each row execute function enforce_confirmation_expiry()
    `);
    await queryRunner.query(`
      create index confirmation_batches_pending_idx
      on confirmation_batches (user_id, created_at desc)
      where batch_status in ('pending','partially_processed')
    `);
    await queryRunner.query(`
      create table candidate_items (
        id uuid primary key default gen_random_uuid(),
        user_id text not null references users(id),
        batch_id uuid not null,
        kind text not null check (kind in ('goal','action','fact','memory','decision','situation','reminder')),
        action text not null check (action in ('create','update','status_change','archive','soft_delete','permanent_delete','restore','undo')),
        candidate_status text not null default 'pending'
          check (candidate_status in ('pending','confirmed','confirmed_after_edit','cancelled','expired')),
        risk text not null default 'normal' check (risk in ('normal','high')),
        payload jsonb not null,
        editable_fields text[] not null default '{}',
        edited_payload jsonb,
        confidence numeric(4,3) check (confidence between 0 and 1),
        sensitive_marks text[] not null default '{}',
        target_object_id uuid,
        expected_version bigint check (expected_version is null or expected_version >= 1),
        source_refs jsonb not null default '[]'::jsonb,
        expires_at timestamptz not null default (now() + interval '24 hours'),
        processed_at timestamptz,
        version bigint not null default 1 check (version >= 1),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint candidate_items_user_id_id_key unique (user_id, id),
        constraint candidate_items_user_batch_id_key unique (user_id, batch_id, id),
        constraint candidate_items_user_batch_fk foreign key (user_id, batch_id)
          references confirmation_batches(user_id, id),
        constraint candidate_items_target_check check (action = 'create' or target_object_id is not null),
        constraint candidate_items_edited_payload_check
          check (candidate_status = 'confirmed_after_edit' or edited_payload is null)
      )
    `);
    await queryRunner.query(`
      create trigger candidate_items_fixed_expiry_trigger
      before insert or update of expires_at on candidate_items
      for each row execute function enforce_confirmation_expiry()
    `);
    await queryRunner.query(`
      create index candidate_items_pending_expiry_idx
      on candidate_items (user_id, expires_at) where candidate_status = 'pending'
    `);
    await queryRunner.query(`
      create index candidate_items_batch_status_idx
      on candidate_items (user_id, batch_id, candidate_status)
    `);
    await queryRunner.query(`
      create function enforce_high_risk_candidate_batch() returns trigger as $$
      declare
        batch_risk text;
        candidate_count integer;
        contains_high_risk boolean;
      begin
        select b.risk_level into strict batch_risk
        from confirmation_batches b
        where b.id = new.batch_id and b.user_id = new.user_id
        for update;
        if new.risk <> batch_risk then
          raise exception 'candidate risk must match confirmation batch risk level';
        end if;
        select count(*), coalesce(bool_or(c.risk = 'high'), false)
        into candidate_count, contains_high_risk
        from candidate_items c
        where c.batch_id = new.batch_id and c.user_id = new.user_id;
        if (batch_risk = 'high' or contains_high_risk) and candidate_count <> 1 then
          raise exception 'high-risk confirmation batch must contain exactly one candidate';
        end if;
        return null;
      end;
      $$ language plpgsql
    `);
    await queryRunner.query(`
      create constraint trigger candidate_items_high_risk_batch_trigger
      after insert or update of batch_id, user_id, risk on candidate_items
      deferrable initially deferred for each row
      execute function enforce_high_risk_candidate_batch()
    `);
    await queryRunner.query(`
      create function enforce_confirmation_batch_risk() returns trigger as $$
      declare
        candidate_count integer;
        mismatched_count integer;
      begin
        select count(*), count(*) filter (where c.risk <> new.risk_level)
        into candidate_count, mismatched_count
        from candidate_items c
        where c.batch_id = new.id and c.user_id = new.user_id;
        if mismatched_count > 0 then
          raise exception 'candidate risk must match confirmation batch risk level';
        end if;
        if new.risk_level = 'high' and candidate_count > 1 then
          raise exception 'high-risk confirmation batch must contain exactly one candidate';
        end if;
        return null;
      end;
      $$ language plpgsql
    `);
    await queryRunner.query(`
      create constraint trigger confirmation_batches_risk_trigger
      after update of risk_level on confirmation_batches
      deferrable initially deferred for each row
      execute function enforce_confirmation_batch_risk()
    `);

    await queryRunner.query(`
      create table confirmation_actions (
        id uuid primary key default gen_random_uuid(),
        user_id text not null references users(id),
        batch_id uuid not null,
        candidate_id uuid,
        operation_id uuid not null,
        request_fingerprint text not null,
        action_type text not null check (action_type in ('confirm','confirm_after_edit','cancel','undo')),
        submitted_payload jsonb,
        client_source text not null check (client_source in ('ios','android','web','other')),
        reverses_action_id uuid,
        attempts integer not null default 1 check (attempts >= 1),
        last_error jsonb,
        created_at timestamptz not null default now(),
        constraint confirmation_actions_user_id_id_key unique (user_id, id),
        constraint confirmation_actions_user_operation_key unique (user_id, operation_id),
        constraint confirmation_actions_user_batch_fk foreign key (user_id, batch_id)
          references confirmation_batches(user_id, id),
        constraint confirmation_actions_user_candidate_fk foreign key (user_id, batch_id, candidate_id)
          references candidate_items(user_id, batch_id, id),
        constraint confirmation_actions_user_reverse_fk foreign key (user_id, reverses_action_id)
          references confirmation_actions(user_id, id)
      )
    `);
    await queryRunner.query(
      `create index confirmation_actions_batch_created_idx on confirmation_actions (user_id, batch_id, created_at desc)`,
    );
    await queryRunner.query(`
      create table business_objects (
        id uuid primary key default gen_random_uuid(),
        user_id text not null references users(id),
        kind text not null check (kind in ('goal','action','fact','memory','decision','situation','reminder')),
        version bigint not null default 1 check (version >= 1),
        lifecycle_status text not null default 'active'
          check (lifecycle_status in ('active','archived','soft_deleted','purged')),
        created_by_batch_id uuid not null,
        last_confirmation_batch_id uuid not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        archived_at timestamptz,
        deleted_at timestamptz,
        purged_at timestamptz,
        constraint business_objects_user_id_id_key unique (user_id, id),
        constraint business_objects_created_batch_fk foreign key (user_id, created_by_batch_id)
          references confirmation_batches(user_id, id),
        constraint business_objects_last_batch_fk foreign key (user_id, last_confirmation_batch_id)
          references confirmation_batches(user_id, id),
        constraint business_objects_archived_at_check
          check (lifecycle_status <> 'archived' or archived_at is not null),
        constraint business_objects_deleted_at_check
          check (lifecycle_status not in ('soft_deleted','purged') or deleted_at is not null),
        constraint business_objects_purged_at_check
          check (lifecycle_status <> 'purged' or purged_at is not null)
      )
    `);
    await queryRunner.query(`
      alter table candidate_items add constraint candidate_items_user_target_fk
      foreign key (user_id, target_object_id) references business_objects(user_id, id)
    `);
    await queryRunner.query(`
      create index business_objects_active_kind_idx
      on business_objects (user_id, kind, updated_at desc) where lifecycle_status = 'active'
    `);
    await queryRunner.query(`
      create table goals (
        id uuid primary key,
        user_id text not null,
        title text not null,
        description text,
        goal_status text not null default 'planning'
          check (goal_status in ('planning','active','paused','completed','abandoned','expired')),
        deadline_at timestamptz,
        deadline_observation text not null default 'not_due'
          check (deadline_observation in ('not_due','due')),
        confirmed_at timestamptz not null,
        constraint goals_user_id_id_key unique (user_id, id),
        constraint goals_user_object_fk foreign key (user_id, id)
          references business_objects(user_id, id)
      )
    `);
    await queryRunner.query(`
      create index goals_active_status_deadline_idx
      on goals (user_id, goal_status, deadline_at)
      where goal_status not in ('completed','abandoned','expired')
    `);
    await queryRunner.query(`
      create table actions (
        id uuid primary key,
        user_id text not null,
        title text not null,
        description text,
        execution_status text not null default 'todo'
          check (execution_status in ('todo','in_progress','paused','done','cancelled')),
        plan_status text not null default 'normal'
          check (plan_status in ('normal','rescheduled')),
        timeliness_status text not null default 'no_deadline'
          check (timeliness_status in ('no_deadline','not_due','overdue','not_applicable')),
        deadline_at timestamptz,
        planned_at timestamptz,
        started_at timestamptz,
        completed_at timestamptz,
        constraint actions_user_id_id_key unique (user_id, id),
        constraint actions_user_object_fk foreign key (user_id, id)
          references business_objects(user_id, id),
        constraint actions_timeliness_deadline_check
          check (deadline_at is not null or timeliness_status in ('no_deadline','not_applicable')),
        constraint actions_completed_at_check
          check (execution_status <> 'done' or completed_at is not null)
      )
    `);
    await queryRunner.query(`
      create index actions_open_deadline_idx
      on actions (user_id, execution_status, deadline_at)
      where execution_status not in ('done','cancelled')
    `);
    await queryRunner.query(`
      create index actions_overdue_idx
      on actions (user_id, deadline_at) where timeliness_status = 'overdue'
    `);
    await queryRunner.query(`
      create table formal_object_details (
        id uuid primary key,
        user_id text not null,
        content jsonb not null,
        domain_status text not null,
        confidence numeric(4,3) check (confidence between 0 and 1),
        is_sensitive boolean not null default false,
        confirmed_at timestamptz not null,
        supersedes_object_id uuid,
        constraint formal_object_details_user_id_id_key unique (user_id, id),
        constraint formal_object_details_user_object_fk foreign key (user_id, id)
          references business_objects(user_id, id),
        constraint formal_object_details_user_supersedes_fk foreign key (user_id, supersedes_object_id)
          references business_objects(user_id, id)
      )
    `);
    await queryRunner.query(`
      create table goal_action_relations (
        user_id text not null references users(id),
        goal_id uuid not null,
        action_id uuid not null,
        relation_type text not null default 'supports',
        created_at timestamptz not null default now(),
        primary key (user_id, goal_id, action_id),
        constraint goal_action_relations_user_goal_fk foreign key (user_id, goal_id)
          references goals(user_id, id),
        constraint goal_action_relations_user_action_fk foreign key (user_id, action_id)
          references actions(user_id, id)
      )
    `);
    await queryRunner.query(`
      create index goal_action_relations_action_idx
      on goal_action_relations (user_id, action_id)
    `);
    await queryRunner.query(`
      create table object_versions (
        id uuid primary key default gen_random_uuid(),
        user_id text not null,
        object_id uuid not null,
        object_version bigint not null check (object_version >= 1),
        snapshot jsonb not null,
        change_type text not null,
        confirmation_action_id uuid not null,
        created_at timestamptz not null default now(),
        constraint object_versions_user_object_version_key unique (user_id, object_id, object_version),
        constraint object_versions_user_object_fk foreign key (user_id, object_id)
          references business_objects(user_id, id),
        constraint object_versions_user_action_fk foreign key (user_id, confirmation_action_id)
          references confirmation_actions(user_id, id)
      )
    `);
    await queryRunner.query(`
      create index object_versions_latest_idx
      on object_versions (user_id, object_id, object_version desc)
    `);
    await queryRunner.query(`
      create table source_relations (
        id uuid primary key default gen_random_uuid(),
        user_id text not null references users(id),
        object_id uuid not null,
        source_kind text not null,
        source_id text not null,
        relation_type text not null,
        source_excerpt text,
        source_deleted boolean not null default false,
        created_at timestamptz not null default now(),
        constraint source_relations_user_object_fk foreign key (user_id, object_id)
          references business_objects(user_id, id)
      )
    `);
    await queryRunner.query(
      `create index source_relations_object_idx on source_relations (user_id, object_id)`,
    );
    await queryRunner.query(
      `create index source_relations_reverse_idx on source_relations (user_id, source_kind, source_id)`,
    );
    await queryRunner.query(`
      create table object_index_jobs (
        id uuid primary key default gen_random_uuid(),
        user_id text not null,
        object_id uuid not null,
        object_version bigint not null check (object_version >= 1),
        status text not null default 'pending'
          check (status in ('pending','processing','succeeded','retrying','failed')),
        attempts integer not null default 0 check (attempts >= 0),
        last_error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint object_index_jobs_user_object_fk foreign key (user_id, object_id)
          references business_objects(user_id, id),
        constraint object_index_jobs_object_version_fk foreign key (user_id, object_id, object_version)
          references object_versions(user_id, object_id, object_version)
      )
    `);
    await queryRunner.query(`
      create index object_index_jobs_pending_idx on object_index_jobs (status, created_at, id)
      where status in ('pending','retrying')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop table if exists object_index_jobs');
    await queryRunner.query('drop table if exists source_relations');
    await queryRunner.query('drop table if exists object_versions');
    await queryRunner.query('drop table if exists goal_action_relations');
    await queryRunner.query('drop table if exists formal_object_details');
    await queryRunner.query('drop table if exists actions');
    await queryRunner.query('drop table if exists goals');
    await queryRunner.query(
      'alter table candidate_items drop constraint if exists candidate_items_user_target_fk',
    );
    await queryRunner.query('drop table if exists business_objects');
    await queryRunner.query('drop table if exists confirmation_actions');
    await queryRunner.query(
      'drop trigger if exists confirmation_batches_risk_trigger on confirmation_batches',
    );
    await queryRunner.query(
      'drop function if exists enforce_confirmation_batch_risk',
    );
    await queryRunner.query(
      'drop trigger if exists candidate_items_high_risk_batch_trigger on candidate_items',
    );
    await queryRunner.query(
      'drop function if exists enforce_high_risk_candidate_batch',
    );
    await queryRunner.query('drop table if exists candidate_items');
    await queryRunner.query('drop table if exists confirmation_batches');
    await queryRunner.query(
      'drop function if exists enforce_confirmation_expiry',
    );
    await queryRunner.query(
      'drop trigger if exists session_messages_fill_owner_trigger on session_messages',
    );
    await queryRunner.query(
      'drop function if exists fill_session_message_owner',
    );
    await queryRunner.query(
      'drop index if exists session_messages_owner_created_idx',
    );
    await queryRunner.query(
      'drop index if exists session_messages_owner_input_key',
    );
    await queryRunner.query(`
      alter table tool_audit_logs
        drop constraint if exists tool_audits_owner_session_fk
    `);
    await queryRunner.query(`
      alter table tool_execution_receipts
        drop constraint if exists tool_receipts_owner_confirmation_fk,
        drop constraint if exists tool_receipts_owner_session_fk,
        drop constraint if exists tool_receipts_owner_confirmation_key,
        add constraint tool_execution_receipts_confirmation_id_fkey
          foreign key (confirmation_id) references tool_confirmation_requests(id)
    `);
    await queryRunner.query(`
      alter table tool_confirmation_requests
        drop constraint if exists tool_confirmation_requests_owner_session_fk,
        drop constraint if exists tool_confirmation_requests_owner_id_id_key
    `);
    await queryRunner.query(`
      alter table session_messages
        drop constraint if exists session_messages_original_record_check,
        drop constraint if exists session_messages_owner_session_fk,
        drop column if exists analysis_result_id,
        drop column if exists original_record_id,
        drop column if exists task_id,
        drop column if exists operation_id,
        drop column if exists input_id,
        drop column if exists completed_at,
        drop column if exists owner_id
    `);
    await queryRunner.query(
      'alter table session_messages drop constraint if exists session_messages_role_check',
    );
    await queryRunner.query(
      'alter table session_messages drop constraint if exists session_messages_status_check',
    );
    await queryRunner.query(
      `alter table session_messages add constraint session_messages_role_check check (role in ('user','assistant'))`,
    );
    await queryRunner.query(
      `alter table session_messages add constraint session_messages_status_check check (status = 'complete')`,
    );
    await queryRunner.query(
      'drop trigger if exists chat_sessions_ensure_user_trigger on chat_sessions',
    );
    await queryRunner.query('drop function if exists ensure_chat_session_user');
    await queryRunner.query(`
      alter table chat_sessions
        drop constraint if exists chat_sessions_owner_fk,
        drop constraint if exists chat_sessions_owner_id_id_key,
        drop column if exists updated_at,
        drop column if exists lifecycle_status,
        drop column if exists version
    `);
    await queryRunner.query('drop table if exists users');
  }
}
