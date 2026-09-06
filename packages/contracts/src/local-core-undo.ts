import { isOperationId } from './chat-item-identity.js';
import type { CommandEnvelope, CommandResult, ResourceRef } from './local-core.js';

export interface CreateUndoObjectCandidatePayload {
  original_confirmation_action_id: string;
  original_confirmation_batch_id: string;
  /** GetUndoEligibility 返回的对象 id → 查询时版本；服务端必须重新校验。 */
  observed_versions: Record<string, string>;
}

export type CreateUndoObjectCandidateCommandRequest =
  CommandEnvelope<CreateUndoObjectCandidatePayload>;

export interface UndoCandidateRef {
  candidate_ref: ResourceRef & { kind: 'candidate' };
  candidate_version: string;
  target_object_ref: ResourceRef;
  expected_target_version: string;
}

export interface CreateUndoObjectCandidateResult {
  confirmation_batch_ref: ResourceRef & { kind: 'confirmation_batch' };
  batch_version: string;
  candidate_refs: UndoCandidateRef[];
}

export type CreateUndoObjectCandidateCommandResult =
  CommandResult<CreateUndoObjectCandidateResult> & {
    status: 'completed' | 'duplicate';
    resource_refs: ResourceRef[];
    new_versions: Record<string, string>;
    data: CreateUndoObjectCandidateResult;
  };

const BUSINESS_RESOURCE_KINDS = [
  'goal', 'action', 'fact', 'memory', 'decision', 'situation', 'reminder_plan',
] as const;
const CLIENT_SOURCES = ['ios', 'android', 'web', 'other'] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const exact = (value: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(value).every((field) => fields.includes(field));
const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);
const isVersion = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d*$/.test(value);

function isRef(value: unknown, kinds: readonly string[]): value is ResourceRef {
  return isRecord(value)
    && Object.keys(value).length === 2
    && exact(value, ['kind', 'id'])
    && kinds.includes(value.kind as string)
    && isUuid(value.id);
}

function isObservedVersions(value: unknown): value is Record<string, string> {
  return isRecord(value)
    && Object.keys(value).length > 0
    && Object.entries(value).every(([id, version]) => isUuid(id) && isVersion(version));
}

export function isCreateUndoObjectCandidateCommandRequest(
  value: unknown,
): value is CreateUndoObjectCandidateCommandRequest {
  if (!isRecord(value)
    || Object.keys(value).length !== 4
    || !exact(value, ['operation_id', 'client_source', 'request_fingerprint', 'payload'])
    || !isOperationId(value.operation_id)
    || !(CLIENT_SOURCES as readonly unknown[]).includes(value.client_source)
    || !hasText(value.request_fingerprint)
    || !isRecord(value.payload)
    || Object.keys(value.payload).length !== 3
    || !exact(value.payload, [
      'original_confirmation_action_id', 'original_confirmation_batch_id', 'observed_versions',
    ])) return false;
  return isUuid(value.payload.original_confirmation_action_id)
    && isUuid(value.payload.original_confirmation_batch_id)
    && isObservedVersions(value.payload.observed_versions);
}

export function parseCreateUndoObjectCandidateCommandRequest(
  value: unknown,
): CreateUndoObjectCandidateCommandRequest {
  if (!isCreateUndoObjectCandidateCommandRequest(value)) {
    throw new TypeError('Invalid CreateUndoObjectCandidateCommandRequest');
  }
  return value;
}

function isUndoCandidateRef(value: unknown): value is UndoCandidateRef {
  return isRecord(value)
    && Object.keys(value).length === 4
    && exact(value, [
      'candidate_ref', 'candidate_version', 'target_object_ref', 'expected_target_version',
    ])
    && isRef(value.candidate_ref, ['candidate'])
    && isVersion(value.candidate_version)
    && isRef(value.target_object_ref, BUSINESS_RESOURCE_KINDS)
    && isVersion(value.expected_target_version);
}

function isUndoResultData(value: unknown): value is CreateUndoObjectCandidateResult {
  return isRecord(value)
    && Object.keys(value).length === 3
    && exact(value, ['confirmation_batch_ref', 'batch_version', 'candidate_refs'])
    && isRef(value.confirmation_batch_ref, ['confirmation_batch'])
    && isVersion(value.batch_version)
    && Array.isArray(value.candidate_refs)
    && value.candidate_refs.length > 0
    && value.candidate_refs.every(isUndoCandidateRef)
    && new Set(value.candidate_refs.map((item) => item.candidate_ref.id)).size
      === value.candidate_refs.length
    && new Set(value.candidate_refs.map((item) => item.target_object_ref.id)).size
      === value.candidate_refs.length;
}

export function isCreateUndoObjectCandidateCommandResult(
  value: unknown,
  expectedOperationId?: string,
): value is CreateUndoObjectCandidateCommandResult {
  if (!isRecord(value)
    || !exact(value, [
      'operation_id', 'status', 'resource_refs', 'new_versions', 'data', 'warnings',
    ])
    || !isOperationId(value.operation_id)
    || (expectedOperationId !== undefined && value.operation_id !== expectedOperationId)
    || (value.status !== 'completed' && value.status !== 'duplicate')
    || !isUndoResultData(value.data)
    || !Array.isArray(value.resource_refs)
    || !value.resource_refs.every((ref) =>
      isRef(ref, ['confirmation_batch', 'candidate']))
    || !isRecord(value.new_versions)
    || !Object.values(value.new_versions).every(isVersion)
    || (value.warnings !== undefined
      && (!Array.isArray(value.warnings) || !value.warnings.every(hasText)))) return false;

  const data = value.data as CreateUndoObjectCandidateResult;
  const expectedRefs = [
    `confirmation_batch:${data.confirmation_batch_ref.id}`,
    ...data.candidate_refs.map((item) => `candidate:${item.candidate_ref.id}`),
  ].sort();
  const actualRefs = (value.resource_refs as ResourceRef[])
    .map((ref) => `${ref.kind}:${ref.id}`)
    .sort();
  const expectedVersions = [
    [data.confirmation_batch_ref.id, data.batch_version],
    ...data.candidate_refs.map((item) => [item.candidate_ref.id, item.candidate_version]),
  ];
  const newVersions = value.new_versions as Record<string, string>;
  return JSON.stringify(actualRefs) === JSON.stringify(expectedRefs)
    && Object.keys(value.new_versions).length === expectedVersions.length
    && expectedVersions.every(([id, version]) => newVersions[id] === version);
}

export function parseCreateUndoObjectCandidateCommandResult(
  value: unknown,
  expectedOperationId?: string,
): CreateUndoObjectCandidateCommandResult {
  if (!isCreateUndoObjectCandidateCommandResult(value, expectedOperationId)) {
    throw new TypeError('Invalid CreateUndoObjectCandidateCommandResult');
  }
  return value;
}
