import type {
  ActionSummary,
  CandidateDetail,
  ChangeHistoryItem,
  CommandResult,
  ConfirmationHistoryItem,
  CreateUndoObjectCandidateCommandResult,
  CreateUndoObjectCandidatePayload,
  GetActionResult,
  GetConfirmationBatchResult,
  GetUndoEligibilityResult,
  ListActionsResult,
  PaginatedResult,
  PendingConfirmationBatchSummary,
  ResourceRef,
  SubmitConfirmationBatchPayload,
  SubmitConfirmationBatchResult,
} from '@partner-agent/contracts';
import {
  parseCreateUndoObjectCandidateCommandResult,
  parseGetActionResult,
  parseGetCandidateDetailResult,
  parseGetChangeHistoryResult,
  parseGetConfirmationBatchResult,
  parseGetConfirmationHistoryResult,
  parseGetUndoEligibilityResult,
  parseListActionsResult,
} from '@partner-agent/contracts';

import { createCommandEnvelope } from '../../../api/command-envelope';
import { getJson, postJson, type RequestOptions } from '../../../api/http-client';

export type {
  ActionSummary,
  CandidateDetail,
  ChangeHistoryItem,
  ConfirmationHistoryItem,
  CreateUndoObjectCandidatePayload,
  GetActionResult as ActionDetail,
  GetConfirmationBatchResult as ConfirmationBatchDetail,
  PendingConfirmationBatchSummary,
  ResourceRef,
  GetUndoEligibilityResult as UndoEligibility,
};

export type CursorPage<T> = PaginatedResult<T>;
export interface ActionListQuery {
  cursor?: string;
  goalId?: string;
  status?: string;
  temporal?: string;
}
export interface HistoryQuery { cursor?: string }
export interface MutationOptions extends RequestOptions { operationId: string }

export interface ActionApi {
  listPendingConfirmationBatches: typeof listPendingConfirmationBatches;
  getConfirmationBatch: typeof getConfirmationBatch;
  getCandidateDetail: typeof getCandidateDetail;
  listConfirmationHistory: typeof listConfirmationHistory;
  submitConfirmationBatch: typeof submitConfirmationBatch;
  listActions: typeof listActions;
  getAction: typeof getAction;
  getActionHistory: typeof getActionHistory;
  getUndoEligibility: typeof getUndoEligibility;
  createUndoCandidate: typeof createUndoCandidate;
}

export async function listPendingConfirmationBatches(
  query: HistoryQuery = {}, options: RequestOptions = {},
): Promise<CursorPage<PendingConfirmationBatchSummary>> {
  const value = await getJson<unknown>(withQuery('/api/v1/confirmation-batches', { cursor: query.cursor }), options);
  if (!isPage(value, isPendingBatch)) throw new Error('待确认批次响应格式无效。');
  return value;
}

export async function getConfirmationBatch(
  id: string, options: RequestOptions = {},
): Promise<GetConfirmationBatchResult> {
  const value = await getJson<unknown>(`/api/v1/confirmation-batches/${encodeURIComponent(id)}`, options);
  return parseShared(value, parseGetConfirmationBatchResult, '确认批次响应格式无效。');
}

export async function getCandidateDetail(id: string, options: RequestOptions = {}): Promise<CandidateDetail> {
  const value = await getJson<unknown>(`/api/v1/candidates/${encodeURIComponent(id)}`, options);
  return parseShared(value, parseGetCandidateDetailResult, '候选详情响应格式无效。');
}

export async function listConfirmationHistory(
  query: HistoryQuery = {}, options: RequestOptions = {},
): Promise<CursorPage<ConfirmationHistoryItem>> {
  const value = await getJson<unknown>(withQuery('/api/v1/confirmation-history', { cursor: query.cursor }), options);
  return parseShared(value, parseGetConfirmationHistoryResult, '确认历史响应格式无效。');
}

export async function submitConfirmationBatch(
  payload: SubmitConfirmationBatchPayload, options: MutationOptions,
): Promise<CommandResult<SubmitConfirmationBatchResult>> {
  const envelope = await createCommandEnvelope(payload, { operationId: options.operationId });
  const value = await postJson<typeof envelope, unknown>('/api/v1/confirmation-batches/submit', envelope, { signal: options.signal });
  if (!isConfirmationCommand(value, options.operationId)) throw new Error('确认提交响应格式无效。');
  return value;
}

export async function listActions(
  query: ActionListQuery = {}, options: RequestOptions = {},
): Promise<ListActionsResult> {
  const path = withQuery('/api/v1/actions', {
    cursor: query.cursor, goal_id: query.goalId, status: query.status, temporal: query.temporal,
  });
  const value = await getJson<unknown>(path, options);
  return parseShared(value, parseListActionsResult, '行动列表响应格式无效。');
}

