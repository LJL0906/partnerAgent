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
  TOOL_001: 'TOOL_001', // 工具执行或恢复失败
  TOOL_002: 'TOOL_002', // 工具审批已过期
  TOOL_003: 'TOOL_003', // 外部工具结果不确定，需人工核对
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

export * from './local-core-analysis.js';

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

export * from './local-core-model.js';

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

export * from './local-core-queries.js';

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
