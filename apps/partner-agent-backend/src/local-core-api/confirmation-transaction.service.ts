import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  BusinessObjectAction,
  BusinessObjectKind,
  CommandResult,
  ConfirmationMode,
  ResourceRef,
  SubmitConfirmationBatchPayload,
  SubmitConfirmationBatchResult,
} from '@partner-agent/contracts';
import type { QueryRunner } from 'typeorm';
import { SessionStore } from '../database/session-store.js';
import { TypeOrmSessionStore } from '../database/typeorm-session.store.js';
import type { LocalCoreCommandRequest } from './local-core-api.types.js';

type JsonObject = Record<string, unknown>;

interface BatchRow {
  id: string;
  user_id: string;
  batch_status: string;
  risk_level: 'normal' | 'high';
  expires_at: Date | string;
  version: string;
}

interface CandidateRow {
  id: string;
  batch_id: string;
  kind: BusinessObjectKind;
  action: BusinessObjectAction;
  candidate_status: string;
  risk: 'normal' | 'high';
  payload: JsonObject;
  edited_payload: JsonObject | null;
  target_object_id: string | null;
  expected_version: string | null;
  source_refs: unknown;
  expires_at: Date | string;
}

interface BusinessRow {
  id: string;
  user_id: string;
  kind: BusinessObjectKind;
  version: string;
  lifecycle_status: string;
  created_by_batch_id: string;
  last_confirmation_batch_id: string;
  archived_at: Date | string | null;
  deleted_at: Date | string | null;
  purged_at: Date | string | null;
}

interface VersionRow {
  object_id: string;
  object_version: string;
  change_type: string;
  snapshot: { before: ObjectSnapshot | null; after: ObjectSnapshot };
}

interface ObjectSnapshot {
  object: BusinessRow;
  domain: JsonObject | null;
}

interface StoredCommandResult extends CommandResult<SubmitConfirmationBatchResult> {}

type ParsedPayload = Omit<SubmitConfirmationBatchPayload, 'mode'> & {
  mode: ConfirmationMode;
};

@Injectable()
export class ConfirmationTransactionService {
  constructor(private readonly sessionStore: SessionStore) {}

