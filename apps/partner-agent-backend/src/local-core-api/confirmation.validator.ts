import { confirmationError, requiredUuid } from './confirmation-transaction.errors.js';
import type {
  BatchRow,
  BusinessRow,
  CandidateRow,
  ParsedPayload,
} from './confirmation-transaction.types.js';

export function itemFor(payload: ParsedPayload, candidateId: string) {
  const item = payload.items.find((entry) => entry.candidate_id === candidateId);
  if (!item) throw confirmationError('CONFIRMATION_002', '候选不存在', 409);
  return item;
}

export function validateBatch(batch: BatchRow | undefined, payload: ParsedPayload) {
  if (!batch || !['pending', 'partially_processed'].includes(batch.batch_status)) {
    throw confirmationError('CONFIRMATION_002', '确认批次当前不可处理', 409);
  }
  if (String(batch.version) !== payload.batch_version) {
    throw confirmationError('VERSION_001', '确认批次版本冲突', 409, {
      confirmation_batch_id: batch.id,
      expected_version: payload.batch_version,
      current_version: String(batch.version),
    });
  }
}

export function validateCandidates(
  payload: ParsedPayload,
  batch: BatchRow,
  candidates: CandidateRow[],
): void {
  if (
    candidates.length !== payload.items.length ||
    candidates.some((candidate) => candidate.candidate_status !== 'pending')
  ) {
    throw confirmationError('CONFIRMATION_002', '候选不存在或当前不可确认', 409);
  }
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  for (const item of payload.items) {
    const candidate = byId.get(item.candidate_id);
    if (!candidate || String(candidate.version) !== item.candidate_version) {
      throw confirmationError('VERSION_001', '候选版本冲突', 409, {
        candidate_id: item.candidate_id,
        expected_version: item.candidate_version,
        current_version: candidate ? String(candidate.version) : undefined,
      });
    }
    if (
      item.target_object_id !== undefined &&
      candidate.target_object_id !== item.target_object_id
    ) {
      throw confirmationError('CONFIRMATION_003', '候选目标与服务端不一致', 409);
    }
    if (
      item.decision !== 'cancel' &&
      candidate.risk === 'high' &&
      item.risk_acknowledged !== true
    ) {
      throw confirmationError('CONFIRMATION_001', '高风险候选需要显式风险确认', 409);
    }
    if (
      candidate.action === 'permanent_delete' &&
      (candidate.risk !== 'high' || batch.risk_level !== 'high')
    ) {
      throw confirmationError(
        'CONFIRMATION_001',
        '彻底删除必须使用高风险单候选批次',
        409,
      );
    }
    validateModifiedPayload(item, candidate);
  }
  if (
    (batch.risk_level === 'high' || candidates.some((candidate) => candidate.risk === 'high')) &&
    candidates.length !== 1
  ) {
    throw confirmationError('CONFIRMATION_001', '高风险候选必须单独确认', 409);
  }
  const allUndo = candidates.every((candidate) => candidate.action === 'undo');
  if (candidates.some((candidate) => candidate.action === 'undo') && !allUndo) {
    throw confirmationError('CONFIRMATION_003', '撤销不能与其他动作混合提交', 409);
  }
  const targets = candidates
    .map((candidate) => candidate.target_object_id)
    .filter((id): id is string => Boolean(id));
  if (new Set(targets).size !== targets.length) {
    throw confirmationError('CONFIRMATION_003', '同一提交不能多次修改同一对象', 409);
  }
}

function validateModifiedPayload(
  item: ParsedPayload['items'][number],
  candidate: CandidateRow,
) {
  if (item.decision === 'modify_confirm') {
    if (!item.modified_payload || Array.isArray(item.modified_payload)) {
      throw confirmationError('VALIDATION_002', '修改确认缺少 modified_payload', 422);
    }
    const rejected = Object.keys(item.modified_payload).filter(
      (field) => !candidate.editable_fields.includes(field),
    );
    if (rejected.length > 0) {
      throw confirmationError('VALIDATION_002', '修改包含候选 Schema 未声明字段', 422, {
        candidate_id: candidate.id,
        rejected_fields: rejected,
      });
    }
  } else if (item.modified_payload !== undefined) {
    throw confirmationError('VALIDATION_002', '仅 modify_confirm 可提交 modified_payload', 422);
  }
}

export function validateObjectVersions(
  payload: ParsedPayload,
  candidates: CandidateRow[],
  objects: BusinessRow[],
): void {
  const objectMap = new Map(objects.map((object) => [object.id, object]));
  for (const candidate of candidates) {
    const item = itemFor(payload, candidate.id);
    if (item.decision === 'cancel' || candidate.action === 'create') continue;
    const object = objectMap.get(candidate.target_object_id!);
    if (!object) throw confirmationError('DEPS_002', '目标正式对象不存在', 409);
    const expected = item.expected_target_version;
    if (
      !expected ||
      String(candidate.expected_version) !== String(expected) ||
      String(object.version) !== String(expected)
    ) {
      throw confirmationError('VERSION_001', '正式对象版本冲突', 409, {
        object_id: object.id,
        expected_version: expected,
        current_version: object.version,
      });
    }
  }
}

export function undoActionId(candidates: CandidateRow[]): string {
  const ids = new Set(
    candidates.map((candidate) =>
      String(candidate.payload.original_confirmation_action_id ?? ''),
    ),
  );
  if (ids.size !== 1 || ![...ids][0]) {
    throw confirmationError('VALIDATION_002', '撤销候选缺少统一的原确认操作', 422);
  }
  return requiredUuid([...ids][0], 'original_confirmation_action_id');
}

export function isExpired(expiresAt: Date | string, now: Date | string): boolean {
  return new Date(expiresAt).getTime() <= new Date(now).getTime();
}
