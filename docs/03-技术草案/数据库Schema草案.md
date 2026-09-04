# 数据库 Schema 草案

> 状态：PostgreSQL 逻辑/DDL 实现基线；TypeORM Entity/Migration 与此文档同步。  
> 范围：用户、会话、消息、候选、确认批次、正式对象；状态口径以《P0 决策收口文档》正式基线为准。

## 1. 原则

- 新业务对象 ID 用 UUID，时间用 `timestamptz`，版本用单调递增 `bigint`。现存用户/会话边界保留 text ID，见下方兼容口径。
- 所有用户域表带 `user_id`；关键外键用 `(user_id, id)` 复合约束，防止串用户关联。
- 业务状态与生命周期分离。状态、归属、风险和版本不藏入 JSONB。
- 枚举暂用 `text + CHECK`，便于拍板后迁移；不在草案阶段锁死 PostgreSQL enum。
- 正式对象创建/变更、来源关系、变更历史和索引任务在同一确认事务中登记。

## 2. 现存持久化的物理兼容口径

项目已有 `chat_sessions(id text, owner_id text)` 和 `session_messages(session_id text)`，不通过重建表或改主键类型破坏用户已有数据。可执行迁移 [`1788500000000-create-local-core-schema.ts`](../../apps/partner-agent-backend/src/database/migrations/1788500000000-create-local-core-schema.ts) 采用：

- `users.id text` 直接对应 JWT `sub`；旧 `owner_id` 回填并外键到 `users.id`。
- 复用 `chat_sessions.id text/owner_id text`，新增 `version/lifecycle_status/updated_at`。
- 复用 `session_messages.session_id text`，新增 `owner_id`及输入、操作、任务和来源引用字段。
- 新增业务表使用 `user_id text`，与现存认证边界一致；对象/批次/候选 ID 仍使用 UUID。
- 迁移先回填旧数据，再加 `NOT NULL`、复合外键和局部索引；兼容触发器保证旧会话写入路径仍可用。
- 旧工具确认、执行回执和审计表保留兼容数据，但统一补齐 `(owner_id, session_id)` 复合外键；回执到确认请求使用 `(owner_id, confirmation_id)` 复合外键，避免跨用户串联。
- Confirmation Batch 与 Candidate 的 `expires_at` 在插入时由数据库时间强制写为 24 小时后，并在写入后保持不可变；调用方传入的过期时间会被覆盖。

下方 SQL 表达目标逻辑模型；现有库的物理升级以上述 TypeORM migration 为权威实现。

## 3. 核心逻辑 DDL

