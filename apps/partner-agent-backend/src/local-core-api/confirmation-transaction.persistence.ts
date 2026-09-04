import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { confirmationError, requiredString } from './confirmation-transaction.errors.js';
import type {
  BatchRow,
  BusinessRow,
  CandidateRow,
  JsonObject,
  ObjectSnapshot,
  ParsedPayload,
  StoredCommandResult,
  VersionRow,
} from './confirmation-transaction.types.js';

export class ConfirmationTransactionPersistence {
  constructor(private readonly runner: QueryRunner) {}

  async acquireOperationLock(userId: string, operationId: string): Promise<void> {
    await this.runner.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${userId}:${operationId}`]);
  }

  async findDuplicate(
    userId: string,
    operationId: string,
    fingerprint: string,
  ): Promise<StoredCommandResult | undefined> {
    const rows = await this.runner.query(
      `select request_fingerprint,submitted_payload from confirmation_actions
       where user_id=$1 and operation_id=$2`,
      [userId, operationId],
    );
    if (!rows[0]) return undefined;
    if (rows[0].request_fingerprint !== fingerprint) {
      throw confirmationError('IDEMPOTENCY_001', 'operation_id 已被不同请求使用', 409);
    }
    const stored = rows[0].submitted_payload as {
      result?: StoredCommandResult;
    };
    if (!stored?.result) {
      throw confirmationError('INTERNAL_000', '历史确认结果不完整', 500);
    }
    return { ...stored.result, status: 'duplicate' };
  }

  async lockBatch(userId: string, batchId: string): Promise<BatchRow | undefined> {
    const rows = (await this.runner.query(
      `select id, user_id, batch_status, risk_level, expires_at, version
       from confirmation_batches
       where user_id = $1 and id = $2
       for update`,
      [userId, batchId],
    )) as BatchRow[];
    return rows[0];
  }

  async lockCandidates(userId: string, batchId: string, candidateIds: string[]): Promise<CandidateRow[]> {
    return (await this.runner.query(
      `select id, batch_id, kind, action, candidate_status, risk, payload,
              edited_payload, target_object_id, expected_version, source_refs, expires_at,
              version, editable_fields
       from candidate_items
       where user_id = $1 and batch_id = $2 and id = any($3::uuid[])
       order by id
       for update`,
      [userId, batchId, candidateIds],
    )) as CandidateRow[];
  }

  async transactionTime(): Promise<Date | string> {
    const [{ now }] = (await this.runner.query('select transaction_timestamp() as now')) as Array<{
      now: Date | string;
    }>;
    return now;
  }

  async expireBatch(userId: string, batchId: string, now: Date | string): Promise<void> {
    await this.runner.query(
      `update candidate_items set candidate_status = 'expired', processed_at = $3,
         updated_at = $3, version = version + 1
       where user_id = $1 and batch_id = $2 and candidate_status = 'pending'`,
      [userId, batchId, now],
    );
    await this.runner.query(
      `update confirmation_batches set batch_status = 'expired',
         last_processed_at = $3, updated_at = $3, version = version + 1
       where user_id = $1 and id = $2`,
      [userId, batchId, now],
    );
  }

  async lockObjects(userId: string, targetIds: string[]): Promise<BusinessRow[]> {
    if (targetIds.length === 0) return [];
    return (await this.runner.query(
      `select id, user_id, kind, version, lifecycle_status,
              created_by_batch_id, last_confirmation_batch_id,
              archived_at, deleted_at, purged_at
       from business_objects
       where user_id = $1 and id = any($2::uuid[])
       order by id
       for update`,
      [userId, targetIds],
    )) as BusinessRow[];
  }

  async insertAction(input: {
    actionId: string;
    userId: string;
    batchId: string;
    operationId: string;
    fingerprint: string;
    actionType: string;
    payload: ParsedPayload;
    clientSource: string;
    reversesActionId: string | null;
    now: Date | string;
  }): Promise<void> {
    await this.runner.query(
      `insert into confirmation_actions
        (id, user_id, batch_id, operation_id, request_fingerprint, action_type,
         submitted_payload, client_source, reverses_action_id, created_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
      [
        input.actionId,
        input.userId,
        input.batchId,
        input.operationId,
        input.fingerprint,
        input.actionType,
        JSON.stringify({ request: input.payload }),
        input.clientSource,
        input.reversesActionId,
        input.now,
      ],
    );
  }

