import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  parseCreateUndoObjectCandidateCommandRequest,
  parseCreateUndoObjectCandidateCommandResult,
} from '@partner-agent/contracts';
import type { EntityManager } from 'typeorm';
import { SessionStore } from '../database/session-store.js';
import { TypeOrmSessionStore } from '../database/typeorm-session.store.js';
import { ChatTaskStore } from './chat-task.store.js';
import type { LocalCoreCommandRequest } from './local-core-api.types.js';

interface UndoSourceRow {
  object_id: string;
  object_version: string;
  change_type: string;
  kind: string;
  current_version: string;
  lifecycle_status: string;
}

@Injectable()
export class UndoCandidateService {
  constructor(
    private readonly tasks: ChatTaskStore,
    private readonly sessions: SessionStore,
  ) {}

  async create(request: LocalCoreCommandRequest) {
    let envelope;
    try {
      envelope = parseCreateUndoObjectCandidateCommandRequest(request.envelope);
    } catch {
      throw new HttpException(
        { code: 'VALIDATION_001', message: '撤销候选请求无效' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!(this.sessions instanceof TypeOrmSessionStore)) {
      throw new HttpException(
        { code: 'DEPS_001', message: '正式撤销候选需要 PostgreSQL' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const result = await this.tasks.executeIdempotentCommand(
      {
        ownerId: request.userId,
        operationId: envelope.operation_id,
        requestFingerprint: envelope.request_fingerprint,
        commandName: 'CreateUndoObjectCandidate',
      },
      async (manager) => {
        if (!manager) throw new Error('正式撤销候选缺少事务管理器');
        return this.createInTransaction(manager, request.userId, envelope);
      },
    );
    try {
      return parseCreateUndoObjectCandidateCommandResult(
        result,
        envelope.operation_id,
      );
    } catch {
      throw new HttpException(
        { code: 'CONTRACT_001', message: '撤销候选结果不符合契约' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async createInTransaction(
    manager: EntityManager,
    userId: string,
    envelope: ReturnType<typeof parseCreateUndoObjectCandidateCommandRequest>,
  ) {
    const payload = envelope.payload;
    await manager.query('select pg_advisory_xact_lock(hashtext($1))', [
      `${userId}:${payload.original_confirmation_action_id}`,
    ]);
    const actions = await manager.query(
      `select id,batch_id,action_type from confirmation_actions
       where user_id=$1 and id=$2 and batch_id=$3`,
      [
        userId,
        payload.original_confirmation_action_id,
        payload.original_confirmation_batch_id,
      ],
    );
    const action = actions[0] as
      | { id: string; batch_id: string; action_type: string }
      | undefined;
    if (!action || !['confirm', 'confirm_after_edit'].includes(action.action_type)) {
      throw this.conflict('原确认操作不存在或不可撤销');
    }

    const rows = (await manager.query(
      `select ov.object_id,ov.object_version,ov.change_type,bo.kind,
              bo.version as current_version,bo.lifecycle_status
       from object_versions ov join business_objects bo
         on bo.user_id=ov.user_id and bo.id=ov.object_id
       where ov.user_id=$1 and ov.confirmation_action_id=$2
       order by ov.object_id for update of bo`,
      [userId, action.id],
    )) as UndoSourceRow[];
    if (rows.length === 0) throw this.conflict('原确认操作没有可撤销对象');
    if (rows.some((row) => row.change_type === 'permanent_delete')) {
      throw this.conflict('彻底删除不可撤销');
    }

    const observed = payload.observed_versions;
    const scopeMatches =
      Object.keys(observed).length === rows.length
      && rows.every(
        (row) =>
          observed[row.object_id] === String(row.current_version)
          && String(row.object_version) === String(row.current_version),
      );
    if (!scopeMatches) throw this.conflict('对象版本已变化，请重新查询撤销资格', 'VERSION_001');

    const source = (await manager.query(
      `select source_record_id,source_analysis_id from confirmation_batches
       where user_id=$1 and id=$2`,
      [userId, action.batch_id],
    ))[0] as
      | { source_record_id: string | null; source_analysis_id: string | null }
      | undefined;
    if (!source) throw this.conflict('原确认批次不存在');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
    const batchId = randomUUID();
    await manager.query(
      `insert into confirmation_batches
         (id,user_id,source_record_id,source_analysis_id,batch_status,risk_level,
          expires_at,version,created_at,updated_at)
       values ($1,$2,$3,$4,'pending','normal',$5,1,$6,$6)`,
      [batchId, userId, source.source_record_id, source.source_analysis_id, expiresAt, now],
    );

    const candidateRefs = [];
    for (const row of rows) {
      const candidateId = randomUUID();
      await manager.query(
        `insert into candidate_items
           (id,user_id,batch_id,kind,action,candidate_status,risk,payload,
            editable_fields,confidence,sensitive_marks,target_object_id,
            expected_version,source_refs,expires_at,version,created_at,updated_at)
         values ($1,$2,$3,$4,'undo','pending','normal',$5::jsonb,'{}',null,'{}',
                 $6,$7,$8::jsonb,$9,1,$10,$10)`,
        [
          candidateId,
          userId,
          batchId,
          row.kind,
          JSON.stringify({
            original_confirmation_action_id: action.id,
            original_confirmation_batch_id: action.batch_id,
          }),
          row.object_id,
          row.current_version,
          JSON.stringify([
            { kind: 'confirmation_batch', id: action.batch_id },
          ]),
          expiresAt,
          now,
        ],
      );
      candidateRefs.push({
        candidate_ref: { kind: 'candidate' as const, id: candidateId },
        candidate_version: '1',
        target_object_ref: { kind: row.kind, id: row.object_id },
        expected_target_version: String(row.current_version),
      });
    }

    const data = {
      confirmation_batch_ref: { kind: 'confirmation_batch' as const, id: batchId },
      batch_version: '1',
      candidate_refs: candidateRefs,
    };
    return {
      operation_id: envelope.operation_id,
      status: 'completed' as const,
      resource_refs: [
        data.confirmation_batch_ref,
        ...candidateRefs.map((candidate) => candidate.candidate_ref),
      ],
      new_versions: Object.fromEntries([
        [batchId, '1'],
        ...candidateRefs.map((candidate) => [candidate.candidate_ref.id, '1']),
      ]),
      data,
    };
  }

  private conflict(message: string, code = 'CONFIRMATION_003') {
    return new HttpException({ code, message }, HttpStatus.CONFLICT);
  }
}
