import type { QueryRunner } from 'typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { ChatSessionEntity } from './entities/chat-session.entity.js';
import { SessionMessageEntity } from './entities/session-message.entity.js';
import {
  ActionEntity,
  BusinessObjectEntity,
  CandidateItemEntity,
  ConfirmationActionEntity,
  ConfirmationBatchEntity,
  FormalObjectDetailEntity,
  GoalActionRelationEntity,
  GoalEntity,
  ObjectIndexJobEntity,
  ObjectVersionEntity,
  SourceRelationEntity,
  UserEntity,
} from './core-entities.js';
import {
  CONFIRMATION_TRANSACTION_LOCK_ORDER,
  CreateLocalCoreSchema1788500000000,
} from './migrations/1788500000000-create-local-core-schema.js';

const normalize = (sql: string) =>
  sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('CreateLocalCoreSchema1788500000000', () => {
  it('extends legacy session tables and creates the P0 business schema', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: async (sql: string) => {
        statements.push(normalize(sql));
      },
    } as unknown as QueryRunner;

    await new CreateLocalCoreSchema1788500000000().up(queryRunner);
    const sql = statements.join('\n');

    expect(sql).not.toMatch(/create table chat_sessions/);
    expect(sql).not.toMatch(/create table session_messages/);
    expect(sql).toContain('alter table chat_sessions');
    expect(sql).toContain('alter table session_messages');
    expect(sql).toContain(
      'foreign key (owner_id, session_id) references chat_sessions(owner_id, id)',
    );

    for (const table of [
      'users',
      'confirmation_batches',
      'candidate_items',
      'confirmation_actions',
      'business_objects',
      'goals',
      'actions',
      'formal_object_details',
      'goal_action_relations',
      'object_versions',
      'source_relations',
      'object_index_jobs',
    ]) {
      expect(sql).toContain(`create table ${table}`);
    }

    expect(sql).toContain(
      "'pending','confirmed','confirmed_after_edit','cancelled','expired'",
    );
    expect(sql).toContain(
      "'planning','active','paused','completed','abandoned','expired'",
    );
    expect(sql).toContain("'todo','in_progress','paused','done','cancelled'");
    expect(sql).toContain("'normal','rescheduled'");
    expect(sql).toContain("'no_deadline','not_due','overdue','not_applicable'");
    expect(sql).toContain(
      "'goal','action','fact','memory','decision','situation','reminder'",
    );
    expect(sql).toContain(
      "'create','update','status_change','archive','soft_delete','permanent_delete','restore','undo'",
    );
    expect(sql).toContain("where candidate_status = 'pending'");
    expect(sql).toContain("where lifecycle_status = 'active'");
    expect(sql).toContain(
      'create trigger confirmation_batches_fixed_expiry_trigger',
    );
    expect(sql).toContain(
      'create trigger candidate_items_fixed_expiry_trigger',
    );
    expect(sql).toContain(
      "new.expires_at := transaction_timestamp() + interval '24 hours'",
    );
    expect(sql).toContain("raise exception 'confirmation expiry is immutable'");
    expect(sql).toContain(
      'create constraint trigger candidate_items_high_risk_batch_trigger',
    );
    expect(sql).toContain(
      'after insert or update of batch_id, user_id, risk on candidate_items',
    );
    expect(sql).toContain(
      'candidate risk must match confirmation batch risk level',
    );
    expect(sql).toContain(
      'where b.id = new.batch_id and b.user_id = new.user_id for update',
    );
    expect(sql).toContain(
      'create constraint trigger confirmation_batches_risk_trigger',
    );
    expect(sql).toContain(
      'constraint tool_confirmation_requests_owner_session_fk foreign key (owner_id, session_id) references chat_sessions(owner_id, id)',
    );
    expect(sql).toContain(
      'constraint tool_receipts_owner_confirmation_fk foreign key (owner_id, confirmation_id) references tool_confirmation_requests(owner_id, id)',
    );
    expect(sql).toContain(
      'constraint tool_audits_owner_session_fk foreign key (owner_id, session_id) references chat_sessions(owner_id, id)',
    );
    expect(sql).toContain(
      'on object_index_jobs (status, created_at, id) where status in',
    );
  });

  it('publishes entities for every migration-owned core table', () => {
    const entities = [
      UserEntity,
      ConfirmationBatchEntity,
      CandidateItemEntity,
      ConfirmationActionEntity,
      BusinessObjectEntity,
      GoalEntity,
      ActionEntity,
      FormalObjectDetailEntity,
      GoalActionRelationEntity,
      ObjectVersionEntity,
      SourceRelationEntity,
      ObjectIndexJobEntity,
    ];
    const names = getMetadataArgsStorage()
      .tables.filter((table) =>
        entities.includes(table.target as (typeof entities)[number]),
      )
      .map((table) => table.name)
      .sort();

    expect(names).toEqual([
      'actions',
      'business_objects',
      'candidate_items',
      'confirmation_actions',
      'confirmation_batches',
      'formal_object_details',
      'goal_action_relations',
      'goals',
      'object_index_jobs',
      'object_versions',
      'source_relations',
      'users',
    ]);
  });

  it('removes the added compatibility constraints during rollback', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: async (sql: string) => {
        statements.push(normalize(sql));
      },
    } as unknown as QueryRunner;

    await new CreateLocalCoreSchema1788500000000().down(queryRunner);
    const sql = statements.join('\n');

    expect(sql).toContain(
      'drop constraint if exists tool_audits_owner_session_fk',
    );
    expect(sql).toContain(
      'drop constraint if exists tool_receipts_owner_confirmation_fk',
    );
    expect(sql).toContain(
      'drop constraint if exists tool_confirmation_requests_owner_session_fk',
    );
    expect(sql).toContain(
      'drop function if exists enforce_confirmation_expiry',
    );
    expect(sql).toContain(
      'foreign key (confirmation_id) references tool_confirmation_requests(id)',
    );
  });

  it('fixes the transaction lock order used by confirmation services', () => {
    expect(CONFIRMATION_TRANSACTION_LOCK_ORDER).toEqual([
      'confirmation_batches',
      'candidate_items:id',
      'business_objects:id',
    ]);
  });

  it('keeps session entities aligned with the migration-owned columns', () => {
    const columns = getMetadataArgsStorage().columns;
    const propertyNames = (target: object) =>
      columns
        .filter((column) => column.target === target)
        .map((column) => column.propertyName)
        .sort();

    expect(propertyNames(UserEntity)).toEqual([
      'createdAt',
      'displayName',
      'id',
      'timezone',
      'updatedAt',
    ]);

    const chatSessionProperties = propertyNames(ChatSessionEntity);
    expect(chatSessionProperties).toEqual(
      expect.arrayContaining(['version', 'lifecycleStatus', 'updatedAt']),
    );

    const sessionMessageProperties = propertyNames(SessionMessageEntity);
    expect(sessionMessageProperties).toEqual(
      expect.arrayContaining([
        'ownerId',
        'inputId',
        'operationId',
        'taskId',
        'originalRecordId',
        'analysisResultId',
        'completedAt',
      ]),
    );
  });
});
