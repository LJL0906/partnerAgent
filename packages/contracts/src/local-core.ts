/**
 * Local Core Command/Query 契约
 *
 * 依据：v1-详细子需求交叉整合.md 第 8 节（Local Core 逻辑接口）、第 12 节（接口设计入口）
 * 配套：P0决策收口文档.md 第 2、3 节（信封、错误码、状态机基线）
 *
 * 本文件只定义逻辑契约，不锁定传输协议（REST / IPC / 本地 HTTP / WS）。
 * 传输层决策见 P0 决策收口文档 第 1 节。
 *
 * 约定：
 * - 命名遵循需求文档的逻辑接口名（SubmitTextInput / GetChatSession / ...）
 * - operation_id 由客户端生成（UUID），服务端回显，用于幂等去重
 * - 版本冲突、幂等冲突、错误分类见下方错误码表
 */

// ---------------------------------------------------------------------------
// 通用信封（第 2 节 / 8.2 节）
// ---------------------------------------------------------------------------

export interface CommandEnvelope<P = unknown> {
  /** 客户端生成的幂等标识（UUID）。跨重试必须稳定，用于幂等去重。 */
  operation_id: string;
  /** 客户端来源标识：ios / android / web / other。 */
  client_source: 'ios' | 'android' | 'web' | 'other';
  /** 请求哈希，用于检测同一 operation_id 下载荷是否一致。 */
  request_fingerprint: string;
  /** 乐观并发控制：适用于有版本字段的对象。 */
  expected_version?: string;
  /** 具体命令参数。 */
  payload: P;
}

/** 通用命令结果。 */
export type CommandStatus =
  | 'accepted'   // 已受理，任务可能仍在排队
  | 'completed'  // 已同步完成
  | 'duplicate'  // operation_id 撞车，返回原结果
  | 'rejected';  // 被拒绝（校验/授权/确认边界失败）

export interface ResourceRef {
  kind:
    | 'session'
    | 'chat_message'
    | 'original_record'
    | 'attachment'
    | 'analysis_run'
    | 'analysis_result'
    | 'candidate'
    | 'confirmation_batch'
    | 'goal'
    | 'action'
    | 'fact'
    | 'memory'
    | 'decision'
    | 'situation'
    | 'reminder_plan'
    | 'reminder_instance'
    | 'suggestion'
    | 'export_task';
  id: string;
}

export interface TaskRef {
  task_id: string;
  kind:
    | 'chat_response'
    | 'analysis'
    | 'attachment_parse'
    | 'summary'
    | 'weekly_review'
    | 'reminder'
    | 'export'
    | 'index_update';
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
}

export interface CommandResult<R = unknown> {
  operation_id: string;
  status: CommandStatus;
  resource_refs?: ResourceRef[];
  /** 对象 id → 最新版本，用于后续乐观并发控制。 */
  new_versions?: Record<string, string>;
  task_refs?: TaskRef[];
  warnings?: string[];
  validation_errors?: ValidationError[];
  /** 业务载荷（仅 status === 'completed' 时存在）。 */
  data?: R;
}

// ---------------------------------------------------------------------------
// 统一错误码分类（第 2 节 / 第 12 节"错误分类"）
// ---------------------------------------------------------------------------

