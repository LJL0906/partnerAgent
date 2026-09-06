/**
 * 统一聊天消息契约。该文件只描述聊天展示/恢复边界，不声明后端未确认的业务能力。
 */

import type { ReasoningLevel } from './local-core-model.js';
import { isOperationId, TASK_STATES, type TaskState } from './chat-item-identity.js';
import { isChatPreviewV1, type ChatPreviewV1 } from './chat-preview.js';

export const CHAT_ITEM_TYPES = [
  'message', 'thinking', 'tool', 'candidate', 'approval',
  'structured_preview', 'runtime', 'system', 'reminder', 'summary', 'error',
] as const;
export type ChatItemType = (typeof CHAT_ITEM_TYPES)[number];

export const CHAT_ITEM_STATUSES = [
  'queued', 'streaming', 'pending', 'running', 'completed',
  'failed', 'cancelled', 'dismissed', 'expired', 'paused',
] as const;
export type ChatItemStatus = (typeof CHAT_ITEM_STATUSES)[number];

export const CHAT_ITEM_DEFAULT_COLLAPSED: Record<ChatItemType, boolean> = {
  message: false, thinking: true, tool: true, candidate: true, approval: true,
  structured_preview: true, runtime: true, system: true, reminder: true,
  summary: true, error: true,
};

export const PREVIEW_ONLY_APPLIED = false as const;

export interface ChatItemRelations {
  session_id?: string;
  task_id?: string;
  operation_id?: string;
  parent_id?: string;
  message_id?: string;
  tool_call_id?: string;
  execution_id?: string;
  candidate_id?: string;
  approval_id?: string;
  preview_id?: string;
}

export interface ChatItemBase<T extends ChatItemType, P> extends ChatItemRelations {
  schema_version: 1;
  id: string;
  type: T;
  status: ChatItemStatus;
  collapsed: boolean;
  created_at: number;
  updated_at: number;
  /** 服务端持久化的逐 item 正整数修订；不得用 WS channel sequence 替代。 */
  revision: number;
  sequence?: number;
  payload: P;
}

export interface MessagePayload {
  role: 'user' | 'assistant' | 'system';
  content: string;
  format?: 'text' | 'markdown';
  model_config_id?: string;
  reasoning_level?: ReasoningLevel;
}
export interface ThinkingPayload { text?: string; display?: 'summary' | 'progress' | 'hidden'; }
export interface ToolPayload { tool: string; input_summary?: string; output_summary?: string; risk_level?: 'read_only' | 'low' | 'medium' | 'high'; undo_available?: boolean; }
/** 正式确认中心候选的安全摘要；不得承载 ChatPreviewV1。 */
export interface FormalCandidatePayload { candidate_id: string; kind: string; preview: Record<string, unknown>; applied: false; source_refs?: Array<{ kind: string; id: string }>; confidence?: number; risk?: 'normal' | 'high'; sensitive_marks?: string[]; }
/** @deprecated 使用 FormalCandidatePayload；结构化聊天预览必须使用 ChatPreviewV1。 */
export type PreviewOnlyBusinessOutput = FormalCandidatePayload;
export interface ApprovalPayload { approval_id: string; tool: string; request_summary: string; risk_level: 'read_only' | 'low' | 'medium' | 'high'; expires_at?: number; }
export interface RuntimePayload { state: TaskState; detail?: string; progress?: number; }
export interface SystemPayload { code?: string; message: string; }
export interface ReminderPayload { reminder_id?: string; title: string; due_at?: number; }
export interface SummaryPayload { content: string; period?: string; }
export interface ErrorPayload { code: string; message: string; retryable?: boolean; }

export type MessageChatItem = ChatItemBase<'message', MessagePayload>;
export type ThinkingChatItem = ChatItemBase<'thinking', ThinkingPayload>;
export type ToolChatItem = ChatItemBase<'tool', ToolPayload>;
export type CandidateChatItem = ChatItemBase<'candidate', FormalCandidatePayload>;
export type ApprovalChatItem = ChatItemBase<'approval', ApprovalPayload>;
export type StructuredPreviewChatItem = ChatItemBase<'structured_preview', ChatPreviewV1>;
export type RuntimeChatItem = ChatItemBase<'runtime', RuntimePayload>;
export type SystemChatItem = ChatItemBase<'system', SystemPayload>;
export type ReminderChatItem = ChatItemBase<'reminder', ReminderPayload>;
export type SummaryChatItem = ChatItemBase<'summary', SummaryPayload>;
export type ErrorChatItem = ChatItemBase<'error', ErrorPayload>;
export type ChatItem = MessageChatItem | ThinkingChatItem | ToolChatItem | CandidateChatItem
  | ApprovalChatItem | StructuredPreviewChatItem | RuntimeChatItem | SystemChatItem
  | ReminderChatItem | SummaryChatItem | ErrorChatItem;

