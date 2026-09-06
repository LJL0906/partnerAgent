import {
  isChatItem,
  isSessionToolView,
  SESSION_TOOL_STATUS_TO_CHAT_ITEM_STATUS,
  type ChatItem,
  type SessionToolView,
} from './chat-items.js';
import {
  SESSION_MESSAGE_STATUSES,
  isOperationId,
  sessionMessageStatusToChatItemStatus,
  TASK_STATES,
  type SessionMessageStatus,
  type TaskState,
} from './chat-item-identity.js';
import type {
  ActionExecutionStatus,
  ActionPlanStatus,
  ActionTimelinessStatus,
  BusinessObjectAction,
  BusinessObjectKind,
  CandidateStatus,
  ErrorCode,
  ResourceRef,
} from './local-core.js';
import type { AnalysisRunResult } from './local-core-analysis.js';
import type {
  PrivacyDecisionStatus,
  ReasoningLevel,
  ResolvedModelSelection,
} from './local-core-model.js';

export { TASK_STATES } from './chat-item-identity.js';
export type { TaskState } from './chat-item-identity.js';
export { SESSION_MESSAGE_STATUSES } from './chat-item-identity.js';
export type { SessionMessageStatus } from './chat-item-identity.js';

/** 统一查询分页 / 游标 / 排序 / 过滤。 */
export interface QueryParams {
  /** 游标（分页）。 */
  cursor?: string;
  limit?: number;
  sort?: { field: string; order: 'asc' | 'desc' };
  filter?: Record<string, unknown>;
}

export interface PaginatedResult<T> {
  items: T[];
  next_cursor?: string;
  total?: number;
}

// 会话与输入
export interface GetChatSessionQuery {
  session_id: string;
}
export interface ChatSessionTaskRef {
  task_id: string;
  operation_id: string;
  state: TaskState;
}
export interface ListChatSessionsQuery {}
export interface ChatSessionListItem {
  id: string;
  title?: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_preview?: string;
  /** 最早未结束任务，优先恢复该任务。 */
  active_task?: ChatSessionTaskRef;
  latest_task?: ChatSessionTaskRef;
}
export interface ListChatSessionsResult {
  items: ChatSessionListItem[];
}
export interface ChatSessionSummary extends ChatSessionListItem {
  /** 完整可恢复展示快照；空数组也是权威结果。 */
  items: ChatItem[];
  id: string;
  title?: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_preview?: string;
  /** REST 恢复所需的已持久化消息，按 created_at 升序返回。 */
  messages: SessionMessageDto[];
  /** 工具权威状态的安全投影，不得由 message metadata 代替。 */
  tool_views: SessionToolView[];
}

const isChatSessionTaskRef = (value: unknown): value is ChatSessionTaskRef =>
  isRecord(value)
  && hasText(value.task_id)
  && isOperationId(value.operation_id)
  && (TASK_STATES as readonly unknown[]).includes(value.state);

