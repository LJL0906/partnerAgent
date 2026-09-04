import type { ResourceRef, TaskRef } from './local-core.js';

/** Local Core 支持的结构化分析类型。 */
export const ANALYSIS_TYPES = [
  'idea_organize',
  'experience_review',
  'problem_analysis',
  'content_extract',
  'action',
] as const;
export type AnalysisType = (typeof ANALYSIS_TYPES)[number];

/** 至少包含一个分析类型；类型系统无法表达去重，服务端仍须在运行时拒绝重复值。 */
export type NonEmptyAnalysisTypes = [AnalysisType, ...AnalysisType[]];

export const ANALYSIS_RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
] as const;
export type AnalysisRunStatus = (typeof ANALYSIS_RUN_STATUSES)[number];

export const STRUCTURED_ANALYSIS_STATUSES = [
  'valid',
  'partially_valid',
  'invalid',
] as const;
export type StructuredAnalysisStatus =
  (typeof STRUCTURED_ANALYSIS_STATUSES)[number];

/** 分析任务必须同时引用权威 AnalysisRun，不能只暴露后台 task id。 */
export interface AnalysisTaskRef extends TaskRef {
  kind: 'analysis';
  analysis_run_id: string;
  analysis_types: NonEmptyAnalysisTypes;
}

/** 提交文字输入：创建原始记录、消息引用、聊天响应任务，并按需登记分析任务。 */
export interface SubmitTextInputPayload {
  /** 原始文本内容。 */
  text: string;
  /** 目标会话 id（为空则创建新会话）。 */
  session_id?: string;
  /** 是否按需触发结构化分析（默认 false，普通聊天不主动分析）。 */
  request_analysis?: boolean;
  /** 请求的非空、无重复分析类型（仅 request_analysis 为 true 时）。 */
  analysis_types?: NonEmptyAnalysisTypes;
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
  analysis_task?: AnalysisTaskRef;
}

/** Action 提案对应的权威来源；excerpt 只允许进入受控分析存储，不得进入 WS 摘要。 */
export interface ActionProposalSourceV1 {
  source_ref: ResourceRef;
  excerpt?: string;
}

/** Pi/模型可提出的最小 Action 结构；仍需服务端做 Schema、来源、时间和风险校验。 */
export interface ActionCandidateProposalV1 {
  proposal_id: string;
  title: string;
  description?: string;
  execution_status: 'todo';
  planned_at?: string;
  deadline_at?: string;
  timezone?: string;
  priority?: 'low' | 'medium' | 'high';
  confidence: number;
  uncertainty?: string;
  source: ActionProposalSourceV1;
}

/** propose_action_candidates 的受控版本输出；不能直接写入正式 Action。 */
export interface ActionStructuredProposalV1 {
  schema_version: 1;
  analysis_type: 'action';
  candidates: [ActionCandidateProposalV1, ...ActionCandidateProposalV1[]];
}

/** P1-02 持久化候选生产链的结果契约；P1-01 仅冻结该结构。 */
export interface ActionCandidateResultV1 {
  analysis_run_ref: ResourceRef & { kind: 'analysis_run' };
  structured_analysis_ref: ResourceRef & { kind: 'analysis_result' };
  confirmation_batch_ref: ResourceRef & { kind: 'confirmation_batch' };
  candidate_refs: Array<ResourceRef & { kind: 'candidate' }>;
  accepted_count: number;
  rejected_count: number;
  warnings?: string[];
}

/** GetAnalysisRun 的最小权威结果，不包含原始敏感输入或模型内部上下文。 */
export interface AnalysisRunResult {
  analysis_run_ref: ResourceRef & { kind: 'analysis_run' };
  original_record_ref: ResourceRef & { kind: 'original_record' };
  chat_task_ref: TaskRef;
  analysis_type: AnalysisType;
  status: AnalysisRunStatus;
  result_refs: Array<ResourceRef & { kind: 'analysis_result' }>;
  error_summary?: string;
  version: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}
