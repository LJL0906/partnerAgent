import type { CommandResult, ResourceRef, TaskRef } from './local-core.js';
import { isOperationId } from './chat-item-identity.js';
import {
  REASONING_LEVELS,
  type ReasoningLevel,
  type ResolvedModelSelection,
} from './local-core-model.js';

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

export const CHAT_OUTPUT_MODES = ['chat', 'structured_preview'] as const;
export type ChatOutputMode = (typeof CHAT_OUTPUT_MODES)[number];

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

interface SubmitTextInputBase {
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
  /** 省略时由服务端解析默认模型。 */
  model_config_id?: string;
  /** 省略时由服务端按模型能力解析默认推理等级。 */
  reasoning_level?: ReasoningLevel;
}

export type SubmitTextInputPayload = SubmitTextInputBase & (
  | {
    output_mode?: Extract<ChatOutputMode, 'chat'>;
    preview_kind?: never;
    request_analysis?: false;
    analysis_types?: never;
  }
  | {
    output_mode?: Extract<ChatOutputMode, 'chat'>;
    preview_kind?: never;
    request_analysis: true;
    analysis_types: NonEmptyAnalysisTypes;
  }
  | {
    output_mode: Extract<ChatOutputMode, 'structured_preview'>;
    preview_kind: 'action';
    request_analysis?: false;
    analysis_types?: never;
  }
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const SUBMIT_TEXT_INPUT_FIELDS = [
  'text', 'session_id', 'request_analysis', 'analysis_types', 'input_id',
  'model_config_id', 'reasoning_level', 'output_mode', 'preview_kind',
] as const;

export function isSubmitTextInputPayload(value: unknown): value is SubmitTextInputPayload {
  if (!isRecord(value)
    || !Object.keys(value).every((key) => (SUBMIT_TEXT_INPUT_FIELDS as readonly string[]).includes(key))
    || !hasText(value.text)
    || !hasText(value.input_id)
    || (value.session_id !== undefined && !hasText(value.session_id))
    || (value.model_config_id !== undefined && !hasText(value.model_config_id))
    || (value.reasoning_level !== undefined
      && !(REASONING_LEVELS as readonly unknown[]).includes(value.reasoning_level))) return false;

  if (value.output_mode === 'structured_preview') {
    return value.preview_kind === 'action'
      && (value.request_analysis === undefined || value.request_analysis === false)
      && value.analysis_types === undefined;
  }

  if (value.output_mode !== undefined && value.output_mode !== 'chat') return false;
  if (value.preview_kind !== undefined) return false;
  if (value.request_analysis === true) {
    return Array.isArray(value.analysis_types)
      && value.analysis_types.length > 0
      && value.analysis_types.every((type) => (ANALYSIS_TYPES as readonly unknown[]).includes(type))
      && new Set(value.analysis_types).size === value.analysis_types.length;
  }
  return (value.request_analysis === undefined || value.request_analysis === false)
    && value.analysis_types === undefined;
}

export function parseSubmitTextInputPayload(value: unknown): SubmitTextInputPayload {
  if (!isSubmitTextInputPayload(value)) throw new TypeError('Invalid SubmitTextInputPayload');
  return value;
}

export interface SubmitTextInputResult {
  /** 如果指定了 session_id，回显之；新会话则返回新会话引用。 */
  session_id: string;
  /** 提交的消息引用。 */
  message_ref: ResourceRef & { kind: 'chat_message' };
  /** 原始记录引用。 */
  original_record?: ResourceRef & { kind: 'original_record' };
  /** 聊天响应任务引用（流式事件从该频道读）。 */
  chat_task: TaskRef & { kind: 'chat_response' };
  /** 分析任务引用（若 request_analysis 为 true）。 */
  analysis_task?: AnalysisTaskRef;
  /** 服务端默认解析后的受理模型；必须与任务保存值和实际调用选择一致。 */
  resolved_model: ResolvedModelSelection;
}

export type SubmitTextInputCommandResult =
  | (CommandResult<SubmitTextInputResult> & {
    status: 'accepted' | 'completed' | 'duplicate';
    data: SubmitTextInputResult;
    resource_refs: ResourceRef[];
    task_refs: TaskRef[];
  })
  | (CommandResult<never> & { status: 'rejected'; data?: never });

const isResourceRef = (value: unknown): value is ResourceRef =>
  isRecord(value)
  && hasText(value.id)
  && [
    'session', 'chat_message', 'original_record', 'attachment', 'analysis_run',
    'analysis_result', 'candidate', 'confirmation_batch', 'goal', 'action',
    'fact', 'memory', 'decision', 'situation', 'reminder_plan',
    'reminder_instance', 'suggestion', 'export_task',
  ].includes(value.kind as string);

const isTaskRef = (value: unknown): value is TaskRef =>
  isRecord(value)
  && hasText(value.task_id)
  && [
    'chat_response', 'analysis', 'attachment_parse', 'summary', 'weekly_review',
    'reminder', 'export', 'index_update',
  ].includes(value.kind as string);

export function isSubmitTextInputCommandResult(
  value: unknown,
  expectedOperationId?: string,
): value is SubmitTextInputCommandResult {
  if (!isRecord(value)
    || !Object.keys(value).every((key) => [
      'operation_id', 'status', 'resource_refs', 'new_versions', 'task_refs',
      'warnings', 'validation_errors', 'data',
    ].includes(key))
    || !isOperationId(value.operation_id)
    || (expectedOperationId !== undefined && value.operation_id !== expectedOperationId)
    || !['accepted', 'completed', 'duplicate', 'rejected'].includes(value.status as string)
    || (value.resource_refs !== undefined
      && (!Array.isArray(value.resource_refs) || !value.resource_refs.every(isResourceRef)))
    || (value.task_refs !== undefined
      && (!Array.isArray(value.task_refs) || !value.task_refs.every(isTaskRef)))
    || (value.new_versions !== undefined
      && (!isRecord(value.new_versions)
        || !Object.values(value.new_versions).every((version) => hasText(version))))
    || (value.warnings !== undefined
      && (!Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === 'string')))
    || (value.validation_errors !== undefined
      && (!Array.isArray(value.validation_errors)
        || !value.validation_errors.every((error) => isRecord(error)
          && hasText(error.field) && hasText(error.code) && typeof error.message === 'string')))) return false;
  if (value.status === 'rejected') return value.data === undefined;
  const data = value.data;
  const refs = value.resource_refs;
  const tasks = value.task_refs;
  if (!isRecord(data)
    || !Object.keys(data).every((key) => [
      'session_id', 'message_ref', 'original_record', 'chat_task',
      'analysis_task', 'resolved_model',
    ].includes(key))
    || !hasText(data.session_id)
    || !isResourceRef(data.message_ref)
    || data.message_ref.kind !== 'chat_message'
    || !isTaskRef(data.chat_task)
    || data.chat_task.kind !== 'chat_response'
    || !isRecord(data.resolved_model)
    || !hasText(data.resolved_model.model_config_id)
    || !(REASONING_LEVELS as readonly unknown[]).includes(data.resolved_model.reasoning_level)
    || !Array.isArray(refs)
    || !refs.every(isResourceRef)
    || !Array.isArray(tasks)
    || !tasks.every(isTaskRef)) return false;

  const sessionId = data.session_id;
  const messageRef = data.message_ref;
  const chatTask = data.chat_task;
  const originalRecord = data.original_record;
  const analysisTask = data.analysis_task;
  const analysisTaskValid = analysisTask === undefined
    || (isRecord(analysisTask)
      && analysisTask.kind === 'analysis'
      && hasText(analysisTask.task_id)
      && hasText(analysisTask.analysis_run_id)
      && Array.isArray(analysisTask.analysis_types)
      && analysisTask.analysis_types.length > 0
      && analysisTask.analysis_types.every((type) =>
        (ANALYSIS_TYPES as readonly unknown[]).includes(type))
      && new Set(analysisTask.analysis_types).size === analysisTask.analysis_types.length
      && tasks.some((ref) => ref.kind === 'analysis' && ref.task_id === analysisTask.task_id)
      && refs.some((ref) => ref.kind === 'analysis_run' && ref.id === analysisTask.analysis_run_id));
  return analysisTaskValid
    && refs.some((ref) => ref.kind === 'session' && ref.id === sessionId)
    && refs.some((ref) => ref.kind === 'chat_message' && ref.id === messageRef.id)
    && tasks.some((ref) => ref.kind === 'chat_response' && ref.task_id === chatTask.task_id)
    && (originalRecord === undefined
      || (isResourceRef(originalRecord)
        && originalRecord.kind === 'original_record'
        && refs.some((ref) => ref.kind === 'original_record' && ref.id === originalRecord.id)));
}