```sql
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null unique,
  display_name text,
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  title text,
  version bigint not null default 1 check (version >= 1),
  lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active','archived','soft_deleted','purged')),
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, id),
  check ((lifecycle_status in ('soft_deleted','purged')) = (deleted_at is not null))
);

create table session_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  sequence_no bigint not null check (sequence_no >= 1),
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  message_status text not null default 'completed'
    check (message_status in ('pending','streaming','completed','failed','cancelled')),
  input_id text,
  operation_id uuid,
  task_id uuid,
  original_record_id uuid,
  analysis_result_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, id),
  unique (session_id, sequence_no),
  foreign key (user_id, session_id) references chat_sessions(user_id, id),
  check (role = 'user' or original_record_id is null)
);
create unique index uq_session_messages_input
  on session_messages(user_id, input_id) where input_id is not null;

create table confirmation_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  source_record_id uuid,
  source_analysis_id uuid,
  batch_status text not null default 'pending'
    check (batch_status in ('pending','partially_processed','confirmed','cancelled','expired')),
  risk_level text not null default 'normal' check (risk_level in ('normal','high')),
  expires_at timestamptz not null,
  first_presented_at timestamptz,
  last_processed_at timestamptz,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table candidate_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  batch_id uuid not null,
  kind text not null
    check (kind in ('goal','action','fact','memory','decision','situation','reminder')),
  action text not null
    check (action in ('create','update','status_change','archive','soft_delete','permanent_delete','restore','undo')),
  candidate_status text not null default 'pending'
    check (candidate_status in ('pending','confirmed','confirmed_after_edit','cancelled','expired')),
  risk text not null default 'normal' check (risk in ('normal','high')),
  payload jsonb not null,
  edited_payload jsonb,
  confidence numeric(4,3) check (confidence between 0 and 1),
  sensitive_marks text[] not null default '{}',
  target_object_id uuid,
  expected_version bigint,
  source_refs jsonb not null default '[]',
  expires_at timestamptz not null,
  processed_at timestamptz,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, batch_id) references confirmation_batches(user_id, id),
  check (action = 'create' or target_object_id is not null),
  check (candidate_status = 'confirmed_after_edit' or edited_payload is null)
);

create table confirmation_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  batch_id uuid not null,
  candidate_id uuid,
  operation_id uuid not null,
  request_fingerprint text not null,
  action_type text not null
    check (action_type in ('confirm','confirm_after_edit','cancel','undo')),
  submitted_payload jsonb,
  client_source text not null check (client_source in ('ios','android','web','other')),
  reverses_action_id uuid,
  attempts integer not null default 1 check (attempts >= 1),
  last_error jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, operation_id),
  foreign key (user_id, batch_id) references confirmation_batches(user_id, id),
  foreign key (user_id, candidate_id) references candidate_items(user_id, id),
  foreign key (user_id, reverses_action_id) references confirmation_actions(user_id, id)
);

create table business_objects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null
    check (kind in ('goal','action','fact','memory','decision','situation','reminder')),
  version bigint not null default 1 check (version >= 1),
  lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active','archived','soft_deleted','purged')),
  created_by_batch_id uuid,
  last_confirmation_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  purged_at timestamptz,
  unique (user_id, id),
  foreign key (user_id, created_by_batch_id) references confirmation_batches(user_id, id),
  foreign key (user_id, last_confirmation_batch_id) references confirmation_batches(user_id, id),
  check ((lifecycle_status = 'archived') = (archived_at is not null)),
  check ((lifecycle_status in ('soft_deleted','purged')) = (deleted_at is not null)),
  check ((lifecycle_status = 'purged') = (purged_at is not null))
);

create table goals (
  id uuid primary key,
  user_id uuid not null,
  title text not null,
  description text,
  goal_status text not null
    check (goal_status in ('planning','active','completed','paused','abandoned','expired')),
  deadline_at timestamptz,
  deadline_observation text not null default 'not_due'
    check (deadline_observation in ('not_due','due')),
  confirmed_at timestamptz not null,
  unique (user_id, id),
  foreign key (user_id, id) references business_objects(user_id, id)
);

create table actions (
  id uuid primary key,
  user_id uuid not null,
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
  unique (user_id, id),
  foreign key (user_id, id) references business_objects(user_id, id),
  check (deadline_at is not null or timeliness_status = 'no_deadline'),
  check ((execution_status = 'done') = (completed_at is not null))
);

create table formal_object_details (
  id uuid primary key,
  user_id uuid not null,
  content jsonb not null,
  domain_status text not null,
  confidence numeric(4,3) check (confidence between 0 and 1),
  is_sensitive boolean not null default false,
  confirmed_at timestamptz,
  supersedes_object_id uuid,
  unique (user_id, id),
  foreign key (user_id, id) references business_objects(user_id, id),
  foreign key (user_id, supersedes_object_id) references business_objects(user_id, id)
);

create table goal_action_relations (
  user_id uuid not null references users(id),
  goal_id uuid not null,
  action_id uuid not null,
  relation_type text not null default 'supports',
  created_at timestamptz not null default now(),
  primary key (goal_id, action_id),
  foreign key (user_id, goal_id) references goals(user_id, id),
  foreign key (user_id, action_id) references actions(user_id, id)
);

create table object_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  object_id uuid not null,
  object_version bigint not null check (object_version >= 1),
  snapshot jsonb not null,
  change_type text not null,
  confirmation_action_id uuid not null,
  created_at timestamptz not null default now(),
  unique (object_id, object_version),
  foreign key (user_id, object_id) references business_objects(user_id, id),
  foreign key (user_id, confirmation_action_id) references confirmation_actions(user_id, id)
);

create table source_relations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  object_id uuid not null,
  source_kind text not null,
  source_id uuid not null,
  relation_type text not null,
  source_excerpt text,
  source_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (user_id, object_id) references business_objects(user_id, id)
);
```

`formal_object_details` 承载 Fact / Memory / Decision / Situation / Reminder 的差异内容；一旦某类需要独立状态约束或高频索引，再拆为专表。Goal / Action 因 P0-4 强状态机直接拆表。

## 4. 必要索引