export function isChatSessionSummary(value: unknown): value is ChatSessionSummary {
  if (!isRecord(value)
    || !Object.keys(value).every((key) => [
      'id', 'title', 'created_at', 'updated_at', 'message_count',
      'last_message_preview', 'active_task', 'latest_task', 'items',
      'messages', 'tool_views',
    ].includes(key))
    || !hasText(value.id)
    || (value.title !== undefined && typeof value.title !== 'string')
    || typeof value.created_at !== 'string'
    || !Number.isFinite(Date.parse(value.created_at))
    || typeof value.updated_at !== 'string'
    || !Number.isFinite(Date.parse(value.updated_at))
    || typeof value.message_count !== 'number'
    || !Number.isSafeInteger(value.message_count)
    || value.message_count < 0
    || (value.last_message_preview !== undefined && typeof value.last_message_preview !== 'string')
    || (value.active_task !== undefined && !isChatSessionTaskRef(value.active_task))
    || (value.latest_task !== undefined && !isChatSessionTaskRef(value.latest_task))
    || !Array.isArray(value.items)
    || !value.items.every(isChatItem)
    || !Array.isArray(value.messages)
    || !value.messages.every(isSessionMessageDto)
    || value.message_count < value.messages.length
    || !Array.isArray(value.tool_views)
    || !value.tool_views.every(isSessionToolView)) return false;

  const sessionId = value.id;
  const messages = value.messages as SessionMessageDto[];
  const items = value.items as ChatItem[];
  const toolViews = value.tool_views as SessionToolView[];
  if (!messages.every((message) => message.session_id === sessionId)
    || !items.every((item) => item.session_id === sessionId)
    || !toolViews.every((tool) => tool.session_id === sessionId)
    || new Set(messages.map((message) => message.id)).size !== messages.length
    || new Set(messages.map((message) => message.sequence)).size !== messages.length
    || messages.some((message, index) => index > 0 && message.sequence <= messages[index - 1].sequence)
    || new Set(items.map((item) => item.id)).size !== items.length
    || new Set(toolViews.map((tool) => tool.tool_call_id)).size !== toolViews.length
    || new Set(toolViews.flatMap((tool) => tool.confirmation_id ? [tool.confirmation_id] : [])).size
      !== toolViews.filter((tool) => tool.confirmation_id !== undefined).length
    || new Set(toolViews.flatMap((tool) => tool.execution_id ? [tool.execution_id] : [])).size
      !== toolViews.filter((tool) => tool.execution_id !== undefined).length) return false;

  const itemsValid = items.every((item) => {
    if (item.type === 'message') {
      const message = messages.find((candidate) => candidate.id === item.message_id);
      return message !== undefined
        && message.revision === item.revision
        && message.sequence === item.sequence
        && item.status === sessionMessageStatusToChatItemStatus(message.status)
        && message.role === item.payload.role
        && message.content === item.payload.content
        && message.task_id === item.task_id
        && message.operation_id === item.operation_id
        && message.model_config_id === item.payload.model_config_id
        && message.reasoning_level === item.payload.reasoning_level;
    }
    if (item.type === 'tool' || item.type === 'approval') {
      if (item.tool_call_id === undefined) return false;
      const tool = toolViews.find((candidate) => candidate.tool_call_id === item.tool_call_id);
      if (tool === undefined) return false;
      const baseMatches = item.status === SESSION_TOOL_STATUS_TO_CHAT_ITEM_STATUS[tool.status]
        && tool.task_id === item.task_id
        && tool.operation_id === item.operation_id
        && tool.execution_id === item.execution_id
        && item.payload.tool === tool.tool_name;
      if (!baseMatches) return false;
      if (item.type === 'tool') {
        return item.id === `tool:${tool.tool_call_id}`
          && (item.payload.risk_level === undefined || item.payload.risk_level === tool.risk_level)
          && (item.payload.input_summary === undefined || item.payload.input_summary === tool.request_summary)
          && (item.payload.output_summary === undefined || item.payload.output_summary === tool.result_summary);
      }
      return item.id === `approval:${tool.confirmation_id}`
        && tool.confirmation_id === item.approval_id
        && item.payload.approval_id === item.approval_id
        && item.payload.risk_level === tool.risk_level
        && item.payload.request_summary === tool.request_summary;
    }
    return true;
  });
  if (!itemsValid) return false;
  return messages.every((message) => {
    const expectedItemId = message.role === 'assistant' && message.task_id
      ? `task:${message.task_id}:assistant`
      : `message:${message.id}`;
    return items.some((item) => item.type === 'message'
      && item.id === expectedItemId
      && item.message_id === message.id);
  });
}

export function parseChatSessionSummary(value: unknown): ChatSessionSummary {
  if (!isChatSessionSummary(value)) throw new TypeError('Invalid ChatSessionSummary');
  return value;
}

export interface SessionMessageDto {
  id: string;
  session_id: string;
  sequence: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: SessionMessageStatus;
  revision: number;
  task_id?: string;
  operation_id?: string;
  model_config_id?: string;
  reasoning_level?: ReasoningLevel;
  thinking_summary?: string;
  created_at: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const SESSION_MESSAGE_FIELDS = [
  'id', 'session_id', 'sequence', 'role', 'content', 'status', 'revision',
  'task_id', 'operation_id', 'model_config_id', 'reasoning_level', 'thinking_summary', 'created_at',
] as const;

export function isSessionMessageDto(value: unknown): value is SessionMessageDto {
  return isRecord(value)
    && Object.keys(value).every((key) => (SESSION_MESSAGE_FIELDS as readonly string[]).includes(key))
    && hasText(value.id)
    && hasText(value.session_id)
    && isPositiveInteger(value.sequence)
    && (value.role === 'user' || value.role === 'assistant' || value.role === 'system')
    && typeof value.content === 'string'
    && (SESSION_MESSAGE_STATUSES as readonly unknown[]).includes(value.status)
    && isPositiveInteger(value.revision)
    && (value.task_id === undefined || hasText(value.task_id))
    && (value.operation_id === undefined || isOperationId(value.operation_id))
    && (value.model_config_id === undefined || hasText(value.model_config_id))
    && (value.reasoning_level === undefined
      || ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value.reasoning_level as string))
    && (value.thinking_summary === undefined || typeof value.thinking_summary === 'string')
    && typeof value.created_at === 'string'
    && Number.isFinite(Date.parse(value.created_at));
}