export const SESSION_TOOL_STATUSES = [
  'pending', 'executing', 'succeeded', 'failed', 'dismissed',
  'expired', 'indeterminate', 'undone',
] as const;
export type SessionToolStatus = (typeof SESSION_TOOL_STATUSES)[number];
export const SESSION_TOOL_ALLOWED_ACTIONS = ['confirm', 'dismiss', 'undo'] as const;
export type SessionToolAllowedAction = (typeof SESSION_TOOL_ALLOWED_ACTIONS)[number];

export const SESSION_TOOL_STATUS_TO_CHAT_ITEM_STATUS = {
  pending: 'pending',
  executing: 'running',
  succeeded: 'completed',
  failed: 'failed',
  dismissed: 'dismissed',
  expired: 'expired',
  indeterminate: 'paused',
  undone: 'completed',
} as const satisfies Record<SessionToolStatus, ChatItemStatus>;

/** 工具权威记录的安全 REST 投影，明确排除 arguments/result/undoPayload。 */
export interface SessionToolView {
  session_id: string;
  tool_call_id: string;
  confirmation_id?: string;
  execution_id?: string;
  task_id?: string;
  operation_id?: string;
  tool_name: string;
  status: SessionToolStatus;
  version: number;
  request_summary: string;
  result_summary?: string;
  risk_level: 'read_only' | 'low' | 'medium' | 'high';
  expires_at?: string;
  undo_expires_at?: string;
  allowed_actions: SessionToolAllowedAction[];
}

export function createChatItemDefaults(type: ChatItemType): Pick<ChatItemBase<ChatItemType, unknown>, 'collapsed'> {
  return { collapsed: CHAT_ITEM_DEFAULT_COLLAPSED[type] };
}

const isString = (value: unknown): value is string => typeof value === 'string';
const hasString = (value: unknown): value is string => isString(value) && value.trim().length > 0;
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isTimestamp = (value: unknown): value is number => isFiniteNumber(value) && value >= 0 && value <= 8_640_000_000_000_000;
const isSequence = (value: unknown): value is number => isFiniteNumber(value) && value >= 0 && Number.isSafeInteger(value);
const isRevision = (value: unknown): value is number => isFiniteNumber(value) && value > 0 && Number.isSafeInteger(value);
const isOneOf = (value: unknown, choices: readonly string[]): boolean => isString(value) && choices.includes(value);
const isOptional = (value: unknown, check: (value: unknown) => boolean): boolean => value === undefined || check(value);
const isRiskLevel = (value: unknown): boolean => isOneOf(value, ['read_only', 'low', 'medium', 'high']);
const isSourceRefs = (value: unknown): boolean => Array.isArray(value)
  && value.every((source: unknown) => isRecord(source) && hasString(source.kind) && hasString(source.id));
const isStringArray = (value: unknown): boolean => Array.isArray(value) && value.every(isString);
const RELATION_FIELDS: ReadonlyArray<keyof ChatItemRelations> = [
  'session_id', 'task_id', 'operation_id', 'parent_id', 'message_id',
  'tool_call_id', 'execution_id', 'candidate_id', 'approval_id',
  'preview_id',
];
const CHAT_ITEM_FIELDS = [
  'schema_version', 'id', 'type', 'status', 'collapsed', 'created_at',
  'updated_at', 'revision', 'sequence', 'payload', ...RELATION_FIELDS,
] as const;