```sql
create index ix_chat_sessions_active
  on chat_sessions(user_id, last_active_at desc) where lifecycle_status = 'active';
create index ix_session_messages_user_time on session_messages(user_id, created_at desc);
create index ix_candidates_status_expiry on candidate_items(user_id, candidate_status, expires_at);
create index ix_candidates_batch_status on candidate_items(user_id, batch_id, candidate_status);
create index ix_batches_status_time on confirmation_batches(user_id, batch_status, created_at desc);
create index ix_objects_kind_status on business_objects(user_id, kind, lifecycle_status, updated_at desc);
create index ix_object_versions_latest on object_versions(user_id, object_id, object_version desc);
create index ix_goals_status_deadline on goals(user_id, goal_status, deadline_at);
create index ix_actions_execution_deadline on actions(user_id, execution_status, deadline_at);
create index ix_actions_timeliness_deadline on actions(user_id, timeliness_status, deadline_at);
create index ix_sources_object on source_relations(user_id, object_id);
create index ix_sources_reverse on source_relations(user_id, source_kind, source_id);
```

## 5. P0-4 状态和事务约束

### 5.1 Candidate / Batch

- Candidate：`pending -> confirmed | confirmed_after_edit | cancelled | expired`；终态不可二次处理。
- 确认时若 `expires_at <= now()`，同一事务中置 `expired` 并拒绝生效。
- `expires_at` 由数据库在插入时固定为数据库当前时间后 24 小时，之后不可修改；客户端或普通调用方不能自定义正式过期时间。
- Batch：`pending -> partially_processed -> confirmed | cancelled | expired`；批次状态由所属候选聚合，不允许客户端直写。
- 一次 `SubmitConfirmationBatch` 所选项全部成功或全部回滚。高风险批次仅允许一个候选：数据库延迟约束触发器在校验前先 `FOR UPDATE` 锁定所属 batch，以串行化并发插入；事务服务仍需在同一固定锁序中提前校验并返回领域错误。

### 5.2 Action

- `todo -> in_progress | paused | done | cancelled`。
- `in_progress -> paused | done | cancelled`。
- `paused -> todo | in_progress | done | cancelled`。
- `done/cancelled` 不允许普通前向重开；只能经 `restore/undo` 候选产生可审计的反向版本。
- execution/plan 的业务变更走确认中心；timeliness 是时间观察，可由调度任务更新，不得联动 execution。

### 5.3 Goal 和其他正式对象

- Goal 到期只更新 `deadline_observation=due`；关联 Action 全完成也不自动改 Goal。
- Goal 状态改变必须来自确认候选，不得级联修改 Action。
- Memory 冲突时新建候选；确认后保留旧版本/来源并标记过期，不直接覆盖旧正文。
- Fact 高风险场景单独确认；Fact 保存/检索不自动升级为 Memory。
- lifecycle：`active -> archived | soft_deleted`；`archived -> active | soft_deleted`；`soft_deleted -> active` 只经 restore 确认；`purged` 需二次确认且不可逆。

### 5.4 确认事务和并发

1. `SELECT ... FOR UPDATE` 按固定顺序锁定 batch、本次 candidates（按 id）和目标 `business_objects`（按 id）；高风险单候选数据库触发器同样锁定 batch，避免并发绕过。
2. 校验所有权、候选状态/过期、风险拆批、`expected_version`、`operation_id + request_fingerprint`。
3. 写正式对象、`object_versions`、`source_relations`和 `confirmation_actions`，并登记索引更新任务。
4. 更新 candidates / batch；任一步失败整体回滚。
5. 同 `operation_id + fingerprint` 返回原结果；同 ID 异 fingerprint 返回 `IDEMPOTENCY_001`。

## 6. 已统一的基线口径

| # | 原差异 | 正式口径 |
|---|---|---|
| 1 | Goal 缺“规划中/已过期”，并把归档混入业务状态 | `planning/active/completed/paused/abandoned/expired`；`archived` 仅属于 lifecycle |
| 2 | Action plan/timeliness 有重叠和多余枚举 | plan=`normal/rescheduled`；timeliness=`no_deadline/not_due/overdue/not_applicable` |
| 3 | Candidate 使用 `rejected` 且缺少修改后确认态 | `pending/confirmed/confirmed_after_edit/cancelled/expired` |
| 4 | `BusinessObjectKind` 漏了 `fact` | Fact 保留为正式类型，普通抽取与高风险确认路径分离 |