  async submit(request: LocalCoreCommandRequest): Promise<StoredCommandResult> {
    const envelope = request.envelope;
    const operationId = this.requiredUuid(
      envelope.operation_id,
      'operation_id',
    );
    const fingerprint = this.requiredString(
      envelope.request_fingerprint,
      'request_fingerprint',
    );
    const clientSource = this.requiredClientSource(envelope.client_source);
    const payload = this.parsePayload(envelope.payload);
    const dataSource = this.dataSource();
    const runner = dataSource.createQueryRunner();
    let committed = false;

    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(
        'select pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${request.userId}:${operationId}`],
      );
      const duplicate = await this.findDuplicate(
        runner,
        request.userId,
        operationId,
        fingerprint,
      );
      if (duplicate) {
        await runner.rollbackTransaction();
        return duplicate;
      }

      const candidateIds = payload.items.map((item) =>
        this.requiredUuid(item.candidate_id, 'candidate_id'),
      );
      if (new Set(candidateIds).size !== candidateIds.length) {
        throw this.error('VALIDATION_001', '候选项不能重复', 422);
      }

      // 仅用于定位 batch；真正的并发边界从下一条 FOR UPDATE 开始。
      const located = await runner.query(
        `select distinct batch_id from candidate_items
         where user_id = $1 and id = any($2::uuid[])`,
        [request.userId, candidateIds],
      );
      if (located.length !== 1) {
        throw this.error('CONFIRMATION_002', '候选不存在或不属于同一批次', 409);
      }
      const batchId = String(located[0].batch_id);

      const batches = (await runner.query(
        `select id, user_id, batch_status, risk_level, expires_at, version
         from confirmation_batches
         where user_id = $1 and id = $2
         for update`,
        [request.userId, batchId],
      )) as BatchRow[];
      const batch = batches[0];
      const concurrentDuplicate = await this.findDuplicate(
        runner,
        request.userId,
        operationId,
        fingerprint,
      );
      if (concurrentDuplicate) {
        await runner.rollbackTransaction();
        return concurrentDuplicate;
      }
      if (
        !batch ||
        !['pending', 'partially_processed'].includes(batch.batch_status)
      ) {
        throw this.error('CONFIRMATION_002', '确认批次当前不可处理', 409);
      }

      const candidates = (await runner.query(
        `select id, batch_id, kind, action, candidate_status, risk, payload,
                edited_payload, target_object_id, expected_version, source_refs, expires_at
         from candidate_items
         where user_id = $1 and batch_id = $2 and id = any($3::uuid[])
         order by id
         for update`,
        [request.userId, batchId, candidateIds],
      )) as CandidateRow[];
      this.validateCandidates(payload, batch, candidates);

      const [{ now: databaseNow }] = (await runner.query(
        'select transaction_timestamp() as now',
      )) as Array<{ now: Date | string }>;
      if (
        this.isExpired(batch.expires_at, databaseNow) ||
        candidates.some((candidate) =>
          this.isExpired(candidate.expires_at, databaseNow),
        )
      ) {
        await runner.query(
          `update candidate_items set candidate_status = 'expired', processed_at = $3,
             updated_at = $3, version = version + 1
           where user_id = $1 and batch_id = $2 and candidate_status = 'pending'`,
          [request.userId, batchId, databaseNow],
        );
        await runner.query(
          `update confirmation_batches set batch_status = 'expired',
             last_processed_at = $3, updated_at = $3, version = version + 1
           where user_id = $1 and id = $2`,
          [request.userId, batchId, databaseNow],
        );
        await runner.commitTransaction();
        committed = true;
        throw this.error('CONFIRMATION_002', '候选或确认批次已过期', 409);
      }

      const targetIds = candidates
        .map((candidate) => candidate.target_object_id)
        .filter((id): id is string => Boolean(id))
        .sort();
      const objects = targetIds.length
        ? ((await runner.query(
            `select id, user_id, kind, version, lifecycle_status,
                    created_by_batch_id, last_confirmation_batch_id,
                    archived_at, deleted_at, purged_at
             from business_objects
             where user_id = $1 and id = any($2::uuid[])
             order by id
             for update`,
            [request.userId, targetIds],
          )) as BusinessRow[])
        : [];
      this.validateObjectVersions(payload, candidates, objects);

      const actionId = randomUUID();
      const reversesActionId =
        payload.mode === 'confirm' &&
        candidates.every((c) => c.action === 'undo')
          ? this.undoActionId(candidates)
          : null;
      await runner.query(
        `insert into confirmation_actions
          (id, user_id, batch_id, operation_id, request_fingerprint, action_type,
           submitted_payload, client_source, reverses_action_id, created_at)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
        [
          actionId,
          request.userId,
          batchId,
          operationId,
          fingerprint,
          reversesActionId
            ? 'undo'
            : payload.mode === 'edit'
              ? 'confirm_after_edit'
              : payload.mode,
          JSON.stringify({ request: payload }),
          clientSource,
          reversesActionId,
          databaseNow,
        ],
      );

      const changed =
        payload.mode === 'cancel'
          ? []
          : reversesActionId
            ? await this.applyUndo(
                runner,
                request.userId,
                batchId,
                actionId,
                reversesActionId,
                candidates,
                objects,
                databaseNow,
              )
            : await this.applyCandidates(
                runner,
                request.userId,
                batchId,
                actionId,
                payload.mode,
                candidates,
                objects,
                databaseNow,
              );

      const candidateStatus =
        payload.mode === 'cancel'
          ? 'cancelled'
          : payload.mode === 'edit'
            ? 'confirmed_after_edit'
            : 'confirmed';
      await runner.query(
        `update candidate_items set candidate_status = $4, processed_at = $5,
           updated_at = $5, version = version + 1
         where user_id = $1 and batch_id = $2 and id = any($3::uuid[])`,
        [request.userId, batchId, candidateIds, candidateStatus, databaseNow],
      );
      await runner.query(
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
        [request.userId, batchId, databaseNow],
      );

      const result: StoredCommandResult = {
        operation_id: operationId,
        status: 'completed',
        resource_refs: [
          { kind: 'confirmation_batch', id: batchId },
          ...changed.map((item) => ({
            kind: this.resourceKind(item.kind),
            id: item.id,
          })),
        ],
        new_versions: Object.fromEntries(
          changed.map((item) => [item.id, item.version]),
        ),
        data: {
          batch_ref: { kind: 'confirmation_batch', id: batchId },
          confirmed: changed.map((item) => ({
            ref: { kind: this.resourceKind(item.kind), id: item.id },
            version: item.version,
          })),
        },
      };
      await runner.query(
        `update confirmation_actions set submitted_payload = $3::jsonb
         where user_id = $1 and id = $2`,
        [
          request.userId,
          actionId,
          JSON.stringify({ request: payload, result }),
        ],
      );
      await runner.commitTransaction();
      committed = true;
      return result;
    } catch (error) {
      if (!committed) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  private async applyCandidates(
    runner: QueryRunner,
    userId: string,
    batchId: string,
    actionId: string,
    mode: ConfirmationMode,
    candidates: CandidateRow[],
    objects: BusinessRow[],
    now: Date | string,
  ) {
    const objectMap = new Map(objects.map((object) => [object.id, object]));
    const changed: Array<{
      id: string;
      kind: BusinessObjectKind;
      version: string;
    }> = [];
    for (const candidate of candidates) {
      const effectivePayload =
        mode === 'edit' ? candidate.edited_payload : candidate.payload;
      if (!effectivePayload) {
        throw this.error('VALIDATION_002', '编辑确认缺少 edited_payload', 422);
      }
      const before = candidate.target_object_id
        ? await this.snapshot(
            runner,
            objectMap.get(candidate.target_object_id)!,
          )
        : null;
      const mergedPayload = before?.domain
        ? { ...before.domain, ...effectivePayload }
        : effectivePayload;
      const object = await this.applyOne(
        runner,
        userId,
        batchId,
        candidate,
        mergedPayload,
        objectMap,
        now,
      );
      const after = await this.snapshot(runner, object);
      await this.recordChange(
        runner,
        userId,
        actionId,
        candidate,
        object,
        {
          before: candidate.action === 'permanent_delete' ? null : before,
          after,
        },
        now,
      );
      changed.push({
        id: object.id,
        kind: object.kind,
        version: object.version,
      });
    }
    return changed;
  }

  private async applyOne(
    runner: QueryRunner,
    userId: string,
    batchId: string,
    candidate: CandidateRow,
    payload: JsonObject,
    objectMap: Map<string, BusinessRow>,
    now: Date | string,
  ): Promise<BusinessRow> {
    if (candidate.action === 'create') {
      const id = randomUUID();
      const [object] = (await runner.query(
        `insert into business_objects
          (id,user_id,kind,created_by_batch_id,last_confirmation_batch_id,created_at,updated_at)
         values ($1,$2,$3,$4,$4,$5,$5)
         returning id,user_id,kind,version,lifecycle_status,created_by_batch_id,
                   last_confirmation_batch_id,archived_at,deleted_at,purged_at`,
        [id, userId, candidate.kind, batchId, now],
      )) as BusinessRow[];
      await this.writeDomain(runner, object, payload, now, true);
      return object;
    }

    const target = objectMap.get(candidate.target_object_id!);
    if (!target) throw this.error('DEPS_002', '目标正式对象不存在', 409);
    if (
      target.kind !== candidate.kind ||
      target.lifecycle_status === 'purged'
    ) {
      throw this.error('CONFIRMATION_003', '目标对象类型或生命周期冲突', 409);
    }

    const lifecycle = this.nextLifecycle(
      candidate.action,
      target.lifecycle_status,
    );
    const [updated] = (await runner.query(
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
      await this.writeDomain(runner, updated, payload, now, false);
    } else if (candidate.action === 'permanent_delete') {
      const table =
        target.kind === 'goal'
          ? 'goals'
          : target.kind === 'action'
            ? 'actions'
            : 'formal_object_details';
      await runner.query(`delete from ${table} where user_id=$1 and id=$2`, [
        userId,
        target.id,
      ]);
      await runner.query(
        `update object_versions set snapshot='{"purged":true}'::jsonb
         where user_id=$1 and object_id=$2`,
        [userId, target.id],
      );
      await runner.query(
        `update source_relations set source_excerpt=null
         where user_id=$1 and object_id=$2`,
        [userId, target.id],
      );
      await runner.query(
        `update candidate_items set payload='{"purged":true}'::jsonb, edited_payload=null
         where user_id=$1 and id=$2`,
        [userId, candidate.id],
      );
    }
    return updated;
  }

  private async writeDomain(
    runner: QueryRunner,
    object: BusinessRow,
    payload: JsonObject,
    now: Date | string,
    create: boolean,
  ): Promise<void> {
    if (object.kind === 'goal') {
      const title = this.requiredString(payload.title, 'payload.title');
      const status = String(payload.goal_status ?? 'planning');
      if (create) {
        await runner.query(
          `insert into goals (id,user_id,title,description,goal_status,deadline_at,deadline_observation,confirmed_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            object.id,
            object.user_id,
            title,
            payload.description ?? null,
            status,
            payload.deadline_at ?? null,
            payload.deadline_observation ?? 'not_due',
            now,
          ],
        );
      } else {
        await runner.query(
          `update goals set title=$3,description=$4,goal_status=$5,deadline_at=$6,
             deadline_observation=$7 where user_id=$1 and id=$2`,
          [
            object.user_id,
            object.id,
            title,
            payload.description ?? null,
            status,
            payload.deadline_at ?? null,
            payload.deadline_observation ?? 'not_due',
          ],
        );
      }
      return;
    }
    if (object.kind === 'action') {
      const title = this.requiredString(payload.title, 'payload.title');
      const values = [
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
      ];
      await runner.query(
        create
          ? `insert into actions (user_id,id,title,description,execution_status,plan_status,
               timeliness_status,deadline_at,planned_at,started_at,completed_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`
          : `update actions set title=$3,description=$4,execution_status=$5,plan_status=$6,
               timeliness_status=$7,deadline_at=$8,planned_at=$9,started_at=$10,completed_at=$11
             where user_id=$1 and id=$2`,
        values,
      );
      return;
    }
    await runner.query(
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

  private async applyUndo(
    runner: QueryRunner,
    userId: string,
    batchId: string,
    actionId: string,
    originalActionId: string,
    candidates: CandidateRow[],
    objects: BusinessRow[],
    now: Date | string,
  ) {
    const originals = await runner.query(
      `select id,batch_id,action_type from confirmation_actions
       where user_id=$1 and id=$2`,
      [userId, originalActionId],
    );
    if (!originals[0]) {
      throw this.error('CONFIRMATION_003', '原确认操作不存在', 409);
    }
    const versions = (await runner.query(
      `select object_id,object_version,change_type,snapshot from object_versions
       where user_id=$1 and confirmation_action_id=$2 order by object_id`,
      [userId, originalActionId],
    )) as VersionRow[];
    const selected = candidates.map((c) => c.target_object_id).sort();
    const original = versions.map((v) => v.object_id).sort();
    if (JSON.stringify(selected) !== JSON.stringify(original)) {
      throw this.error('CONFIRMATION_003', '撤销必须覆盖原操作的全部对象', 409);
    }
    if (
      versions.some((version) => version.change_type === 'permanent_delete')
    ) {
      throw this.error('CONFIRMATION_003', '彻底删除不可撤销', 409);
    }
    const objectMap = new Map(objects.map((object) => [object.id, object]));
    const changed: Array<{
      id: string;
      kind: BusinessObjectKind;
      version: string;
    }> = [];
    for (const version of versions) {
      const current = objectMap.get(version.object_id)!;
      if (String(current.version) !== String(version.object_version)) {
        throw this.error('VERSION_001', '对象已有后续版本，不能撤销', 409, {
          object_id: current.id,
          expected_version: version.object_version,
          current_version: current.version,
        });
      }
      const beforeUndo = await this.snapshot(runner, current);
      const restored = version.snapshot.before;
      const lifecycle = restored?.object.lifecycle_status ?? 'soft_deleted';
      const [updated] = (await runner.query(
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
      if (restored?.domain) {
        await this.restoreDomain(runner, updated, restored.domain);
      }
      const after = await this.snapshot(runner, updated);
      const candidate = candidates.find(
        (item) => item.target_object_id === current.id,
      )!;
      await this.recordChange(
        runner,
        userId,
        actionId,
        candidate,
        updated,
        { before: beforeUndo, after },
        now,
      );
      changed.push({
        id: updated.id,
        kind: updated.kind,
        version: updated.version,
      });
    }
    return changed;
  }

  private async restoreDomain(
    runner: QueryRunner,
    object: BusinessRow,
    domain: JsonObject,
  ): Promise<void> {
    const table =
      object.kind === 'goal'
        ? 'goals'
        : object.kind === 'action'
          ? 'actions'
          : 'formal_object_details';
    await runner.query(
      `update ${table} set ${
        table === 'formal_object_details'
          ? 'content=$3::jsonb'
          : table === 'goals'
            ? 'title=$3'
            : 'title=$3'
      } where user_id=$1 and id=$2`,
      [
        object.user_id,
        object.id,
        table === 'formal_object_details'
          ? JSON.stringify(domain.content ?? domain)
          : domain.title,
      ],
    );
  }

  private async snapshot(
    runner: QueryRunner,
    object: BusinessRow,
  ): Promise<ObjectSnapshot> {
    const table =
      object.kind === 'goal'
        ? 'goals'
        : object.kind === 'action'
          ? 'actions'
          : 'formal_object_details';
    const rows = (await runner.query(
      `select to_jsonb(d) as value from ${table} d where user_id=$1 and id=$2`,
      [object.user_id, object.id],
    )) as Array<{ value: JsonObject }>;
    return { object, domain: rows[0]?.value ?? null };
  }

  private async recordChange(
    runner: QueryRunner,
    userId: string,
    actionId: string,
    candidate: CandidateRow,
    object: BusinessRow,
    snapshot: VersionRow['snapshot'],
    now: Date | string,
  ): Promise<void> {
    await runner.query(
      `insert into object_versions
        (user_id,object_id,object_version,snapshot,change_type,confirmation_action_id,created_at)
       values ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
      [
        userId,
        object.id,
        object.version,
        JSON.stringify(snapshot),
        candidate.action,
        actionId,
        now,
      ],
    );
    const refs =
      candidate.action !== 'permanent_delete' &&
      Array.isArray(candidate.source_refs)
        ? candidate.source_refs
        : [];
    for (const ref of refs) {
      if (!ref || typeof ref !== 'object') continue;
      const source = ref as JsonObject;
      if (!source.kind || !source.id) continue;
      await runner.query(
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
    await runner.query(
      `insert into object_index_jobs
        (user_id,object_id,object_version,status,created_at,updated_at)
       values ($1,$2,$3,'pending',$4,$4)`,
      [userId, object.id, object.version, now],
    );
  }

  private validateCandidates(
    payload: ParsedPayload,
    batch: BatchRow,
    candidates: CandidateRow[],
  ): void {
    if (
      candidates.length !== payload.items.length ||
      candidates.some((c) => c.candidate_status !== 'pending')
    ) {
      throw this.error('CONFIRMATION_002', '候选不存在或当前不可确认', 409);
    }
    const byId = new Map(
      candidates.map((candidate) => [candidate.id, candidate]),
    );
    for (const item of payload.items) {
      const candidate = byId.get(item.candidate_id);
      if (
        !candidate ||
        candidate.kind !== item.kind ||
        candidate.action !== item.action ||
        (item.risk !== undefined && candidate.risk !== item.risk) ||
        (item.expected_version !== undefined &&
          String(candidate.expected_version) !== item.expected_version)
      ) {
        throw this.error(
          'CONFIRMATION_003',
          '候选内容或版本与服务端不一致',
          409,
        );
      }
      if (candidate.risk === 'high' && item.risk !== 'high') {
        throw this.error('CONFIRMATION_001', '高风险候选需要显式风险确认', 409);
      }
      if (
        candidate.action === 'permanent_delete' &&
        (candidate.risk !== 'high' || batch.risk_level !== 'high')
      ) {
        throw this.error(
          'CONFIRMATION_001',
          '彻底删除必须使用高风险单候选批次',
          409,
        );
      }
    }
    if (
      (batch.risk_level === 'high' ||
        candidates.some((c) => c.risk === 'high')) &&
      candidates.length !== 1
    ) {
      throw this.error('CONFIRMATION_001', '高风险候选必须单独确认', 409);
    }
    const allUndo = candidates.every(
      (candidate) => candidate.action === 'undo',
    );
    if (
      candidates.some((candidate) => candidate.action === 'undo') &&
      !allUndo
    ) {
      throw this.error('CONFIRMATION_003', '撤销不能与其他动作混合提交', 409);
    }
    const targets = candidates
      .map((candidate) => candidate.target_object_id)
      .filter((id): id is string => Boolean(id));
    if (new Set(targets).size !== targets.length) {
      throw this.error('CONFIRMATION_003', '同一提交不能多次修改同一对象', 409);
    }
  }

  private validateObjectVersions(
    payload: ParsedPayload,
    candidates: CandidateRow[],
    objects: BusinessRow[],
  ): void {
    const objectMap = new Map(objects.map((object) => [object.id, object]));
    for (const candidate of candidates) {
      if (candidate.action === 'create') continue;
      const object = objectMap.get(candidate.target_object_id!);
      if (!object) throw this.error('DEPS_002', '目标正式对象不存在', 409);
      const item = payload.items.find(
        (entry) => entry.candidate_id === candidate.id,
      )!;
      const expected = item.expected_version ?? candidate.expected_version;
      if (!expected || String(object.version) !== String(expected)) {
        throw this.error('VERSION_001', '正式对象版本冲突', 409, {
          object_id: object.id,
          expected_version: expected,
          current_version: object.version,
        });
      }
    }
  }

  private nextLifecycle(action: BusinessObjectAction, current: string): string {
    if (action === 'archive') return 'archived';
    if (action === 'soft_delete') return 'soft_deleted';
    if (action === 'permanent_delete') return 'purged';
    if (action === 'restore') {
      if (!['archived', 'soft_deleted'].includes(current)) {
        throw this.error('CONFIRMATION_003', '当前生命周期不能恢复', 409);
      }
      return 'active';
    }
    return current;
  }

  private undoActionId(candidates: CandidateRow[]): string {
    const ids = new Set(
      candidates.map((candidate) =>
        String(candidate.payload.original_confirmation_action_id ?? ''),
      ),
    );
    if (ids.size !== 1 || ![...ids][0]) {
      throw this.error('VALIDATION_002', '撤销候选缺少统一的原确认操作', 422);
    }
    return this.requiredUuid([...ids][0], 'original_confirmation_action_id');
  }

  private async findDuplicate(
    runner: QueryRunner,
    userId: string,
    operationId: string,
    fingerprint: string,
  ): Promise<StoredCommandResult | undefined> {
    const rows = await runner.query(
      `select request_fingerprint,submitted_payload from confirmation_actions
       where user_id=$1 and operation_id=$2`,
      [userId, operationId],
    );
    if (!rows[0]) return undefined;
    if (rows[0].request_fingerprint !== fingerprint) {
      throw this.error('IDEMPOTENCY_001', 'operation_id 已被不同请求使用', 409);
    }
    const stored = rows[0].submitted_payload as {
      result?: StoredCommandResult;
    };
    if (!stored?.result) {
      throw this.error('INTERNAL_000', '历史确认结果不完整', 500);
    }
    return { ...stored.result, status: 'duplicate' };
  }

  private parsePayload(value: unknown): ParsedPayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw this.error('VALIDATION_001', '确认载荷必须是对象', 422);
    }
    const payload = value as Partial<SubmitConfirmationBatchPayload>;
    const mode = payload.mode ?? 'confirm';
    if (
      !['confirm', 'cancel', 'edit'].includes(mode) ||
      !Array.isArray(payload.items) ||
      payload.items.length === 0
    ) {
      throw this.error('VALIDATION_001', '确认模式或候选项无效', 422);
    }
    return { mode, items: payload.items } as ParsedPayload;
  }

  private resourceKind(kind: BusinessObjectKind): ResourceRef['kind'] {
    return kind === 'reminder' ? 'reminder_plan' : kind;
  }

  private dataSource() {
    if (!(this.sessionStore instanceof TypeOrmSessionStore)) {
      throw this.error('INTERNAL_000', '正式确认需要 PostgreSQL 存储', 503);
    }
    return this.sessionStore.getDataSource();
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw this.error('VALIDATION_002', `缺少 ${field}`, 422, { field });
    }
    return value;
  }

  private requiredUuid(value: unknown, field: string): string {
    const result = this.requiredString(value, field);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        result,
      )
    ) {
      throw this.error('VALIDATION_001', `${field} 必须是 UUID`, 422, {
        field,
      });
    }
    return result;
  }

  private requiredClientSource(value: unknown): string {
    if (!['ios', 'android', 'web', 'other'].includes(String(value))) {
      throw this.error('VALIDATION_001', 'client_source 无效', 422);
    }
    return String(value);
  }

  private isExpired(expiresAt: Date | string, now: Date | string): boolean {
    return new Date(expiresAt).getTime() <= new Date(now).getTime();
  }

  private error(
    code: string,
    message: string,
    status: number,
    details?: JsonObject,
  ): HttpException {
    return new HttpException(
      { code, message, ...(details ? { details } : {}) },
      status as HttpStatus,
    );
  }
}