export function parseSubmitTextInputCommandResult(
  value: unknown,
  expectedOperationId?: string,
): SubmitTextInputCommandResult {
  if (!isSubmitTextInputCommandResult(value, expectedOperationId)) {
    throw new TypeError('Invalid SubmitTextInputCommandResult');
  }
  return value;
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

const ANALYSIS_RUN_RESULT_FIELDS = [
  'analysis_run_ref', 'original_record_ref', 'chat_task_ref', 'analysis_type',
  'status', 'result_refs', 'error_summary', 'version', 'created_at', 'updated_at',
  'completed_at',
] as const;

const isExactTypedRef = (value: unknown, kind: ResourceRef['kind']): boolean =>
  isRecord(value)
  && Object.keys(value).every((key) => key === 'kind' || key === 'id')
  && Object.keys(value).length === 2
  && value.kind === kind
  && hasText(value.id);

export function isGetAnalysisRunResult(value: unknown): value is AnalysisRunResult {
  if (!isRecord(value)
    || !Object.keys(value).every((key) =>
      (ANALYSIS_RUN_RESULT_FIELDS as readonly string[]).includes(key))
    || !isExactTypedRef(value.analysis_run_ref, 'analysis_run')
    || !isExactTypedRef(value.original_record_ref, 'original_record')
    || !isRecord(value.chat_task_ref)
    || Object.keys(value.chat_task_ref).length !== 2
    || !Object.keys(value.chat_task_ref).every((key) => key === 'kind' || key === 'task_id')
    || value.chat_task_ref.kind !== 'analysis'
    || !hasText(value.chat_task_ref.task_id)
    || !(ANALYSIS_TYPES as readonly unknown[]).includes(value.analysis_type)
    || !(ANALYSIS_RUN_STATUSES as readonly unknown[]).includes(value.status)
    || !Array.isArray(value.result_refs)
    || !value.result_refs.every((ref) => isExactTypedRef(ref, 'analysis_result'))
    || new Set(value.result_refs.map((ref) => (ref as ResourceRef).id)).size
      !== value.result_refs.length
    || (typeof value.version !== 'string' || !/^[1-9]\d*$/.test(value.version))
    || typeof value.created_at !== 'string'
    || !Number.isFinite(Date.parse(value.created_at))
    || typeof value.updated_at !== 'string'
    || !Number.isFinite(Date.parse(value.updated_at))
    || (value.error_summary !== undefined && !hasText(value.error_summary))
    || (value.completed_at !== undefined
      && (typeof value.completed_at !== 'string'
        || !Number.isFinite(Date.parse(value.completed_at))))) return false;

  const terminal = ['completed', 'partially_completed', 'failed', 'cancelled'].includes(
    value.status as string,
  );
  return terminal === (value.completed_at !== undefined)
    && (value.status === 'failed' ? value.error_summary !== undefined : true)
    && (value.status === 'completed' || value.status === 'partially_completed'
      ? value.result_refs.length > 0
      : true);
}

export function parseGetAnalysisRunResult(value: unknown): AnalysisRunResult {
  if (!isGetAnalysisRunResult(value)) throw new TypeError('Invalid GetAnalysisRunResult');
  return value;
}
