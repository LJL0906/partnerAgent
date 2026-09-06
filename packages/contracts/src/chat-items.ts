/**
 * 统一聊天消息契约。该文件只描述聊天展示/恢复边界，不声明后端未确认的业务能力。
 */

export const CHAT_ITEM_TYPES = [
  'message', 'thinking', 'tool', 'candidate', 'approval',
  'runtime', 'system', 'reminder', 'summary', 'error',
] as const;
export type ChatItemType = (typeof CHAT_ITEM_TYPES)[number];

export const CHAT_ITEM_STATUSES = [
  'queued', 'streaming', 'pending', 'running', 'completed',
  'failed', 'cancelled', 'dismissed', 'expired', 'paused',
] as const;
export type ChatItemStatus = (typeof CHAT_ITEM_STATUSES)[number];

export const CHAT_ITEM_DEFAULT_COLLAPSED: Record<ChatItemType, boolean> = {
  message: false, thinking: true, tool: true, candidate: true, approval: true,
  runtime: true, system: true, reminder: true, summary: true, error: true,
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
}

export interface ChatItemBase<T extends ChatItemType, P> extends ChatItemRelations {
  schema_version: 1;
  id: string;
  type: T;
  status: ChatItemStatus;
  collapsed: boolean;
  created_at: number;
  updated_at: number;
  sequence?: number;
  payload: P;
}

export interface MessagePayload { role: 'user' | 'assistant' | 'system'; content: string; format?: 'text' | 'markdown'; }
export interface ThinkingPayload { text?: string; display?: 'summary' | 'progress' | 'hidden'; }
export interface ToolPayload { tool: string; input_summary?: string; output_summary?: string; risk_level?: 'read_only' | 'low' | 'medium' | 'high'; undo_available?: boolean; }
export interface PreviewOnlyBusinessOutput { candidate_id: string; kind: string; preview: Record<string, unknown>; applied: false; source_refs?: Array<{ kind: string; id: string }>; confidence?: number; risk?: 'normal' | 'high'; sensitive_marks?: string[]; }
export interface ApprovalPayload { approval_id: string; tool: string; request_summary: string; risk_level: 'read_only' | 'low' | 'medium' | 'high'; expires_at?: number; }
export interface RuntimePayload { state: string; detail?: string; progress?: number; }
export interface SystemPayload { code?: string; message: string; }
export interface ReminderPayload { reminder_id?: string; title: string; due_at?: number; }
export interface SummaryPayload { content: string; period?: string; }
export interface ErrorPayload { code: string; message: string; retryable?: boolean; }

export type MessageChatItem = ChatItemBase<'message', MessagePayload>;
export type ThinkingChatItem = ChatItemBase<'thinking', ThinkingPayload>;
export type ToolChatItem = ChatItemBase<'tool', ToolPayload>;
export type CandidateChatItem = ChatItemBase<'candidate', PreviewOnlyBusinessOutput>;
export type ApprovalChatItem = ChatItemBase<'approval', ApprovalPayload>;
export type RuntimeChatItem = ChatItemBase<'runtime', RuntimePayload>;
export type SystemChatItem = ChatItemBase<'system', SystemPayload>;
export type ReminderChatItem = ChatItemBase<'reminder', ReminderPayload>;
export type SummaryChatItem = ChatItemBase<'summary', SummaryPayload>;
export type ErrorChatItem = ChatItemBase<'error', ErrorPayload>;
export type ChatItem = MessageChatItem | ThinkingChatItem | ToolChatItem | CandidateChatItem | ApprovalChatItem | RuntimeChatItem | SystemChatItem | ReminderChatItem | SummaryChatItem | ErrorChatItem;

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
const isOneOf = (value: unknown, choices: readonly string[]): boolean => isString(value) && choices.includes(value);
const isOptional = (value: unknown, check: (value: unknown) => boolean): boolean => value === undefined || check(value);
const isRiskLevel = (value: unknown): boolean => isOneOf(value, ['read_only', 'low', 'medium', 'high']);
const isSourceRefs = (value: unknown): boolean => Array.isArray(value)
  && value.every((source: unknown) => isRecord(source) && hasString(source.kind) && hasString(source.id));
const isStringArray = (value: unknown): boolean => Array.isArray(value) && value.every(isString);
const RELATION_FIELDS: ReadonlyArray<keyof ChatItemRelations> = [
  'session_id', 'task_id', 'operation_id', 'parent_id', 'message_id',
  'tool_call_id', 'execution_id', 'candidate_id', 'approval_id',
];

export function isChatItem(value: unknown): value is ChatItem {
  if (!isRecord(value)
    || value.schema_version !== 1
    || !hasString(value.id)
    || !isOneOf(value.type, CHAT_ITEM_TYPES)
    || !isOneOf(value.status, CHAT_ITEM_STATUSES)
    || !isBoolean(value.collapsed)
    || !isTimestamp(value.created_at)
    || !isTimestamp(value.updated_at)
    || !isOptional(value.sequence, isSequence)
    || !RELATION_FIELDS.every((field) => isOptional(value[field], hasString))
    || !isRecord(value.payload)) return false;

  const payload = value.payload;
  switch (value.type) {
    case 'message':
      return value.collapsed === false
        && isOneOf(payload.role, ['user', 'assistant', 'system'])
        && isString(payload.content)
        && isOptional(payload.format, (format) => isOneOf(format, ['text', 'markdown']))
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
    case 'runtime':
      return isString(payload.state)
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

export function parseChatItem(value: unknown): ChatItem {
  if (!isChatItem(value)) throw new TypeError('Invalid ChatItem');
  return value;
}