export const ERRORS = {
  AUTH_001: 'AUTH_001', // 未认证 / 令牌无效
  AUTH_002: 'AUTH_002', // 会话所有权校验失败（用户不符）
  AUTH_003: 'AUTH_003', // 应用访问保护未通过
  VALIDATION_001: 'VALIDATION_001', // 载荷校验失败
  VALIDATION_002: 'VALIDATION_002', // 必填字段缺失
  IDEMPOTENCY_001: 'IDEMPOTENCY_001', // 幂等冲突（operation_id 已用但载荷不同）
  VERSION_001: 'VERSION_001', // 版本冲突（expected != current）
  CONFIRMATION_001: 'CONFIRMATION_001', // 高风险候选需单独确认
  CONFIRMATION_002: 'CONFIRMATION_002', // 候选已过期 / 不可确认
  CONFIRMATION_003: 'CONFIRMATION_003', // 候选与正式对象状态冲突
  RATE_001: 'RATE_001', // 超出每用户会话数 / 限额
  RATE_002: 'RATE_002', // 单会话并发请求冲突
  TASK_001: 'TASK_001', // 任务已取消
  TASK_002: 'TASK_002', // 任务不可重试
  MODEL_001: 'MODEL_001', // 模型未配置
  MODEL_002: 'MODEL_002', // 模型连接失败
  MODEL_003: 'MODEL_003', // 模型切换失败
  MODEL_004: 'MODEL_004', // 当前模型不可用
  EGRESS_001: 'EGRESS_001', // 外发被阻止（拒绝发送）
  EGRESS_002: 'EGRESS_002', // 外发等待隐私决定
  EGRESS_003: 'EGRESS_003', // 外发脱敏后允许（带标记）
  DEPS_001: 'DEPS_001', // 来源不存在 / 已删除
  DEPS_002: 'DEPS_002', // 依赖的正式对象缺失
  NOT_IMPLEMENTED_001: 'NOT_IMPLEMENTED_001', // 路由契约已建立，但业务实现尚未提供
  INTERNAL_000: 'INTERNAL_000', // 未知内部错误
} as const;

export type ErrorCode = (typeof ERRORS)[keyof typeof ERRORS];

