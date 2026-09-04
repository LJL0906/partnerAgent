import type { LocalCoreCommandRequest } from './local-core-api.types.js';
import {
  confirmationError,
  requiredString,
  requiredUuid,
} from './confirmation-transaction.errors.js';
import type { ParsedPayload } from './confirmation-transaction.types.js';

export interface ParsedConfirmationRequest {
  operationId: string;
  fingerprint: string;
  clientSource: string;
  payload: ParsedPayload;
  batchId: string;
  candidateIds: string[];
}

export function parseConfirmationRequest(
  request: LocalCoreCommandRequest,
): ParsedConfirmationRequest {
  const envelope = request.envelope;
  const operationId = requiredUuid(envelope.operation_id, 'operation_id');
  const fingerprint = requiredString(
    envelope.request_fingerprint,
    'request_fingerprint',
  );
  const clientSource = parseClientSource(envelope.client_source);
  const payload = parsePayload(envelope.payload);
  const candidateIds = payload.items.map((item) =>
    requiredUuid(item.candidate_id, 'candidate_id'),
  );
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw confirmationError('VALIDATION_001', '候选项不能重复', 422);
  }
  return {
    operationId,
    fingerprint,
    clientSource,
    payload,
    batchId: requiredUuid(
      payload.confirmation_batch_id,
      'confirmation_batch_id',
    ),
    candidateIds,
  };
}

function parsePayload(value: unknown): ParsedPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw confirmationError('VALIDATION_001', '确认载荷必须是对象', 422);
  }
  const payload = value as Partial<ParsedPayload>;
  if (
    typeof payload.confirmation_batch_id !== 'string' ||
    typeof payload.batch_version !== 'string' ||
    !Array.isArray(payload.items) ||
    payload.items.length === 0
  ) {
    throw confirmationError(
      'VALIDATION_001',
      '确认批次标识、版本或候选项无效',
      422,
    );
  }
  for (const item of payload.items) {
    if (
      !item ||
      typeof item.candidate_id !== 'string' ||
      typeof item.candidate_version !== 'string' ||
      !['confirm', 'modify_confirm', 'cancel'].includes(item.decision)
    ) {
      throw confirmationError('VALIDATION_001', '候选决策无效', 422);
    }
  }
  return payload as ParsedPayload;
}

function parseClientSource(value: unknown): string {
  if (!['ios', 'android', 'web', 'other'].includes(String(value))) {
    throw confirmationError('VALIDATION_001', 'client_source 无效', 422);
  }
  return String(value);
}