export function parseSessionMessageDto(value: unknown): SessionMessageDto {
  if (!isSessionMessageDto(value)) throw new TypeError('Invalid SessionMessageDto');
  return value;
}

export interface GetOriginalRecordQuery {
  record_id: string;
}
export interface GetAttachmentStatusQuery {
  attachment_id: string;
}
export interface AttachmentStatus {
  attachment_id: string;
  parse_status: 'pending' | 'success' | 'failed';
  storage_status: 'active' | 'archived' | 'deleted';
  error?: string;
}

// 分析与任务
export interface GetAnalysisRunQuery {
  analysis_run_id: string;
}
export type GetAnalysisRunResult = AnalysisRunResult;
export interface GetTaskStatusQuery {
  task_id: string;
}
export interface TaskStatus {
  task_id: string;
  state: TaskState;
  progress?: number;
  error?: string;
  error_code?: ErrorCode;
  result_ref?: ResourceRef;
  /** 仅 waiting_privacy_decision 状态返回；不得包含命中明文或完整请求。 */
  privacy_decision?: PrivacyDecisionStatus;
  /** 任务已成功受理时的权威模型选择。 */
  resolved_model?: ResolvedModelSelection;
  created_at: string;
  updated_at: string;
}
export interface GetCoreHealthQuery {}
export interface CoreHealth {
  status: 'ok' | 'degraded' | 'down';
  services: Record<string, { ok: boolean; detail?: string }>;
  version: string;
}

// 确认中心
export interface ListPendingConfirmationBatchesQuery {}
export interface PendingConfirmationBatchSummary {
  batch_id: string;
  batch_version: string;
  status: 'pending' | 'partially_processed';
  risk: 'normal' | 'high';
  item_count: number;
  high_risk_count: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
}
export interface GetConfirmationBatchQuery {
  batch_id: string;
}
export interface GetConfirmationBatchResult {
  batch_ref: ResourceRef & { kind: 'confirmation_batch' };
  batch_version: string;
  status: 'pending' | 'partially_processed' | 'confirmed' | 'cancelled' | 'expired';
  risk: 'normal' | 'high';
  item_count: number;
  high_risk_count: number;
  source_refs: ResourceRef[];
  candidates: CandidateDetail[];
  expires_at: string;
  created_at: string;
  updated_at: string;
}
export interface GetCandidateDetailQuery {
  candidate_id: string;
}
export interface CandidateDetail {
  candidate_ref: ResourceRef & { kind: 'candidate' };
  batch_ref: ResourceRef & { kind: 'confirmation_batch' };
  candidate_version: string;
  kind: BusinessObjectKind;
  action: BusinessObjectAction;
  content: Record<string, unknown>;
  source_refs: ResourceRef[];
  confidence: number;
  risk: 'normal' | 'high';
  sensitive_marks: string[];
  status: CandidateStatus;
  editable_fields: string[];
  target_object_ref?: ResourceRef;
  expected_target_version?: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}
export type GetCandidateDetailResult = CandidateDetail;
export interface GetConfirmationHistoryQuery { cursor?: string; }
export interface ConfirmationHistoryItem {
  confirmation_action_id: string;
  batch_ref: ResourceRef & { kind: 'confirmation_batch' };
  operation_id: string;
  action_type: 'confirm' | 'confirm_after_edit' | 'cancel' | 'undo';
  client_source: 'ios' | 'android' | 'web' | 'other';
  object_refs: ResourceRef[];
  reverses_confirmation_action_id?: string;
  created_at: string;
}
export type GetConfirmationHistoryResult = PaginatedResult<ConfirmationHistoryItem>;
export interface GetUndoEligibilityQuery {
  object_kind: BusinessObjectKind;
  object_id: string;
}

export const UNDO_BLOCKING_REASON_CODES = [
  'not_reversible',
  'version_conflict',
  'incompatible_follow_up',
  'permanent_delete',
  'original_action_not_found',
] as const;
export type UndoBlockingReasonCode =
  (typeof UNDO_BLOCKING_REASON_CODES)[number];

export interface UndoBlockingReason {
  code: UndoBlockingReasonCode;
  message: string;
  object_ref?: ResourceRef;
}