  async completeCandidates(userId: string, batchId: string, payload: ParsedPayload, now: Date | string): Promise<void> {
    for (const item of payload.items) {
      const status =
        item.decision === 'cancel'
          ? 'cancelled'
          : item.decision === 'modify_confirm'
            ? 'confirmed_after_edit'
            : 'confirmed';
      await this.runner.query(
        `update candidate_items set candidate_status = $4, processed_at = $5,
           edited_payload = case when $4='confirmed_after_edit' then $6::jsonb else null end,
           updated_at = $5, version = version + 1
         where user_id = $1 and batch_id = $2 and id = $3`,
        [
          userId,
          batchId,
          item.candidate_id,
          status,
          now,
          item.modified_payload ? JSON.stringify(item.modified_payload) : null,
        ],
      );
    }
  }

  async completeBatch(userId: string, batchId: string, now: Date | string): Promise<void> {
    await this.runner.query(
      `update confirmation_batches b set
         batch_status = case
           when exists (select 1 from candidate_items c where c.user_id=b.user_id and c.batch_id=b.id and c.candidate_status='pending')
             then 'partially_processed'
           when exists (select 1 from candidate_items c where c.user_id=b.user_id and c.batch_id=b.id and c.candidate_status in ('confirmed','confirmed_after_edit'))
             then 'confirmed'
           else 'cancelled'
         end,
         last_processed_at = $3, updated_at = $3, version = version + 1
       where b.user_id = $1 and b.id = $2`,
      [userId, batchId, now],
    );
  }

  async storeResult(
    userId: string,
    actionId: string,
    payload: ParsedPayload,
    result: StoredCommandResult,
  ): Promise<void> {
    await this.runner.query(
      `update confirmation_actions set submitted_payload = $3::jsonb
       where user_id = $1 and id = $2`,
      [userId, actionId, JSON.stringify({ request: payload, result })],
    );
  }

  async createObject(
    userId: string,
    batchId: string,
    candidate: CandidateRow,
    payload: JsonObject,
    now: Date | string,
  ): Promise<BusinessRow> {
    const id = randomUUID();
    const [object] = (await this.runner.query(
      `insert into business_objects
        (id,user_id,kind,created_by_batch_id,last_confirmation_batch_id,created_at,updated_at)
       values ($1,$2,$3,$4,$4,$5,$5)
       returning id,user_id,kind,version,lifecycle_status,created_by_batch_id,
                 last_confirmation_batch_id,archived_at,deleted_at,purged_at`,
      [id, userId, candidate.kind, batchId, now],
    )) as BusinessRow[];
    await this.writeDomain(object, payload, now, true);
    return object;
  }

  async updateObject(
    userId: string,
    batchId: string,
    candidate: CandidateRow,
    target: BusinessRow,
    payload: JsonObject,
    lifecycle: string,
    now: Date | string,
  ): Promise<BusinessRow> {
    const [updated] = (await this.runner.query(
      `update business_objects set version=version+1, lifecycle_status=$4,
         last_confirmation_batch_id=$3, updated_at=$5,
         archived_at=case when $4='archived' then $5 else null end,
         deleted_at=case when $4 in ('soft_deleted','purged') then coalesce(deleted_at,$5) else null end,
         purged_at=case when $4='purged' then $5 else null end
       where user_id=$1 and id=$2
       returning id,user_id,kind,version,lifecycle_status,created_by_batch_id,
                 last_confirmation_batch_id,archived_at,deleted_at,purged_at`,
      [userId, target.id, batchId, lifecycle, now],
    )) as BusinessRow[];
    if (candidate.action === 'update' || candidate.action === 'status_change') {
      await this.writeDomain(updated, payload, now, false);
    } else if (candidate.action === 'permanent_delete') {
      await this.purgeDomain(userId, target, candidate.id);
    }
    return updated;
  }

