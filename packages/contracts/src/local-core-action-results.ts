import type { ResourceRef } from './local-core.js';
import { isOperationId } from './chat-item-identity.js';
import type {
  ActionSummary,
  CandidateDetail,
  ChangeHistoryItem,
  ConfirmationHistoryItem,
  GetActionResult,
  GetChangeHistoryResult,
  GetConfirmationBatchResult,
  GetConfirmationHistoryResult,
  GetUndoEligibilityResult,
  ListActionsResult,
  UndoBlockingReason,
} from './local-core-queries.js';

const RESOURCE_KINDS = [
  'session', 'chat_message', 'original_record', 'attachment', 'analysis_run',
  'analysis_result', 'candidate', 'confirmation_batch', 'goal', 'action',
  'fact', 'memory', 'decision', 'situation', 'reminder_plan',
  'reminder_instance', 'suggestion', 'export_task',
] as const;
const BUSINESS_RESOURCE_KINDS = [
  'goal', 'action', 'fact', 'memory', 'decision', 'situation', 'reminder_plan',
] as const;
const BATCH_STATUSES = [
  'pending', 'partially_processed', 'confirmed', 'cancelled', 'expired',
] as const;
const ACTION_TYPES = ['confirm', 'confirm_after_edit', 'cancel', 'undo'] as const;
const CLIENT_SOURCES = ['ios', 'android', 'web', 'other'] as const;
const BUSINESS_OBJECT_ACTIONS = [
  'create', 'update', 'status_change', 'archive', 'soft_delete',
  'permanent_delete', 'restore', 'undo',
] as const;
const CANDIDATE_STATUSES = [
  'pending', 'confirmed', 'confirmed_after_edit', 'cancelled', 'expired',
] as const;
const ACTION_EXECUTION_STATUSES = [
  'todo', 'in_progress', 'paused', 'done', 'cancelled',
] as const;
const ACTION_PLAN_STATUSES = ['normal', 'rescheduled'] as const;
const ACTION_TIMELINESS_STATUSES = [
  'no_deadline', 'not_due', 'overdue', 'not_applicable',
] as const;
const LIFECYCLE_STATUSES = ['active', 'archived', 'soft_deleted', 'purged'] as const;
const UNDO_REASON_CODES = [
  'not_reversible', 'version_conflict', 'incompatible_follow_up',
  'permanent_delete', 'original_action_not_found',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(value).every((field) => fields.includes(field));
const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const isVersion = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d*$/.test(value);
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const isConfidence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const isUniqueTextArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(hasText) && new Set(value).size === value.length;

function isResourceRef(value: unknown, kinds = RESOURCE_KINDS as readonly string[]): value is ResourceRef {
  return isRecord(value)
    && exact(value, ['kind', 'id'])
    && kinds.includes(value.kind as string)
    && hasText(value.id);
}

const isResourceRefs = (value: unknown, kinds?: readonly string[]): value is ResourceRef[] =>
  Array.isArray(value)
  && value.every((item) => isResourceRef(item, kinds))
  && new Set(value.map((item) => `${item.kind}:${item.id}`)).size === value.length;

function isCandidateDetail(value: unknown): value is CandidateDetail {
  if (!isRecord(value) || !exact(value, [
    'candidate_ref', 'batch_ref', 'candidate_version', 'kind', 'action', 'content',
    'source_refs', 'confidence', 'risk', 'sensitive_marks', 'status', 'editable_fields',
    'target_object_ref', 'expected_target_version', 'expires_at', 'created_at', 'updated_at',
  ])) return false;
  const isCreate = value.action === 'create';
  return isResourceRef(value.candidate_ref, ['candidate'])
    && isResourceRef(value.batch_ref, ['confirmation_batch'])
    && isVersion(value.candidate_version)
    && ['goal', 'action', 'fact', 'memory', 'decision', 'situation', 'reminder'].includes(value.kind as string)
    && (BUSINESS_OBJECT_ACTIONS as readonly unknown[]).includes(value.action)
    && isRecord(value.content)
    && isResourceRefs(value.source_refs)
    && isConfidence(value.confidence)
    && (value.risk === 'normal' || value.risk === 'high')
    && isUniqueTextArray(value.sensitive_marks)
    && (CANDIDATE_STATUSES as readonly unknown[]).includes(value.status)
    && isUniqueTextArray(value.editable_fields)
    && (value.target_object_ref === undefined
      ? isCreate
      : isResourceRef(value.target_object_ref, BUSINESS_RESOURCE_KINDS))
    && (value.expected_target_version === undefined
      ? isCreate
      : isVersion(value.expected_target_version))
    && isDate(value.expires_at)
    && isDate(value.created_at)
    && isDate(value.updated_at);
}

export function parseGetCandidateDetailResult(value: unknown): CandidateDetail {
  if (!isCandidateDetail(value)) throw new TypeError('Invalid GetCandidateDetailResult');
  return value;
}

export function parseGetConfirmationBatchResult(value: unknown): GetConfirmationBatchResult {
  if (!isRecord(value) || !exact(value, [
    'batch_ref', 'batch_version', 'status', 'risk', 'item_count', 'high_risk_count',
    'source_refs', 'candidates', 'expires_at', 'created_at', 'updated_at',
  ])
    || !isResourceRef(value.batch_ref, ['confirmation_batch'])
    || !isVersion(value.batch_version)
    || !(BATCH_STATUSES as readonly unknown[]).includes(value.status)
    || (value.risk !== 'normal' && value.risk !== 'high')
    || !isCount(value.item_count)
    || !isCount(value.high_risk_count)
    || Number(value.high_risk_count) > Number(value.item_count)
    || !isResourceRefs(value.source_refs)
    || !Array.isArray(value.candidates)
    || !value.candidates.every(isCandidateDetail)
    || value.item_count !== value.candidates.length
    || value.candidates.some((item) => item.batch_ref.id !== (value.batch_ref as ResourceRef).id)
    || value.high_risk_count !== value.candidates.filter((item) => item.risk === 'high').length
    || !isDate(value.expires_at) || !isDate(value.created_at) || !isDate(value.updated_at)) {
    throw new TypeError('Invalid GetConfirmationBatchResult');
  }
  return value as unknown as GetConfirmationBatchResult;
}

function isConfirmationHistoryItem(value: unknown): value is ConfirmationHistoryItem {
  return isRecord(value)
    && exact(value, [
      'confirmation_action_id', 'batch_ref', 'operation_id', 'action_type',
      'client_source', 'object_refs', 'reverses_confirmation_action_id', 'created_at',
    ])
    && hasText(value.confirmation_action_id)
    && isResourceRef(value.batch_ref, ['confirmation_batch'])
    && isOperationId(value.operation_id)
    && (ACTION_TYPES as readonly unknown[]).includes(value.action_type)
    && (CLIENT_SOURCES as readonly unknown[]).includes(value.client_source)
    && isResourceRefs(value.object_refs, BUSINESS_RESOURCE_KINDS)
    && (value.reverses_confirmation_action_id === undefined
      || hasText(value.reverses_confirmation_action_id))
    && (value.action_type === 'undo') === (value.reverses_confirmation_action_id !== undefined)
    && isDate(value.created_at);
}

function isPage(value: unknown, itemGuard: (item: unknown) => boolean): boolean {
  return isRecord(value)
    && exact(value, ['items', 'next_cursor', 'total'])
    && Array.isArray(value.items)
    && value.items.every(itemGuard)
    && (value.next_cursor === undefined || hasText(value.next_cursor))
    && (value.total === undefined || isCount(value.total))
    && (value.total === undefined || value.total >= value.items.length);
}

export function parseGetConfirmationHistoryResult(value: unknown): GetConfirmationHistoryResult {
  if (!isPage(value, isConfirmationHistoryItem)) {
    throw new TypeError('Invalid GetConfirmationHistoryResult');
  }
  return value as GetConfirmationHistoryResult;
}

function isActionSummary(value: unknown): value is ActionSummary {
  return isRecord(value)
    && exact(value, [
      'action_ref', 'version', 'lifecycle_status', 'title', 'description',
      'priority', 'timezone',
      'execution_status', 'plan_status', 'timeliness_status', 'deadline_at',
      'planned_at', 'started_at', 'completed_at', 'created_at', 'updated_at',
    ])
    && isResourceRef(value.action_ref, ['action'])
    && isVersion(value.version)
    && (LIFECYCLE_STATUSES as readonly unknown[]).includes(value.lifecycle_status)
    && hasText(value.title)
    && (value.description === undefined || typeof value.description === 'string')
    && (value.priority === undefined || ['low', 'medium', 'high'].includes(value.priority as string))
    && (value.timezone === undefined || hasText(value.timezone))
    && (ACTION_EXECUTION_STATUSES as readonly unknown[]).includes(value.execution_status)
    && (ACTION_PLAN_STATUSES as readonly unknown[]).includes(value.plan_status)
    && (ACTION_TIMELINESS_STATUSES as readonly unknown[]).includes(value.timeliness_status)
    && ['deadline_at', 'planned_at', 'started_at', 'completed_at']
      .every((field) => value[field] === undefined || isDate(value[field]))
    && isDate(value.created_at)
    && isDate(value.updated_at);
}

export function parseListActionsResult(value: unknown): ListActionsResult {
  if (!isPage(value, isActionSummary)) throw new TypeError('Invalid ListActionsResult');
  return value as ListActionsResult;
}

export function parseGetActionResult(value: unknown): GetActionResult {
  if (!isRecord(value) || !exact(value, [
    'action_ref', 'version', 'lifecycle_status', 'title', 'description',
    'priority', 'timezone',
    'execution_status', 'plan_status', 'timeliness_status', 'deadline_at',
    'planned_at', 'started_at', 'completed_at', 'created_at', 'updated_at',
    'source_refs', 'last_confirmation_batch_ref',
  ])) throw new TypeError('Invalid GetActionResult');
  const { source_refs: _sourceRefs, last_confirmation_batch_ref: _batch, ...summary } = value;
  if (!isActionSummary(summary)
    || !isResourceRefs(value.source_refs)
    || !isResourceRef(value.last_confirmation_batch_ref, ['confirmation_batch'])) {
    throw new TypeError('Invalid GetActionResult');
  }
  return value as unknown as GetActionResult;
}

function isChangeHistoryItem(value: unknown): value is ChangeHistoryItem {
  return isRecord(value)
    && exact(value, [
      'change_id', 'object_version', 'change_type', 'confirmation_action_id',
      'before', 'after', 'created_at',
    ])
    && hasText(value.change_id)
    && isVersion(value.object_version)
    && (BUSINESS_OBJECT_ACTIONS as readonly unknown[]).includes(value.change_type)
    && hasText(value.confirmation_action_id)
    && (value.before === null || isRecord(value.before))
    && (value.after === null || isRecord(value.after))
    && !(value.before === null && value.after === null)
    && isDate(value.created_at);
}

export function parseGetChangeHistoryResult(value: unknown): GetChangeHistoryResult {
  if (!isRecord(value) || !exact(value, ['object_ref', 'items', 'next_cursor', 'total'])
    || !isResourceRef(value.object_ref, BUSINESS_RESOURCE_KINDS)
    || !isPage({ items: value.items, next_cursor: value.next_cursor, total: value.total }, isChangeHistoryItem)) {
    throw new TypeError('Invalid GetChangeHistoryResult');
  }
  return value as unknown as GetChangeHistoryResult;
}

function isUndoReason(value: unknown): value is UndoBlockingReason {
  return isRecord(value)
    && exact(value, ['code', 'message', 'object_ref'])
    && (UNDO_REASON_CODES as readonly unknown[]).includes(value.code)
    && hasText(value.message)
    && (value.object_ref === undefined || isResourceRef(value.object_ref, BUSINESS_RESOURCE_KINDS));
}

export function parseGetUndoEligibilityResult(value: unknown): GetUndoEligibilityResult {
  if (!isRecord(value) || !exact(value, [
    'object_ref', 'eligible', 'original_confirmation_action_id',
    'original_confirmation_batch_id', 'reversible', 'version_conflict',
    'incompatible_follow_up', 'undo_scope', 'blocking_reasons',
    'requires_confirmation_batch',
  ])
    || !isResourceRef(value.object_ref, BUSINESS_RESOURCE_KINDS)
    || typeof value.eligible !== 'boolean'
    || !hasText(value.original_confirmation_action_id)
    || !hasText(value.original_confirmation_batch_id)
    || typeof value.reversible !== 'boolean'
    || typeof value.version_conflict !== 'boolean'
    || typeof value.incompatible_follow_up !== 'boolean'
    || !isRecord(value.undo_scope)
    || !exact(value.undo_scope, [
      'original_confirmation_batch_id', 'whole_batch_required', 'object_refs', 'observed_versions',
    ])
    || value.undo_scope.original_confirmation_batch_id !== value.original_confirmation_batch_id
    || value.undo_scope.whole_batch_required !== true
    || !isResourceRefs(value.undo_scope.object_refs, BUSINESS_RESOURCE_KINDS)
    || value.undo_scope.object_refs.length === 0
    || !isRecord(value.undo_scope.observed_versions)
    || !exact(value.undo_scope.observed_versions, value.undo_scope.object_refs.map((ref) => ref.id))
    || !Object.values(value.undo_scope.observed_versions).every(isVersion)
    || !Array.isArray(value.blocking_reasons)
    || !value.blocking_reasons.every(isUndoReason)
    || value.requires_confirmation_batch !== true
    || value.eligible !== (
      value.reversible === true
      && value.version_conflict === false
      && value.incompatible_follow_up === false
      && value.blocking_reasons.length === 0
    )) throw new TypeError('Invalid GetUndoEligibilityResult');
  return value as unknown as GetUndoEligibilityResult;
}