export function isChatItem(value: unknown): value is ChatItem {
  if (!isRecord(value)
    || !Object.keys(value).every((key) => (CHAT_ITEM_FIELDS as readonly string[]).includes(key))
    || value.schema_version !== 1
    || !hasString(value.id)
    || !isOneOf(value.type, CHAT_ITEM_TYPES)
    || !isOneOf(value.status, CHAT_ITEM_STATUSES)
    || !isBoolean(value.collapsed)
    || !isTimestamp(value.created_at)
    || !isTimestamp(value.updated_at)
    || !isRevision(value.revision)
    || !isOptional(value.sequence, isSequence)
    || !RELATION_FIELDS.every((field) => isOptional(
      value[field],
      field === 'operation_id' ? isOperationId : hasString,
    ))
    || !isRecord(value.payload)) return false;

  const payload = value.payload;
  switch (value.type) {
    case 'message':
      return value.collapsed === false
        && isOneOf(payload.role, ['user', 'assistant', 'system'])
        && isString(payload.content)
        && isOptional(payload.format, (format) => isOneOf(format, ['text', 'markdown']))
        && isOptional(payload.model_config_id, hasString)
        && isOptional(payload.reasoning_level, (level) => isOneOf(level, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']))
        && payload.visibility !== 'thinking';
    case 'thinking':
      return isOptional(payload.text, isString)
        && isOptional(payload.display, (display) => isOneOf(display, ['summary', 'progress', 'hidden']));
    case 'tool':
      return hasString(payload.tool)
        && isOptional(payload.input_summary, isString)
        && isOptional(payload.output_summary, isString)
        && isOptional(payload.risk_level, isRiskLevel)
        && isOptional(payload.undo_available, isBoolean);
    case 'candidate':
      return payload.applied === false
        && hasString(payload.candidate_id)
        && value.candidate_id === payload.candidate_id
        && hasString(payload.kind)
        && isRecord(payload.preview)
        && isOptional(payload.source_refs, isSourceRefs)
        && isOptional(payload.confidence, isFiniteNumber)
        && isOptional(payload.risk, (risk) => isOneOf(risk, ['normal', 'high']))
        && isOptional(payload.sensitive_marks, isStringArray);
    case 'approval':
      return hasString(payload.approval_id)
        && hasString(payload.tool)
        && hasString(payload.request_summary)
        && isRiskLevel(payload.risk_level)
        && isOptional(payload.expires_at, isTimestamp);
    case 'structured_preview':
      return isChatPreviewV1(payload)
        && value.status === 'completed'
        && hasString(value.session_id)
        && hasString(value.task_id)
        && hasString(value.operation_id)
        && hasString(value.message_id)
        && value.preview_id === payload.preview_id
        && value.id === `preview:${payload.preview_id}`
        && value.parent_id === undefined
        && value.candidate_id === undefined
        && value.approval_id === undefined
        && value.tool_call_id === undefined
        && value.execution_id === undefined;
    case 'runtime':
      return isOneOf(payload.state, TASK_STATES)
        && isOptional(payload.detail, isString)
        && isOptional(payload.progress, isFiniteNumber);
    case 'system':
      return isString(payload.message) && isOptional(payload.code, isString);
    case 'reminder':
      return isString(payload.title)
        && isOptional(payload.reminder_id, hasString)
        && isOptional(payload.due_at, isTimestamp);
    case 'summary':
      return isString(payload.content) && isOptional(payload.period, isString);
    case 'error':
      return hasString(payload.code)
        && isString(payload.message)
        && isOptional(payload.retryable, isBoolean);
    default:
      return false;
  }
}

const SESSION_TOOL_VIEW_FIELDS = [
  'session_id', 'tool_call_id', 'confirmation_id', 'execution_id', 'task_id', 'operation_id',
  'tool_name', 'status', 'version', 'request_summary', 'result_summary',
  'risk_level', 'expires_at', 'undo_expires_at', 'allowed_actions',
] as const;

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

export function isSessionToolView(value: unknown): value is SessionToolView {
  if (!(isRecord(value)
    && Object.keys(value).every((key) => (SESSION_TOOL_VIEW_FIELDS as readonly string[]).includes(key))
    && hasString(value.session_id)
    && hasString(value.tool_call_id)
    && isOptional(value.confirmation_id, hasString)
    && isOptional(value.execution_id, hasString)
    && isOptional(value.task_id, hasString)
    && isOptional(value.operation_id, isOperationId)
    && hasString(value.tool_name)
    && isOneOf(value.status, SESSION_TOOL_STATUSES)
    && isRevision(value.version)
    && isString(value.request_summary)
    && isOptional(value.result_summary, isString)
    && isRiskLevel(value.risk_level)
    && isOptional(value.expires_at, isIsoTimestamp)
    && isOptional(value.undo_expires_at, isIsoTimestamp)
    && Array.isArray(value.allowed_actions)
    && value.allowed_actions.every((action) => isOneOf(action, SESSION_TOOL_ALLOWED_ACTIONS))
    && new Set(value.allowed_actions).size === value.allowed_actions.length)) return false;

  const actions = value.allowed_actions as SessionToolAllowedAction[];
  const approvalActions = actions.some((action) => action === 'confirm' || action === 'dismiss');
  const undoAction = actions.includes('undo');
  return (!approvalActions || (value.status === 'pending' && hasString(value.confirmation_id)))
    && (!undoAction || (value.status === 'succeeded' && hasString(value.execution_id)))
    && (value.status === 'pending' || !approvalActions);
}

export function parseSessionToolView(value: unknown): SessionToolView {
  if (!isSessionToolView(value)) throw new TypeError('Invalid SessionToolView');
  return value;
}

export function parseChatItem(value: unknown): ChatItem {
  if (!isChatItem(value)) throw new TypeError('Invalid ChatItem');
  return value;
}
