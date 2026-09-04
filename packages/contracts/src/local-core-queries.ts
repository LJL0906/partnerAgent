import type {
  BusinessObjectKind,
  CandidateStatus,
  ResourceRef,
} from './local-core.js';
import type { AnalysisRunResult } from './local-core-analysis.js';
import type { PrivacyDecisionStatus } from './local-core-model.js';

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
export interface ChatSessionSummary {
  id: string;
  title?: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_preview?: string;
  /** REST 恢复所需的已持久化消息，按 created_at 升序返回。 */
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
  }>;
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
  state:
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'waiting_privacy_decision';
  progress?: number;
  error?: string;
  result_ref?: ResourceRef;
  /** 仅 waiting_privacy_decision 状态返回；不得包含命中明文或完整请求。 */
  privacy_decision?: PrivacyDecisionStatus;
}
export interface GetCoreHealthQuery {}
export interface CoreHealth {
  status: 'ok' | 'degraded' | 'down';
  services: Record<string, { ok: boolean; detail?: string }>;
  version: string;
}

// 确认中心
export interface ListPendingConfirmationBatchesQuery {
  user_id?: string;
}
export interface PendingConfirmationBatchSummary {
  batch_id: string;
  item_count: number;
  high_risk_count: number;
  created_at: string;
}
export interface GetConfirmationBatchQuery {
  batch_id: string;
}
export interface GetCandidateDetailQuery {
  candidate_id: string;
}
export interface CandidateDetail {
  candidate_id: string;
  kind: BusinessObjectKind;
  content: Record<string, unknown>;
  source_refs: ResourceRef[];
  confidence: number;
  risk: 'normal' | 'high';
  sensitive_marks: string[];
  status: CandidateStatus;
}
export interface GetConfirmationHistoryQuery {
  user_id?: string;
  cursor?: string;
}
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
export interface GetContextSnapshotQuery {
  user_id?: string;
}
export interface GetChangeHistoryQuery {
  object_kind: BusinessObjectKind;
  object_id: string;
}

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
