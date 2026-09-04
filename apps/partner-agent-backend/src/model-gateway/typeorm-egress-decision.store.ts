import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import {
  EgressDecisionConflictError,
  EgressDecisionExpiredError,
  EgressDecisionIdempotencyConflictError,
  EgressDecisionNotFoundError,
  type ConsumeEgressDecisionResult,
  type CreatePendingEgressDecisionInput,
  type EgressDecisionBinding,
  type EgressDecisionRequestState,
  type EgressDecisionStore,
  type PrivacyDecision,
  type StoredEgressDecision,
  type SubmitEgressDecisionInput,
  type SubmitEgressDecisionResult,
} from './egress-decision.store.js';

type DatabaseRow = Record<string, unknown>;

export class TypeOrmEgressDecisionStore implements EgressDecisionStore {
  constructor(private readonly dataSource: DataSource) {}

  async createOrGetPending(input: CreatePendingEgressDecisionInput) {
    this.validateCreate(input);
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `select id from chat_tasks
         where id = $1 and owner_id = $2
         for update`,
        [input.taskId, input.ownerId],
      );
      const existing = await manager.query(
        `select * from egress_decision_requests
         where owner_id = $1 and task_id = $2
           and request_fingerprint = $3 and provider = $4
           and model_id = $5 and source = $6
           and state in ('pending','ready_allow','ready_redact')
         order by created_at desc limit 1`,
        [
          input.ownerId,
          input.taskId,
          input.requestFingerprint,
          input.provider,
          input.modelId,
          input.source,
        ],
      );
      if (existing[0]) return this.toStored(existing[0]);