export interface UndoScope {
  /** 撤销沿用原确认批次边界，禁止只撤销批次中的单个对象。 */
  original_confirmation_batch_id: string;
  whole_batch_required: true;
  object_refs: ResourceRef[];
  /** 生成撤销候选时必须原样提交，服务端仍会重新读取并校验。 */
  observed_versions: Record<string, string>;
}

/** 正式业务撤销资格；eligible=true 后仍须经新的 SubmitConfirmationBatch 生效。 */
export interface GetUndoEligibilityResult {
  object_ref: ResourceRef;
  eligible: boolean;
  original_confirmation_action_id: string;
  original_confirmation_batch_id: string;
  reversible: boolean;
  version_conflict: boolean;
  incompatible_follow_up: boolean;
  undo_scope: UndoScope;
  blocking_reasons: UndoBlockingReason[];
  requires_confirmation_batch: true;
}

// 正式对象
export interface ListGoalsQuery extends QueryParams {
  status?: string;
}
export interface GetGoalQuery {
  goal_id: string;
}
export interface ListActionsQuery extends QueryParams {
  goal_id?: string;
  status?: string;
  temporal?: string;
}
export interface GetActionQuery {
  action_id: string;
}
export type BusinessObjectLifecycleStatus =
  | 'active'
  | 'archived'
  | 'soft_deleted'
  | 'purged';
export interface ActionSummary {
  action_ref: ResourceRef & { kind: 'action' };
  version: string;
  lifecycle_status: BusinessObjectLifecycleStatus;
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  timezone?: string;
  execution_status: ActionExecutionStatus;
  plan_status: ActionPlanStatus;
  timeliness_status: ActionTimelinessStatus;
  deadline_at?: string;
  planned_at?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}
export type ListActionsResult = PaginatedResult<ActionSummary>;
export interface GetActionResult extends ActionSummary {
  source_refs: ResourceRef[];
  last_confirmation_batch_ref: ResourceRef & { kind: 'confirmation_batch' };
}
export interface ListFactsQuery extends QueryParams {}
export interface GetFactQuery {
  fact_id: string;
}
export interface ListMemoriesQuery extends QueryParams {
  sensitive_only?: boolean;
}
export interface GetMemoryQuery {
  memory_id: string;
}
export interface ListDecisionsQuery extends QueryParams {}
export interface GetDecisionQuery {
  decision_id: string;
}
export interface GetContextSnapshotQuery {}
export interface GetChangeHistoryQuery {
  object_kind: BusinessObjectKind;
  object_id: string;
}
export interface ChangeHistoryItem {
  change_id: string;
  object_version: string;
  change_type: BusinessObjectAction;
  confirmation_action_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}
export interface GetChangeHistoryResult extends PaginatedResult<ChangeHistoryItem> {
  object_ref: ResourceRef;
}

export {
  parseGetActionResult,
  parseGetCandidateDetailResult,
  parseGetChangeHistoryResult,
  parseGetConfirmationBatchResult,
  parseGetConfirmationHistoryResult,
  parseGetUndoEligibilityResult,
  parseListActionsResult,
} from './local-core-action-results.js';

// RAG 与依据
export interface SearchRelevantContextQuery {
  query: string;
  /** 限制返回类型。 */
  types?: Array<'goal' | 'action' | 'memory' | 'record' | 'situation' | 'result'>;
  /** 是否排除过期记忆（默认 true）。 */
  exclude_expired_memories?: boolean;
  limit?: number;
}
export interface RelevantContextItem {
  ref: ResourceRef;
  relevance: number;
  snippet: string;
  status: string;
  confidence: number;
  sensitive_marks: string[];
}
export interface SearchRelevantContextResult {
  items: RelevantContextItem[];
  /** 明确告知没有找到相关记录。 */
  empty: boolean;
  /** 推测标记。 */
  speculative?: boolean;
}
export interface GetSuggestionEvidenceQuery {
  suggestion_id: string;
}
export interface GetIndexHealthQuery {}
export interface GetIndexRebuildStatusQuery {}

// 摘要、提醒与复盘
export interface GetDailySummaryQuery {
  business_day?: string;
}
export interface GetWeeklyReviewQuery {
  business_week?: string;
}
export interface ListRemindersQuery extends QueryParams {}
export interface GetReminderInstanceQuery {
  reminder_instance_id: string;
}
export interface ListPendingReminderCandidatesQuery {}

// 模型、隐私与导出
export interface ListModelConfigsQuery {}
export interface GetModelRuntimeStatusQuery {}
export interface GetPrivacyPolicyStatusQuery {}
export interface GetExportPreviewQuery {
  export_task_id?: string;
  preview_token?: string;
}
export interface GetExportTaskQuery {
  export_task_id: string;
}
