import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { ResourceRef } from '@partner-agent/contracts';
import type { DataSource } from 'typeorm';
import { SessionStore } from '../database/session-store.js';
import { TypeOrmSessionStore } from '../database/typeorm-session.store.js';
import type { LocalCoreRequest } from './local-core-api.types.js';

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ActionQueryService {
  constructor(private readonly sessions: SessionStore) {}

  async execute(name: string, request: LocalCoreRequest): Promise<unknown> {
    const db = this.database();
    if (name === 'GetAnalysisRun') return this.analysisRun(db, request);
    if (name === 'ListPendingConfirmationBatches') return this.pendingBatches(db, request);
    if (name === 'GetConfirmationBatch') return this.confirmationBatch(db, request);
    if (name === 'GetCandidateDetail') return this.candidateDetail(db, request);
    if (name === 'GetConfirmationHistory') return this.confirmationHistory(db, request);
    if (name === 'ListActions') return this.actions(db, request);
    if (name === 'GetAction') return this.action(db, request);
    if (name === 'GetChangeHistory') return this.changeHistory(db, request);
    if (name === 'GetUndoEligibility') return this.undoEligibility(db, request);
    return undefined;
  }

  private database(): DataSource {
    if (!(this.sessions instanceof TypeOrmSessionStore)) {
      throw new HttpException(
        { code: 'DEPS_001', message: '正式行动查询需要 PostgreSQL' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.sessions.getDataSource();
  }

  private async analysisRun(db: DataSource, request: LocalCoreRequest) {
    const id = this.id(request.input.analysis_run_id, 'analysis_run_id');
    const rows = (await db.query(
      `select ar.*,coalesce(jsonb_agg(jsonb_build_object('kind','analysis_result','id',sa.id))
        filter (where sa.id is not null),'[]'::jsonb) as result_refs
       from analysis_runs ar left join structured_analyses sa
         on sa.owner_id=ar.owner_id and sa.analysis_run_id=ar.id
       where ar.owner_id=$1 and ar.id=$2 group by ar.id`,
      [request.userId, id],
    )) as Row[];
    const row = this.found(rows[0]);
    return {
      analysis_run_ref: { kind: 'analysis_run', id: row.id },
      original_record_ref: { kind: 'original_record', id: row.original_record_id },
      chat_task_ref: { kind: 'chat_response', task_id: row.chat_task_id },
      analysis_type: row.analysis_type,
      status: row.status,
      result_refs: row.result_refs ?? [],
      ...(row.error_summary ? { error_summary: row.error_summary } : {}),
      version: String(row.version),
      created_at: this.iso(row.created_at), updated_at: this.iso(row.updated_at),
      ...(row.completed_at ? { completed_at: this.iso(row.completed_at) } : {}),
    };
  }

  private async pendingBatches(db: DataSource, request: LocalCoreRequest) {
    const rows = (await db.query(
      `select cb.id as batch_id,cb.version as batch_version,cb.batch_status as status,
              cb.risk_level as risk,count(ci.id)::int as item_count,
              count(ci.id) filter (where ci.risk='high')::int as high_risk_count,
              cb.expires_at,cb.created_at,cb.updated_at
       from confirmation_batches cb join candidate_items ci
         on ci.user_id=cb.user_id and ci.batch_id=cb.id and ci.candidate_status='pending'
       where cb.user_id=$1 and cb.batch_status in ('pending','partially_processed')
         and cb.expires_at>transaction_timestamp()
       group by cb.id order by cb.created_at desc,cb.id desc`,
      [request.userId],
    )) as Row[];
    return { items: rows.map((row) => ({
      batch_id: row.batch_id, batch_version: String(row.batch_version),
      status: row.status, risk: row.risk, item_count: Number(row.item_count),
      high_risk_count: Number(row.high_risk_count), expires_at: this.iso(row.expires_at),
      created_at: this.iso(row.created_at), updated_at: this.iso(row.updated_at),
    })) };
  }

  private async confirmationBatch(db: DataSource, request: LocalCoreRequest) {
    const id = this.id(request.input.batch_id, 'batch_id');
    const rows = (await db.query(
      `select * from confirmation_batches where user_id=$1 and id=$2`,
      [request.userId, id],
    )) as Row[];
    const batch = this.found(rows[0]);
    const candidates = await this.candidateRows(db, request.userId, 'ci.batch_id=$2', id);
    const sourceRefs: ResourceRef[] = [];
    if (batch.source_record_id) sourceRefs.push({ kind: 'original_record', id: String(batch.source_record_id) });
    if (batch.source_analysis_id) sourceRefs.push({ kind: 'analysis_result', id: String(batch.source_analysis_id) });
    return {
      batch_ref: { kind: 'confirmation_batch', id }, batch_version: String(batch.version),
      status: batch.batch_status, risk: batch.risk_level, item_count: candidates.length,
      high_risk_count: candidates.filter((item) => item.risk === 'high').length,
      source_refs: sourceRefs, candidates, expires_at: this.iso(batch.expires_at),
      created_at: this.iso(batch.created_at), updated_at: this.iso(batch.updated_at),
    };
  }

  private async candidateDetail(db: DataSource, request: LocalCoreRequest) {
    const id = this.id(request.input.candidate_id, 'candidate_id');
    const rows = await this.candidateRows(db, request.userId, 'ci.id=$2', id);
    return this.found(rows[0]);
  }

  private async candidateRows(db: DataSource, userId: string, where: string, value: string) {
    const rows = (await db.query(
      `select ci.* from candidate_items ci where ci.user_id=$1 and ${where}
       order by ci.created_at asc,ci.id asc`,
      [userId, value],
    )) as Row[];
    return rows.map((row) => ({
      candidate_ref: { kind: 'candidate', id: row.id },
      batch_ref: { kind: 'confirmation_batch', id: row.batch_id },
      candidate_version: String(row.version), kind: row.kind, action: row.action,
      content: row.edited_payload ?? row.payload, source_refs: row.source_refs ?? [],
      confidence: row.confidence === null ? 0 : Number(row.confidence), risk: row.risk,
      sensitive_marks: row.sensitive_marks ?? [], status: row.candidate_status,
      editable_fields: row.editable_fields ?? [],
      ...(row.target_object_id ? { target_object_ref: { kind: row.kind, id: row.target_object_id } } : {}),
      ...(row.expected_version ? { expected_target_version: String(row.expected_version) } : {}),
      expires_at: this.iso(row.expires_at), created_at: this.iso(row.created_at),
      updated_at: this.iso(row.updated_at),
    }));
  }

  private async confirmationHistory(db: DataSource, request: LocalCoreRequest) {
    const { limit, cursor, params } = this.page(request.input);
    const rows = (await db.query(
      `select ca.*,coalesce(jsonb_agg(distinct jsonb_build_object('kind',bo.kind,'id',ov.object_id))
        filter (where ov.object_id is not null),'[]'::jsonb) as object_refs
       from confirmation_actions ca left join object_versions ov
         on ov.user_id=ca.user_id and ov.confirmation_action_id=ca.id
       left join business_objects bo on bo.user_id=ov.user_id and bo.id=ov.object_id
       where ca.user_id=$1 ${cursor ? 'and (ca.created_at,ca.id)<($2,$3)' : ''}
       group by ca.id order by ca.created_at desc,ca.id desc limit ${limit + 1}`,
      [request.userId, ...params],
    )) as Row[];
    return this.pageResult(rows, limit, (row) => ({
      confirmation_action_id: row.id, batch_ref: { kind: 'confirmation_batch', id: row.batch_id },
      operation_id: row.operation_id, action_type: row.action_type,
      client_source: row.client_source, object_refs: row.object_refs ?? [],
      ...(row.reverses_action_id ? { reverses_confirmation_action_id: row.reverses_action_id } : {}),
      created_at: this.iso(row.created_at),
    }));
  }

  private async actions(db: DataSource, request: LocalCoreRequest) {
    const { limit, cursor, params } = this.page(request.input);
    const status = typeof request.input.status === 'string' ? request.input.status : undefined;
    const rows = (await db.query(
      `select bo.*,a.* from business_objects bo join actions a
         on a.user_id=bo.user_id and a.id=bo.id
       where bo.user_id=$1 and bo.kind='action'
         ${status ? `and a.execution_status=$${params.length + 2}` : ''}
         ${cursor ? 'and (bo.created_at,bo.id)<($2,$3)' : ''}
       order by bo.created_at desc,bo.id desc limit ${limit + 1}`,
      [request.userId, ...params, ...(status ? [status] : [])],
    )) as Row[];
    return this.pageResult(rows, limit, (row) => this.actionSummary(row));
  }

  private async action(db: DataSource, request: LocalCoreRequest) {
    const id = this.id(request.input.action_id, 'action_id');
    const rows = (await db.query(
      `select bo.*,a.* from business_objects bo join actions a
         on a.user_id=bo.user_id and a.id=bo.id
       where bo.user_id=$1 and bo.id=$2 and bo.kind='action'`,
      [request.userId, id],
    )) as Row[];
    const row = this.found(rows[0]);
    const refs = (await db.query(
      `select source_kind as kind,source_id as id from source_relations
       where user_id=$1 and object_id=$2 order by created_at,id`,
      [request.userId, id],
    )) as ResourceRef[];
    return {
      ...this.actionSummary(row), source_refs: refs,
      last_confirmation_batch_ref: { kind: 'confirmation_batch', id: row.last_confirmation_batch_id },
    };
  }

  private actionSummary(row: Row) {
    return {
      action_ref: { kind: 'action', id: row.id }, version: String(row.version),
      lifecycle_status: row.lifecycle_status, title: row.title,
      ...(row.description !== null ? { description: row.description } : {}),
      ...(row.priority ? { priority: row.priority } : {}),
      ...(row.timezone ? { timezone: row.timezone } : {}),
      execution_status: row.execution_status, plan_status: row.plan_status,
      timeliness_status: row.timeliness_status,
      ...this.optionalDates(row, ['deadline_at', 'planned_at', 'started_at', 'completed_at']),
      created_at: this.iso(row.created_at), updated_at: this.iso(row.updated_at),
    };
  }

  private async changeHistory(db: DataSource, request: LocalCoreRequest) {
    const id = this.id(request.input.object_id, 'object_id');
    const kind = String(request.input.object_kind ?? '');
    const owned = await db.query(
      `select 1 from business_objects where user_id=$1 and id=$2 and kind=$3`,
      [request.userId, id, kind],
    );
    this.found(owned[0]);
    const rows = (await db.query(
      `select * from object_versions where user_id=$1 and object_id=$2
       order by created_at desc,id desc`, [request.userId, id],
    )) as Row[];
    return { object_ref: { kind, id }, items: rows.map((row) => ({
      change_id: row.id, object_version: String(row.object_version), change_type: row.change_type,
      confirmation_action_id: row.confirmation_action_id,
      before: (row.snapshot as Row)?.before ?? null, after: (row.snapshot as Row)?.after ?? null,
      created_at: this.iso(row.created_at),
    })) };
  }

  private async undoEligibility(db: DataSource, request: LocalCoreRequest) {
    const id = this.id(request.input.object_id, 'object_id');
    const kind = String(request.input.object_kind ?? '');
    const latest = (await db.query(
      `select ov.*,ca.batch_id,bo.kind from object_versions ov
       join confirmation_actions ca on ca.user_id=ov.user_id and ca.id=ov.confirmation_action_id
       join business_objects bo on bo.user_id=ov.user_id and bo.id=ov.object_id
       where ov.user_id=$1 and ov.object_id=$2 and bo.kind=$3
       order by ov.created_at desc,ov.id desc limit 1`, [request.userId, id, kind],
    )) as Row[];
    const origin = this.found(latest[0]);
    const scope = (await db.query(
      `select ov.object_id,ov.object_version,ov.change_type,bo.kind,bo.version as current_version
       from object_versions ov join business_objects bo
         on bo.user_id=ov.user_id and bo.id=ov.object_id
       where ov.user_id=$1 and ov.confirmation_action_id=$2 order by ov.object_id`,
      [request.userId, origin.confirmation_action_id],
    )) as Row[];
    const versionConflict = scope.some((row) => String(row.current_version) !== String(row.object_version));
    const permanent = scope.some((row) => row.change_type === 'permanent_delete');
    const reasons = [
      ...(permanent ? [{ code: 'permanent_delete', message: '彻底删除不可撤销' }] : []),
      ...(versionConflict ? [{ code: 'version_conflict', message: '对象已有后续版本' }] : []),
    ];
    return {
      object_ref: { kind, id }, eligible: !permanent && !versionConflict,
      original_confirmation_action_id: origin.confirmation_action_id,
      original_confirmation_batch_id: origin.batch_id, reversible: !permanent,
      version_conflict: versionConflict, incompatible_follow_up: versionConflict,
      undo_scope: {
        original_confirmation_batch_id: origin.batch_id, whole_batch_required: true,
        object_refs: scope.map((row) => ({ kind: row.kind, id: row.object_id })),
        observed_versions: Object.fromEntries(scope.map((row) => [String(row.object_id), String(row.current_version)])),
      },
      blocking_reasons: reasons, requires_confirmation_batch: true,
    };
  }

  private page(input: Row) {
    const requested = Number(input.limit ?? 50);
    const limit = Number.isSafeInteger(requested) && requested > 0 && requested <= 100 ? requested : 50;
    if (typeof input.cursor !== 'string') return { limit, cursor: undefined, params: [] as unknown[] };
    try {
      const [createdAt, id] = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()) as unknown[];
      if (typeof createdAt !== 'string' || !UUID.test(String(id))) throw new Error();
      return { limit, cursor: input.cursor, params: [createdAt, id] };
    } catch {
      throw new HttpException({ code: 'VALIDATION_001', message: '分页游标无效' }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }

  private pageResult(rows: Row[], limit: number, map: (row: Row) => unknown) {
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(map),
      ...(rows.length > limit && last
        ? { next_cursor: Buffer.from(JSON.stringify([this.iso(last.created_at), last.id])).toString('base64url') }
        : {}),
    };
  }

  private optionalDates(row: Row, fields: string[]) {
    return Object.fromEntries(fields.flatMap((field) => row[field] ? [[field, this.iso(row[field])]] : []));
  }
  private iso(value: unknown) { return new Date(value as string | number | Date).toISOString(); }
  private found<T>(value: T | undefined): T {
    if (!value) throw new NotFoundException({ code: 'AUTH_002', message: '资源不存在' });
    return value;
  }
  private id(value: unknown, field: string) {
    if (typeof value !== 'string' || !UUID.test(value)) {
      throw new HttpException({ code: 'VALIDATION_001', message: `${field} 必须是 UUID` }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return value;
  }
}