  private async writeDomain(
    object: BusinessRow,
    payload: JsonObject,
    now: Date | string,
    create: boolean,
  ): Promise<void> {
    if (object.kind === 'goal') {
      const title = requiredString(payload.title, 'payload.title');
      const status = String(payload.goal_status ?? 'planning');
      await this.runner.query(
        create
          ? `insert into goals (id,user_id,title,description,goal_status,deadline_at,deadline_observation,confirmed_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8)`
          : `update goals set title=$3,description=$4,goal_status=$5,deadline_at=$6,
               deadline_observation=$7 where user_id=$1 and id=$2`,
        create
          ? [
              object.id,
              object.user_id,
              title,
              payload.description ?? null,
              status,
              payload.deadline_at ?? null,
              payload.deadline_observation ?? 'not_due',
              now,
            ]
          : [
              object.user_id,
              object.id,
              title,
              payload.description ?? null,
              status,
              payload.deadline_at ?? null,
              payload.deadline_observation ?? 'not_due',
            ],
      );
      return;
    }
    if (object.kind === 'action') {
      const title = requiredString(payload.title, 'payload.title');
      await this.runner.query(
        create
          ? `insert into actions (user_id,id,title,description,execution_status,plan_status,
               timeliness_status,deadline_at,planned_at,started_at,completed_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`
          : `update actions set title=$3,description=$4,execution_status=$5,plan_status=$6,
               timeliness_status=$7,deadline_at=$8,planned_at=$9,started_at=$10,completed_at=$11
             where user_id=$1 and id=$2`,
        [
          object.user_id,
          object.id,
          title,
          payload.description ?? null,
          payload.execution_status ?? 'todo',
          payload.plan_status ?? 'normal',
          payload.timeliness_status ?? 'no_deadline',
          payload.deadline_at ?? null,
          payload.planned_at ?? null,
          payload.started_at ?? null,
          payload.completed_at ?? null,
        ],
      );
      return;
    }
    await this.runner.query(
      create
        ? `insert into formal_object_details
             (user_id,id,content,domain_status,confidence,is_sensitive,confirmed_at)
           values ($1,$2,$3::jsonb,$4,$5,$6,$7)`
        : `update formal_object_details set content=$3::jsonb,domain_status=$4,
             confidence=$5,is_sensitive=$6,confirmed_at=$7 where user_id=$1 and id=$2`,
      [
        object.user_id,
        object.id,
        JSON.stringify(payload),
        payload.domain_status ?? 'active',
        payload.confidence ?? null,
        Boolean(payload.is_sensitive),
        now,
      ],
    );
  }

  private async purgeDomain(userId: string, target: BusinessRow, candidateId: string): Promise<void> {
    const table = domainTable(target.kind);
    await this.runner.query(`delete from ${table} where user_id=$1 and id=$2`, [userId, target.id]);
    await this.runner.query(
      `update object_versions set snapshot='{"purged":true}'::jsonb
       where user_id=$1 and object_id=$2`,
      [userId, target.id],
    );
    await this.runner.query(
      `update source_relations set source_excerpt=null
       where user_id=$1 and object_id=$2`,
      [userId, target.id],
    );
    await this.runner.query(
      `update candidate_items set payload='{"purged":true}'::jsonb, edited_payload=null
       where user_id=$1 and id=$2`,
      [userId, candidateId],
    );
  }

