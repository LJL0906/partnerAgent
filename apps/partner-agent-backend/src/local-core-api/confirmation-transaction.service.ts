import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ResourceRef } from '@partner-agent/contracts';
import { SessionStore } from '../database/session-store.js';
import { TypeOrmSessionStore } from '../database/typeorm-session.store.js';
import { ConfirmationDomainService } from './confirmation-domain.service.js';
import { parseConfirmationRequest } from './confirmation-request.parser.js';
import { confirmationError } from './confirmation-transaction.errors.js';
import { ConfirmationTransactionPersistence } from './confirmation-transaction.persistence.js';
import type {
  ChangedObject,
  StoredCommandResult,
} from './confirmation-transaction.types.js';
import type { LocalCoreCommandRequest } from './local-core-api.types.js';
import {
  isExpired,
  itemFor,
  undoActionId,
  validateBatch,
  validateCandidates,
  validateObjectVersions,
} from './confirmation.validator.js';

@Injectable()
export class ConfirmationTransactionService {
  constructor(private readonly sessionStore: SessionStore) {}

  async submit(request: LocalCoreCommandRequest): Promise<StoredCommandResult> {
    const parsed = parseConfirmationRequest(request);
    const runner = this.dataSource().createQueryRunner();
    const persistence = new ConfirmationTransactionPersistence(runner);
    const domain = new ConfirmationDomainService(persistence);
    let committed = false;

    await runner.connect();
    await runner.startTransaction();
    try {
      await persistence.acquireOperationLock(
        request.userId,
        parsed.operationId,
      );
      const duplicate = await persistence.findDuplicate(
        request.userId,
        parsed.operationId,
        parsed.fingerprint,
      );
      if (duplicate) {
        await runner.rollbackTransaction();
        return duplicate;
      }

      const batch = await persistence.lockBatch(request.userId, parsed.batchId);
      const concurrentDuplicate = await persistence.findDuplicate(
        request.userId,
        parsed.operationId,
        parsed.fingerprint,
      );
      if (concurrentDuplicate) {
        await runner.rollbackTransaction();
        return concurrentDuplicate;
      }
      validateBatch(batch, parsed.payload);

      const candidates = await persistence.lockCandidates(
        request.userId,
        parsed.batchId,
        parsed.candidateIds,
      );
      validateCandidates(parsed.payload, batch!, candidates);
      const databaseNow = await persistence.transactionTime();
      if (
        isExpired(batch!.expires_at, databaseNow) ||
        candidates.some((candidate) =>
          isExpired(candidate.expires_at, databaseNow),
        )
      ) {
        await persistence.expireBatch(
          request.userId,
          parsed.batchId,
          databaseNow,
        );
        await runner.commitTransaction();
        committed = true;
        throw confirmationError(
          'CONFIRMATION_002',
          '候选或确认批次已过期',
          409,
        );
      }

      const activeCandidates = candidates.filter(
        (candidate) =>
          itemFor(parsed.payload, candidate.id).decision !== 'cancel',
      );
      const targetIds = activeCandidates
        .map((candidate) => candidate.target_object_id)
        .filter((id): id is string => Boolean(id))
        .sort();
      const objects = await persistence.lockObjects(request.userId, targetIds);
      validateObjectVersions(parsed.payload, candidates, objects);

      const actionId = randomUUID();
      const reversesActionId =
        activeCandidates.length > 0 &&
        activeCandidates.every((candidate) => candidate.action === 'undo')
          ? undoActionId(activeCandidates)
          : null;
      await persistence.insertAction({
        actionId,
        userId: request.userId,
        batchId: parsed.batchId,
        operationId: parsed.operationId,
        fingerprint: parsed.fingerprint,
        actionType: this.actionType(parsed.payload, reversesActionId),
        payload: parsed.payload,
        clientSource: parsed.clientSource,
        reversesActionId,
        now: databaseNow,
      });

      const changed =
        activeCandidates.length === 0
          ? []
          : reversesActionId
            ? await domain.applyUndo(
                request.userId,
                parsed.batchId,
                actionId,
                reversesActionId,
                activeCandidates,
                objects,
                databaseNow,
              )
            : await domain.applyCandidates(
                request.userId,
                parsed.batchId,
                actionId,
                parsed.payload,
                activeCandidates,
                objects,
                databaseNow,
              );
      await persistence.completeCandidates(
        request.userId,
        parsed.batchId,
        parsed.payload,
        databaseNow,
      );
      await persistence.completeBatch(
        request.userId,
        parsed.batchId,
        databaseNow,
      );
      const result = this.buildResult(
        parsed.operationId,
        parsed.batchId,
        changed,
      );
      await persistence.storeResult(
        request.userId,
        actionId,
        parsed.payload,
        result,
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

  private actionType(
    payload: ReturnType<typeof parseConfirmationRequest>['payload'],
    reversesActionId: string | null,
  ): string {
    if (reversesActionId) return 'undo';
    if (payload.items.every((item) => item.decision === 'cancel'))
      return 'cancel';
    if (payload.items.some((item) => item.decision === 'modify_confirm')) {
      return 'confirm_after_edit';
    }
    return 'confirm';
  }

  private buildResult(
    operationId: string,
    batchId: string,
    changed: ChangedObject[],
  ): StoredCommandResult {
    return {
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
  }

  private resourceKind(kind: ChangedObject['kind']): ResourceRef['kind'] {
    return kind === 'reminder' ? 'reminder_plan' : kind;
  }

  private dataSource() {
    if (!(this.sessionStore instanceof TypeOrmSessionStore)) {
      throw confirmationError(
        'INTERNAL_000',
        '正式确认需要 PostgreSQL 存储',
        503,
      );
    }
    return this.sessionStore.getDataSource();
  }
}