      await manager.query(
        `update egress_decision_requests
         set state = case when state = 'pending' then 'cancelled' else 'invalidated' end,
             version = version + 1,
             updated_at = transaction_timestamp()
         where owner_id = $1 and task_id = $2
           and state in ('pending','ready_allow','ready_redact')`,
        [input.ownerId, input.taskId],
      );
      const rows = this.returnedRows(
        await manager.query(
          `insert into egress_decision_requests (
           id, owner_id, task_id, session_id, operation_id,
           request_fingerprint, provider, model_id, source, categories,
           state, decision, version, created_at, updated_at, expires_at,
           decided_at, consumed_at
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           'pending',null,1,transaction_timestamp(),transaction_timestamp(),
           transaction_timestamp() + ($11 * interval '1 millisecond'),null,null
         ) returning *`,
          [
            randomUUID(),
            input.ownerId,
            input.taskId,
            input.sessionId,
            input.operationId,
            input.requestFingerprint,
            input.provider,
            input.modelId,
            input.source,
            [...input.categories],
            input.ttlMs,
          ],
        ),
      );
      return this.toStored(rows[0]);
    });
  }

  async findCurrentForTask(taskId: string, ownerId: string) {
    const rows = await this.dataSource.query(
      `select * from egress_decision_requests
       where task_id = $1 and owner_id = $2
         and state in ('pending','ready_allow','ready_redact')
       order by created_at desc limit 1`,
      [taskId, ownerId],
    );
    return rows[0] ? this.toStored(rows[0]) : undefined;
  }

  async findLatestForTask(taskId: string, ownerId: string) {
    const rows = await this.dataSource.query(
      `select * from egress_decision_requests
       where task_id = $1 and owner_id = $2
       order by created_at desc limit 1`,
      [taskId, ownerId],
    );
    return rows[0] ? this.toStored(rows[0]) : undefined;
  }

  async findByIdForOwner(id: string, ownerId: string) {
    const rows = await this.dataSource.query(
      `select * from egress_decision_requests
       where id = $1 and owner_id = $2`,
      [id, ownerId],
    );
    return rows[0] ? this.toStored(rows[0]) : undefined;
  }

  async submitDecision(
    input: SubmitEgressDecisionInput,
  ): Promise<SubmitEgressDecisionResult> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      await manager.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${input.ownerId}:${input.commandOperationId}`,
      ]);
      const prior = await manager.query(
        `select * from local_core_operations
         where owner_id = $1 and operation_id = $2
         for update`,
        [input.ownerId, input.commandOperationId],
      );
      if (prior[0]) return this.replay(manager, prior[0], input);

      const rows = await manager.query(
        `select *, transaction_timestamp() as database_now
         from egress_decision_requests
         where id = $1 and owner_id = $2
         for update`,
        [input.egressId, input.ownerId],
      );
      const row = rows[0] as DatabaseRow | undefined;
      if (!row) throw new EgressDecisionNotFoundError();
      if (row.state !== 'pending') throw new EgressDecisionConflictError();
      if (
        new Date(String(row.expires_at)) <= new Date(String(row.database_now))
      ) {
        const expired = this.returnedRows(
          await manager.query(
            `update egress_decision_requests
           set state = 'expired', version = version + 1,
               updated_at = transaction_timestamp()
           where id = $1 returning *`,
            [input.egressId],
          ),
        );
        return { expired: this.toStored(expired[0]) };
      }

      const state = this.stateForDecision(input.decision);
      const updated = this.returnedRows(
        await manager.query(
          `update egress_decision_requests
         set state = $2, decision = $3, version = version + 1,
             decided_at = transaction_timestamp(),
             updated_at = transaction_timestamp()
         where id = $1 returning *`,
          [input.egressId, state, input.decision],
        ),
      );
      const record = this.toStored(updated[0]);
      const result = this.commandResult(input.commandOperationId, record);
      await manager.query(
        `insert into local_core_operations (
           id, owner_id, operation_id, request_fingerprint,
           command_name, result_json, created_at
         ) values ($1,$2,$3,$4,'SubmitPrivacyDecision',$5,transaction_timestamp())`,
        [
          randomUUID(),
          input.ownerId,
          input.commandOperationId,
          input.commandRequestFingerprint,
          result,
        ],
      );
      return { record, result };
    });
    if ('expired' in outcome) throw new EgressDecisionExpiredError();
    return outcome;
  }

  async consumeMatchingDecision(
    input: EgressDecisionBinding,
  ): Promise<ConsumeEgressDecisionResult> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `select id from chat_tasks
         where id = $1 and owner_id = $2 for update`,
        [input.taskId, input.ownerId],
      );
      const rows = await manager.query(
        `select *, transaction_timestamp() as database_now
         from egress_decision_requests
         where task_id = $1 and owner_id = $2
           and state in ('pending','ready_allow','ready_redact')
         order by created_at desc limit 1 for update`,
        [input.taskId, input.ownerId],
      );
      const row = rows[0] as DatabaseRow | undefined;
      if (!row) return this.terminalOutcome(manager, input);
      if (
        row.state === 'pending' &&
        new Date(String(row.expires_at)) <= new Date(String(row.database_now))
      ) {
        return this.transitionOutcome(manager, row, 'expired', 'expired');
      }
      if (!this.rowMatches(row, input)) {
        const state = row.state === 'pending' ? 'cancelled' : 'invalidated';
        return this.transitionOutcome(manager, row, state, 'invalidated');
      }
      if (row.state === 'pending')
        return { status: 'pending', record: this.toStored(row) };
      const consumed = this.returnedRows(
        await manager.query(
          `update egress_decision_requests
         set state = 'consumed', version = version + 1,
             consumed_at = transaction_timestamp(),
             updated_at = transaction_timestamp()
         where id = $1 returning *`,
          [row.id],
        ),
      );
      return { status: 'consumed', record: this.toStored(consumed[0]) };
    });
  }

  async cancelPendingForTask(taskId: string, ownerId: string) {
    const rows = this.returnedRows(
      await this.dataSource.query(
        `update egress_decision_requests
       set state = 'cancelled', version = version + 1,
           updated_at = transaction_timestamp()
       where task_id = $1 and owner_id = $2
         and state in ('pending','ready_allow','ready_redact')
       returning *`,
        [taskId, ownerId],
      ),
    );
    return rows.map((row: DatabaseRow) => this.toStored(row));
  }

  async expireDue(limit = 100) {
    this.validateLimit(limit);
    const rows = this.returnedRows(
      await this.dataSource.query(
        `with due as (
         select id from egress_decision_requests
         where state = 'pending' and expires_at <= transaction_timestamp()
         order by expires_at, id limit $1 for update skip locked
       )
       update egress_decision_requests request
       set state = 'expired', version = request.version + 1,
           updated_at = transaction_timestamp()
       from due where request.id = due.id returning request.*`,
        [limit],
      ),
    );
    return rows.map((row: DatabaseRow) => this.toStored(row));
  }

  async listRecoverableDecisions(limit = 100) {
    this.validateLimit(limit);
    const rows = await this.dataSource.query(
      `select request.* from egress_decision_requests request
       join chat_tasks task
         on task.id = request.task_id and task.owner_id = request.owner_id
       where request.state in ('ready_allow','ready_redact')
         and task.state = 'waiting_privacy_decision'
       order by request.created_at, request.id limit $1`,
      [limit],
    );
    return rows.map((row: DatabaseRow) => this.toStored(row));
  }

  private async replay(
    manager: EntityManager,
    operation: DatabaseRow,
    input: SubmitEgressDecisionInput,
  ): Promise<SubmitEgressDecisionResult> {
    if (
      operation.command_name !== 'SubmitPrivacyDecision' ||
      operation.request_fingerprint !== input.commandRequestFingerprint
    )
      throw new EgressDecisionIdempotencyConflictError();
    const result = operation.result_json as Record<string, unknown>;
    const data = result.data as Record<string, unknown>;
    const rows = await manager.query(
      `select * from egress_decision_requests
       where id = $1 and owner_id = $2`,
      [data.egress_id, input.ownerId],
    );
    if (!rows[0]) throw new EgressDecisionNotFoundError();
    return {
      record: this.toStored(rows[0]),
      result: { ...result, status: 'duplicate' },
    };
  }

  private async terminalOutcome(
    manager: EntityManager,
    input: EgressDecisionBinding,
  ): Promise<ConsumeEgressDecisionResult> {
    const rows = await manager.query(
      `select * from egress_decision_requests
       where task_id = $1 and owner_id = $2
       order by created_at desc limit 1`,
      [input.taskId, input.ownerId],
    );
    if (!rows[0] || ['consumed', 'invalidated'].includes(rows[0].state))
      return { status: 'missing' };
    if (['blocked', 'expired', 'cancelled'].includes(rows[0].state))
      return { status: rows[0].state, record: this.toStored(rows[0]) };
    return { status: 'missing' };
  }

  private async transitionOutcome(
    manager: EntityManager,
    row: DatabaseRow,
    state: EgressDecisionRequestState,
    status: 'expired' | 'invalidated',
  ): Promise<ConsumeEgressDecisionResult> {
    const rows = this.returnedRows(
      await manager.query(
        `update egress_decision_requests
       set state = $2, version = version + 1,
           updated_at = transaction_timestamp()
       where id = $1 returning *`,
        [row.id, state],
      ),
    );
    return { status, record: this.toStored(rows[0]) };
  }

  private rowMatches(row: DatabaseRow, input: EgressDecisionBinding) {
    return (
      row.owner_id === input.ownerId &&
      row.task_id === input.taskId &&
      row.request_fingerprint === input.requestFingerprint &&
      row.provider === input.provider &&
      row.model_id === input.modelId &&
      row.source === input.source
    );
  }

  private stateForDecision(decision: PrivacyDecision) {
    return decision === 'allow'
      ? 'ready_allow'
      : decision === 'redact'
        ? 'ready_redact'
        : 'blocked';
  }

  private commandResult(operationId: string, record: StoredEgressDecision) {
    return {
      operation_id: operationId,
      status: record.state === 'blocked' ? 'completed' : 'accepted',
      task_refs: [{ task_id: record.taskId, kind: 'chat_response' }],
      data: {
        egress_id: record.id,
        task_id: record.taskId,
        decision: record.decision,
        state: record.state,
        version: String(record.version),
      },
    };
  }

  private toStored(row: DatabaseRow): StoredEgressDecision {
    return {
      id: String(row.id),
      ownerId: String(row.owner_id),
      taskId: String(row.task_id),
      sessionId: String(row.session_id),
      operationId: String(row.operation_id),
      requestFingerprint: String(row.request_fingerprint),
      provider: String(row.provider),
      modelId: String(row.model_id),
      source: String(row.source),
      categories: row.categories as StoredEgressDecision['categories'],
      state: row.state as EgressDecisionRequestState,
      ...(row.decision ? { decision: row.decision as PrivacyDecision } : {}),
      version: Number(row.version),
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
      expiresAt: new Date(String(row.expires_at)),
      ...(row.decided_at
        ? { decidedAt: new Date(String(row.decided_at)) }
        : {}),
      ...(row.consumed_at
        ? { consumedAt: new Date(String(row.consumed_at)) }
        : {}),
    };
  }

  private validateCreate(input: CreatePendingEgressDecisionInput) {
    if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0)
      throw new RangeError('ttlMs 必须是正数');
    if (input.categories.length === 0)
      throw new RangeError('categories 不能为空');
  }
  private validateLimit(limit: number) {
    if (!Number.isInteger(limit) || limit <= 0)
      throw new RangeError('limit 必须是正整数');
  }

  /** TypeORM 1.x returns UPDATE/INSERT RETURNING as [rows, affected]. */
  private returnedRows(result: unknown): DatabaseRow[] {
    if (!Array.isArray(result)) return [];
    if (Array.isArray(result[0]) && typeof result[1] === 'number') {
      return result[0] as DatabaseRow[];
    }
    return result as DatabaseRow[];
  }
}