  async loadUndoVersions(userId: string, originalActionId: string): Promise<VersionRow[]> {
    const originals = await this.runner.query(
      `select id,batch_id,action_type from confirmation_actions
       where user_id=$1 and id=$2`,
      [userId, originalActionId],
    );
    if (!originals[0]) {
      throw confirmationError('CONFIRMATION_003', '原确认操作不存在', 409);
    }
    return (await this.runner.query(
      `select object_id,object_version,change_type,snapshot from object_versions
       where user_id=$1 and confirmation_action_id=$2 order by object_id`,
      [userId, originalActionId],
    )) as VersionRow[];
  }

  async restoreObject(
    userId: string,
    batchId: string,
    current: BusinessRow,
    restored: ObjectSnapshot | null,
    now: Date | string,
  ): Promise<BusinessRow> {
    const lifecycle = restored?.object.lifecycle_status ?? 'soft_deleted';
    const [updated] = (await this.runner.query(
      `update business_objects set version=version+1,lifecycle_status=$4,
         last_confirmation_batch_id=$3,updated_at=$5,
         archived_at=$6,deleted_at=$7,purged_at=$8
       where user_id=$1 and id=$2
       returning id,user_id,kind,version,lifecycle_status,created_by_batch_id,
                 last_confirmation_batch_id,archived_at,deleted_at,purged_at`,
      [
        userId,
        current.id,
        batchId,
        lifecycle,
        now,
        restored?.object.archived_at ?? null,
        restored?.object.deleted_at ?? (restored ? null : now),
        restored?.object.purged_at ?? null,
      ],
    )) as BusinessRow[];
    if (restored?.domain) await this.restoreDomain(updated, restored.domain);
    return updated;
  }

  private async restoreDomain(object: BusinessRow, domain: JsonObject): Promise<void> {
    const table = domainTable(object.kind);
    await this.runner.query(
      `update ${table} set ${
        table === 'formal_object_details' ? 'content=$3::jsonb' : 'title=$3'
      } where user_id=$1 and id=$2`,
      [
        object.user_id,
        object.id,
        table === 'formal_object_details' ? JSON.stringify(domain.content ?? domain) : domain.title,
      ],
    );
  }

  async snapshot(object: BusinessRow): Promise<ObjectSnapshot> {
    const table = domainTable(object.kind);
    const rows = (await this.runner.query(`select to_jsonb(d) as value from ${table} d where user_id=$1 and id=$2`, [
      object.user_id,
      object.id,
    ])) as Array<{ value: JsonObject }>;
    return { object, domain: rows[0]?.value ?? null };
  }

  async recordChange(
    userId: string,
    actionId: string,
    candidate: CandidateRow,
    object: BusinessRow,
    snapshot: VersionRow['snapshot'],
    now: Date | string,
  ): Promise<void> {
    await this.runner.query(
      `insert into object_versions
        (user_id,object_id,object_version,snapshot,change_type,confirmation_action_id,created_at)
       values ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
      [userId, object.id, object.version, JSON.stringify(snapshot), candidate.action, actionId, now],
    );
    const refs =
      candidate.action !== 'permanent_delete' && Array.isArray(candidate.source_refs) ? candidate.source_refs : [];
    for (const ref of refs) {
      if (!ref || typeof ref !== 'object') continue;
      const source = ref as JsonObject;
      if (!source.kind || !source.id) continue;
      await this.runner.query(
        `insert into source_relations
          (user_id,object_id,source_kind,source_id,relation_type,source_excerpt)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          userId,
          object.id,
          String(source.kind),
          String(source.id),
          String(source.relation_type ?? 'derived_from'),
          source.excerpt ?? null,
        ],
      );
    }
    await this.runner.query(
      `insert into object_index_jobs
        (user_id,object_id,object_version,status,created_at,updated_at)
       values ($1,$2,$3,'pending',$4,$4)`,
      [userId, object.id, object.version, now],
    );
  }
}

function domainTable(kind: BusinessRow['kind']): string {
  return kind === 'goal' ? 'goals' : kind === 'action' ? 'actions' : 'formal_object_details';
}