export interface ApiError {
  code: ErrorCode;
  message: string;
  /** 版本冲突时携带的当前版本。 */
  current_version?: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 输入命令（第 8.3 节）
// ---------------------------------------------------------------------------

/** 提交文字输入：创建原始记录、消息引用、聊天响应任务，并按需登记分析任务。 */
export interface SubmitTextInputPayload {
  /** 原始文本内容。 */
  text: string;
  /** 目标会话 id（为空则创建新会话）。 */
  session_id?: string;
  /** 是否按需触发结构化分析（默认 false，普通聊天不主动分析）。 */
  request_analysis?: boolean;
  /** 请求的分析类型（仅 request_analysis 为 true 时）。 */
  analysis_types?: Array<
    | 'idea_organize'
    | 'experience_review'
    | 'problem_analysis'
    | 'content_extract'
  >;
  /** 前端输入幂等标识，重复网络重试不重复创建记录。 */
  input_id: string;
}

export interface SubmitTextInputResult {
  /** 如果指定了 session_id，回显之；新会话则返回新会话引用。 */
  session_id: string;
  /** 提交的消息引用。 */
  message_ref: ResourceRef;
  /** 原始记录引用。 */
  original_record?: ResourceRef;
  /** 聊天响应任务引用（流式事件从该频道读）。 */
  chat_task: TaskRef;
  /** 分析任务引用（若 request_analysis 为 true）。 */
  analysis_task?: TaskRef;
}

/** 提交用户确认后的最终转写文本和可选音频关联。必须先完成语音转写确认。 */
export interface SubmitVoiceInputPayload {
  /** 用户已确认的最终转写文本。 */
  transcript: string;
  /** 可选的原音频附件 id（需先确认转写）。 */
  audio_attachment_id?: string;
  session_id?: string;
  input_id: string;
}

/** 保存语音临时草稿（只能写临时数据，不产生正式副作用）。 */
export interface CreateOrUpdateVoiceDraftPayload {
  draft_id: string;
  transcript: string;
  /** 临时音频路径（本地客户端管理）。 */
  temp_audio_ref?: string;
}

/** 取消语音草稿和临时材料。 */
export interface CancelVoiceDraftPayload {
  draft_id: string;
}

/** 提交附件并保存原始内容和关联。解析与保存解耦。 */
export interface SubmitAttachmentInputPayload {
  /** 客户端上传后的附件引用。 */
  attachment_id: string;
  source_type: 'image' | 'audio' | 'file' | 'link';
  /** 网页链接的 URL（source_type 为 link 时）。 */
  link_url?: string;
  session_id?: string;
  input_id: string;
}

/** 取消尚未完成的输入分析。不删除原始记录。 */
export interface CancelAnalysisPayload {
  analysis_run_id: string;
}

/** 取消仍可取消的后台任务；断开 WebSocket 不等于取消任务。 */
export interface CancelTaskPayload {
  task_id: string;
}

/** 重新运行输入分析。产生新运行和新结果版本，不覆盖旧结果或正式对象。 */
export interface RequestReanalysisPayload {
  original_record_id: string;
}

/** 对成功解析的附件执行补充分析。不覆盖原分析。 */
export interface RequestAttachmentSupplementAnalysisPayload {
  attachment_id: string;
}

// ---------------------------------------------------------------------------
// 模型和隐私命令（第 8.4 节）
// ---------------------------------------------------------------------------

export type ProviderId = 'anthropic' | 'openai' | 'deepseek' | 'google' | 'local';

export interface ModelConfig {
  id: string;
  provider: ProviderId;
  base_url?: string;
  /** API Key 仅进入安全存储，绝不进入日志、导出或事件。 */
  api_key_ref?: string;
  model_id: string;
  /** 是否默认模型。 */
  is_default?: boolean;
  /** 排序（决定失败后的尝试顺序）。 */
  sort_order?: number;
  /** 支持的能力（能力发现）。 */
  capabilities?: Array<'chat' | 'vision' | 'embedding' | 'reasoning'>;
}

/** 新增或更新模型配置。API Key 仅进入安全存储。 */
export interface UpsertModelConfigPayload {
  config: ModelConfig;
}

/** 删除或停用模型配置。设置操作，不是业务确认。 */
export interface DeleteModelConfigPayload {
  model_config_id: string;
}

/** 调整模型列表顺序。用户设置操作。 */
export interface ReorderModelConfigsPayload {
  ordered_ids: string[];
}

/** 设置默认模型。用户设置操作。 */
export interface SetDefaultModelPayload {
  model_config_id: string;
}

export type ReasoningLevel = 'low' | 'medium' | 'high';

/** 设置当前消息的模型和推理等级。只影响当前消息。 */
export interface SetMessageModelSelectionPayload {
  message_id: string;
  model_config_id: string;
  reasoning_level: ReasoningLevel;
}

/** 测试地址、凭证、Model ID 和协议能力。不发送个人数据。 */
export interface TestModelConnectionPayload {
  provider: ProviderId;
  base_url?: string;
  api_key_ref?: string;
  model_id: string;
}

export interface TestModelConnectionResult {
  ok: boolean;
  latency_ms?: number;
  /** 能力发现结果。 */
  capabilities?: string[];
  error?: string;
}

/** 启动聊天响应、辅助解答、输入分析、摘要、复盘等模型任务。由 Local Core 组装上下文。 */
export interface StartBusinessModelTaskPayload {
  kind:
    | 'chat_response'
    | 'assistant_answer'
    | 'input_analysis'
    | 'idea_organize'
    | 'summary'
    | 'weekly_review';
  session_id?: string;
  context?: Record<string, unknown>;
}

/** 提交某次外发载荷的隐私决定。不等于业务变更确认。 */
export interface SubmitPrivacyDecisionPayload {
  egress_id: string;
  decision: 'allow' | 'redact' | 'block';
}

/** 记录建议采纳、拒绝或暂不处理。不自动创建行动。 */
export interface RecordSuggestionFeedbackPayload {
  suggestion_id: string;
  feedback: 'accepted' | 'rejected' | 'later';
  reason?: string;
}

// ---------------------------------------------------------------------------
// 正式业务确认命令（第 8.5 节）
// ---------------------------------------------------------------------------

export type BusinessObjectKind =
  | 'goal'
  | 'action'
  | 'fact'
  | 'memory'
  | 'decision'
  | 'situation'
  | 'reminder';

export const BUSINESS_OBJECT_ACTIONS = [
  'create',
  'update',
  'status_change',
  'archive',
  'soft_delete',
  'permanent_delete',
  'restore',
  'undo',
] as const;
export type BusinessObjectAction = (typeof BUSINESS_OBJECT_ACTIONS)[number];

export const CANDIDATE_STATUSES = [
  'pending',
  'confirmed',
  'confirmed_after_edit',
  'cancelled',
  'expired',
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const GOAL_STATUSES = [
  'planning',
  'active',
  'completed',
  'paused',
  'abandoned',
  'expired',
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const ACTION_EXECUTION_STATUSES = [
  'todo',
  'in_progress',
  'paused',
  'done',
  'cancelled',
] as const;
export type ActionExecutionStatus = (typeof ACTION_EXECUTION_STATUSES)[number];

export const ACTION_PLAN_STATUSES = [
  'normal',
  'rescheduled',
] as const;
export type ActionPlanStatus = (typeof ACTION_PLAN_STATUSES)[number];

export const ACTION_TIMELINESS_STATUSES = [
  'no_deadline',
  'not_due',
  'overdue',
  'not_applicable',
] as const;
export type ActionTimelinessStatus = (typeof ACTION_TIMELINESS_STATUSES)[number];

export interface ConfirmationItem {
  candidate_id: string;
  candidate_version: string;
  decision: ConfirmationDecision;
  modified_payload?: Record<string, unknown>;
  target_object_id?: string;
  expected_target_version?: string;
  risk_acknowledged?: boolean;
}

export const CONFIRMATION_DECISIONS = [
  'confirm',
  'modify_confirm',
  'cancel',
] as const;
export type ConfirmationDecision = (typeof CONFIRMATION_DECISIONS)[number];

/** 统一确认入口，负责所有正式对象和业务状态变更。禁止旁路写接口。 */
export interface SubmitConfirmationBatchPayload {
  confirmation_batch_id: string;
  batch_version: string;
  items: ConfirmationItem[];
}

export interface SubmitConfirmationBatchResult {
  batch_ref: ResourceRef;
  /** 已生效的对象引用；任一候选失败时整批回滚，不返回部分成功。 */
  confirmed: Array<{ ref: ResourceRef; version: string }>;
}

// ---------------------------------------------------------------------------
// 提醒命令（第 8.6 节）
// ---------------------------------------------------------------------------

/** 关闭本次提醒。不进入业务确认。 */
export interface CloseReminderInstancePayload {
  reminder_instance_id: string;
}

/** 稍后提醒。不进入业务确认。 */
export interface SnoozeReminderInstancePayload {
  reminder_instance_id: string;
  snooze_until: string; // ISO 8601
}

/** 调整纯提醒计划。视是否涉及业务字段决定是否需确认。 */
export interface UpdateReminderPlanPayload {
  reminder_plan_id: string;
  schedule?: { time?: string; timezone?: string; channel?: string };
}

/** 把完成、延期、搁置、取消点击转换为候选。是（进入确认）。 */
export interface CreateReminderActionCandidatePayload {
  reminder_instance_id: string;
  intent: 'complete' | 'postpone' | 'shelve' | 'cancel';
}

/** 保存投递结果。否（不进入确认）。 */
export interface RegisterNotificationResultPayload {
  reminder_instance_id: string;
  delivered: boolean;
  channel: string;
}

// ---------------------------------------------------------------------------
// 导出命令（第 8.7 节）
// ---------------------------------------------------------------------------

/** 生成范围和保护预览。只读。 */
export interface PreviewExportPayload {
  scope: ExportScope;
  password_protected?: boolean;
}

export interface ExportScope {
  include?: Array<
    | 'original_records'
    | 'attachments'
    | 'goals'
    | 'actions'
    | 'facts'
    | 'memories'
    | 'decisions'
    | 'situations'
    | 'versions'
    | 'confirmations'
  >;
  formats: Array<'markdown' | 'json' | 'archive'>;
  /** 是否包含已删除/软删除内容。 */
  include_deleted?: boolean;
  /** 日期范围。 */
  from?: string;
  to?: string;
}

export interface ExportPreviewResult {
  count_by_type: Record<string, number>;
  sensitive_items: Array<{ type: string; count: number }>;
  estimated_size_bytes: number;
}

/** 冻结范围并创建导出任务。需要导出确认。 */
export interface StartExportPayload {
  preview_token: string; // 由 PreviewExport 返回，确认冻结范围
  password: string;
}

/** 取消导出任务并清理临时材料。不改变源对象。 */
export interface CancelExportPayload {
  export_task_id: string;
}

/** 按原范围和原语义重试。不得扩大范围。 */
export interface RetryExportPayload {
  export_task_id: string;
}

/** 下载已校验的成功交付物。不返回残缺包。 */
export interface DownloadExportResultPayload {
  export_task_id: string;
}

// ---------------------------------------------------------------------------
// 维护命令（第 8.8 节）
// ---------------------------------------------------------------------------

/** 生成归档候选；本命令不得直接修改正式对象。 */
export interface CreateArchiveObjectCandidatePayload {
  kind: BusinessObjectKind;
  object_id: string;
}

/** 生成软删除候选；最终生效只能走 SubmitConfirmationBatch。 */
export interface CreateSoftDeleteObjectCandidatePayload {
  kind: BusinessObjectKind;
  object_id: string;
}

/** 生成恢复候选；最终生效只能走 SubmitConfirmationBatch。 */
export interface CreateRestoreObjectCandidatePayload {
  kind: BusinessObjectKind;
  object_id: string;
  expected_version?: string;
}

/** 生成彻底删除候选；二次确认后仍由 SubmitConfirmationBatch 生效。 */
export interface CreatePermanentDeleteObjectCandidatePayload {
  kind: BusinessObjectKind;
  object_id: string;
  confirm_token: string; // 二次确认凭证
}

/** @deprecated 使用 CreateArchiveObjectCandidatePayload。 */
export type ArchiveObjectPayload = CreateArchiveObjectCandidatePayload;
/** @deprecated 使用 CreateSoftDeleteObjectCandidatePayload。 */
export type SoftDeleteObjectPayload = CreateSoftDeleteObjectCandidatePayload;
/** @deprecated 使用 CreateRestoreObjectCandidatePayload。 */
export type RestoreObjectPayload = CreateRestoreObjectCandidatePayload;
/** @deprecated 使用 CreatePermanentDeleteObjectCandidatePayload。 */
export type PermanentlyDeleteObjectPayload = CreatePermanentDeleteObjectCandidatePayload;

/** 重建索引。不改变业务对象。 */
export interface RebuildIndexPayload {
  index_type: 'vector' | 'keyword' | 'full';
}

/** 刷新处境聚合。只能生成视图或候选，不能直接写正式处境。 */
export interface RefreshContextSnapshotPayload {
  user_id?: string;
}

/** 标记事实错误。具体是否形成候选由事实规则决定。 */
export interface MarkFactIncorrectPayload {
  fact_id: string;
}

// ---------------------------------------------------------------------------
// Query 查询接口（第 8.9 节）
// ---------------------------------------------------------------------------

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

/**
 * 正式业务撤销资格。撤销不使用固定 TTL，而由可逆性、当前版本和后续变更决定；
 * eligible=true 后仍须创建 undo 候选并经新的 SubmitConfirmationBatch 生效。
 */
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
  business_day?: string; // YYYY-MM-DD（用户时区的业务日）
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

// ---------------------------------------------------------------------------
// 流式事件（补充：与 Command 分离的推送通道）
// ---------------------------------------------------------------------------

/**
 * 与 REST Command/Query 不同，流式事件通过 WebSocket 推送。
 * 传输层决策见 P0 决策收口文档 第 1 节。
 * 当前产品级事件见 events.ts 的 ServerPushEventV1。
 */

// ---------------------------------------------------------------------------
// 端到端数据流（第 6 节）示例 —— 供实现参考，不限定具体实现
// ---------------------------------------------------------------------------

/** @deprecated 从 events.ts 导入 ServerPushEventV1。 */
export type ServerPushEvent = import('./events').ServerPushEventV1;
