import { randomUUID } from 'node:crypto';
import type { ResourceRef } from '@partner-agent/contracts';
import type { QueryRunner } from 'typeorm';
import { ConfirmationDomainService } from './confirmation-domain.service.js';
import { parseConfirmationRequest } from './confirmation-request.parser.js';
import { confirmationError } from './confirmation-transaction.errors.js';
import { ConfirmationTransactionPersistence } from './confirmation-transaction.persistence.js';
import type { ChangedObject, StoredCommandResult } from './confirmation-transaction.types.js';
import type { LocalCoreCommandRequest } from './local-core-api.types.js';
import {
  isExpired,
  itemFor,
  undoActionId,
  validateBatch,
  validateCandidates,
  validateObjectVersions,
} from './confirmation.validator.js';

export type ConfirmationExecution =
  | { outcome: 'completed'; result: StoredCommandResult }
  | { outcome: 'duplicate'; result: StoredCommandResult }
  | { outcome: 'expired'; error: ReturnType<typeof confirmationError> };

/** Executes the authoritative confirmation state transition inside an existing transaction. */
export async function executeConfirmationTransaction(
  runner: QueryRunner,
  request: LocalCoreCommandRequest,
): Promise<ConfirmationExecution> {
  const parsed = parseConfirmationRequest(request);
  const persistence = new ConfirmationTransactionPersistence(runner);
  const domain = new ConfirmationDomainService(persistence);

  await persistence.acquireOperationLock(request.userId, parsed.operationId);
  const duplicate = await persistence.findDuplicate(
    request.userId,
    parsed.operationId,
    parsed.fingerprint,
  );
  if (duplicate) return { outcome: 'duplicate', result: duplicate };

  const batch = await persistence.lockBatch(request.userId, parsed.batchId);
  const concurrentDuplicate = await persistence.findDuplicate(
    request.userId,
    parsed.operationId,
    parsed.fingerprint,
  );
  if (concurrentDuplicate) {
    return { outcome: 'duplicate', result: concurrentDuplicate };
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
    candidates.some((candidate) => isExpired(candidate.expires_at, databaseNow))
  ) {
    await persistence.expireBatch(request.userId, parsed.batchId, databaseNow);
    return {
      outcome: 'expired',
      error: confirmationError('CONFIRMATION_002', '候选或确认批次已过期', 409),
    };
  }

  const activeCandidates = candidates.filter(
    (candidate) => itemFor(parsed.payload, candidate.id).decision !== 'cancel',
  );
  const targetIds = activeCandidates
    .map((candidate) => candidate.target_object_id)
    .filter((id): id is string => Boolean(id))
    .sort();
  const objects = await persistence.lockObjects(request.userId, targetIds);
  validateObjectVersions(parsed.payload, candidates, objects);

  const actionId = randomUUID();
  const reversesActionId = activeCandidates.length > 0
    && activeCandidates.every((candidate) => candidate.action === 'undo')
    ? undoActionId(activeCandidates)
    : null;
  await persistence.insertAction({
    actionId,
    userId: request.userId,
    batchId: parsed.batchId,
    operationId: parsed.operationId,
    fingerprint: parsed.fingerprint,
    actionType: actionType(parsed.payload, reversesActionId),
    payload: parsed.payload,
    clientSource: parsed.clientSource,
    reversesActionId,
    now: databaseNow,
  });

  const changed = activeCandidates.length === 0
    ? []
    : reversesActionId
      ? await domain.applyUndo(
          request.userId, parsed.batchId, actionId, reversesActionId,
          activeCandidates, objects, databaseNow,
        )
      : await domain.applyCandidates(
          request.userId, parsed.batchId, actionId, parsed.payload,
          activeCandidates, objects, databaseNow,
        );
  await persistence.completeCandidates(
    request.userId,
    parsed.batchId,
    parsed.payload,
    databaseNow,
  );
  await persistence.completeBatch(request.userId, parsed.batchId, databaseNow);
  const result = buildResult(parsed.operationId, parsed.batchId, changed);
  await persistence.storeResult(request.userId, actionId, parsed.payload, result);
  return { outcome: 'completed', result };
}

function actionType(
  payload: ReturnType<typeof parseConfirmationRequest>['payload'],
  reversesActionId: string | null,
): string {
  if (reversesActionId) return 'undo';
  if (payload.items.every((item) => item.decision === 'cancel')) return 'cancel';
  if (payload.items.some((item) => item.decision === 'modify_confirm')) return 'confirm_after_edit';
  return 'confirm';
}

function buildResult(
  operationId: string,
  batchId: string,
  changed: ChangedObject[],
): StoredCommandResult {
  return {
    operation_id: operationId,
    status: 'completed',
    resource_refs: [
      { kind: 'confirmation_batch', id: batchId },
      ...changed.map((item) => ({ kind: resourceKind(item.kind), id: item.id })),
    ],
    new_versions: Object.fromEntries(changed.map((item) => [item.id, item.version])),
    data: {
      batch_ref: { kind: 'confirmation_batch', id: batchId },
      confirmed: changed.map((item) => ({
        ref: { kind: resourceKind(item.kind), id: item.id },
        version: item.version,
      })),
    },
  };
}

function resourceKind(kind: ChangedObject['kind']): ResourceRef['kind'] {
  return kind === 'reminder' ? 'reminder_plan' : kind;
}