export async function getAction(id: string, options: RequestOptions = {}): Promise<GetActionResult> {
  const value = await getJson<unknown>(`/api/v1/actions/${encodeURIComponent(id)}`, options);
  return parseShared(value, parseGetActionResult, '行动详情响应格式无效。');
}

export async function getActionHistory(
  id: string, options: RequestOptions = {},
): Promise<CursorPage<ChangeHistoryItem>> {
  const value = await getJson<unknown>(`/api/v1/objects/action/${encodeURIComponent(id)}/history`, options);
  const result = parseShared(value, parseGetChangeHistoryResult, '行动历史响应格式无效。');
  return { items: result.items, next_cursor: result.next_cursor, total: result.total };
}

export async function getUndoEligibility(
  id: string, options: RequestOptions = {},
): Promise<GetUndoEligibilityResult> {
  const value = await getJson<unknown>(`/api/v1/objects/action/${encodeURIComponent(id)}/undo-eligibility`, options);
  return parseShared(value, parseGetUndoEligibilityResult, '撤销资格响应格式无效。');
}

export async function createUndoCandidate(
  payload: CreateUndoObjectCandidatePayload, options: MutationOptions,
): Promise<CreateUndoObjectCandidateCommandResult> {
  const envelope = await createCommandEnvelope(payload, { operationId: options.operationId });
  const value = await postJson<typeof envelope, unknown>('/api/v1/object-change-candidates/undo', envelope, { signal: options.signal });
  return parseShared(value, (input) => parseCreateUndoObjectCandidateCommandResult(input, options.operationId), '撤销候选响应格式无效。');
}

export const actionApi: ActionApi = {
  listPendingConfirmationBatches, getConfirmationBatch, getCandidateDetail,
  listConfirmationHistory, submitConfirmationBatch, listActions, getAction,
  getActionHistory, getUndoEligibility, createUndoCandidate,
};

type UnknownRecord = Record<string, unknown>;
const PENDING_BATCH_STATUSES = new Set(['pending', 'partially_processed']);
function isRecord(value: unknown): value is UnknownRecord { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function hasText(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function isDate(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function isVersion(value: unknown): value is string { return typeof value === 'string' && /^[1-9]\d*$/.test(value); }
function isCount(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }

function isPendingBatch(value: unknown): value is PendingConfirmationBatchSummary {
  return isRecord(value) && hasOnly(value, ['batch_id', 'batch_version', 'status', 'risk', 'item_count', 'high_risk_count', 'expires_at', 'created_at', 'updated_at'])
    && hasText(value.batch_id) && isVersion(value.batch_version)
    && PENDING_BATCH_STATUSES.has(String(value.status)) && (value.risk === 'normal' || value.risk === 'high')
    && isCount(value.item_count) && isCount(value.high_risk_count) && Number(value.high_risk_count) <= Number(value.item_count)
    && isDate(value.expires_at) && isDate(value.created_at) && isDate(value.updated_at);
}

function isPage<T>(value: unknown, guard: (item: unknown) => item is T): value is CursorPage<T> {
  return isRecord(value) && hasOnly(value, ['items', 'next_cursor', 'total'])
    && Array.isArray(value.items) && value.items.every(guard)
    && (value.next_cursor === undefined || hasText(value.next_cursor))
    && (value.total === undefined || (isCount(value.total) && value.total >= value.items.length));
}

function hasOnly(value: UnknownRecord, fields: string[]): boolean { return Object.keys(value).every((key) => fields.includes(key)); }
function isRef(value: unknown, kind?: ResourceRef['kind']): value is ResourceRef {
  return isRecord(value) && hasOnly(value, ['kind', 'id']) && hasText(value.kind)
    && (kind === undefined || value.kind === kind) && hasText(value.id);
}
function isConfirmationData(value: unknown): value is SubmitConfirmationBatchResult {
  return isRecord(value) && hasOnly(value, ['batch_ref', 'confirmed'])
    && isRef(value.batch_ref, 'confirmation_batch') && Array.isArray(value.confirmed)
    && value.confirmed.every((item) => isRecord(item) && hasOnly(item, ['ref', 'version'])
      && isRef(item.ref, 'action') && isVersion(item.version));
}
function isConfirmationCommand(value: unknown, operationId: string): value is CommandResult<SubmitConfirmationBatchResult> {
  if (!isRecord(value) || !hasOnly(value, ['operation_id', 'status', 'resource_refs', 'new_versions', 'task_refs', 'warnings', 'validation_errors', 'data'])
    || value.operation_id !== operationId
    || !['accepted', 'completed', 'duplicate', 'rejected'].includes(String(value.status))) return false;
  return value.status !== 'completed' && value.status !== 'duplicate' || isConfirmationData(value.data);
}
function parseShared<T>(value: unknown, parser: (value: unknown) => T, message: string): T {
  try { return parser(value); } catch { throw new Error(message); }
}
function withQuery(path: string, entries: Record<string, string | undefined>): string {
  const query = Object.entries(entries)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return query ? `${path}?${query}` : path;
}
