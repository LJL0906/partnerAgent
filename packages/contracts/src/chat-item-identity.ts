import type { ChatItemStatus } from './chat-items.js';

export const TASK_STATES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'waiting_privacy_decision',
  'waiting_tool_approval',
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const SESSION_MESSAGE_STATUSES = [
  'pending', 'streaming', 'complete', 'failed', 'cancelled',
] as const;
export type SessionMessageStatus = (typeof SESSION_MESSAGE_STATUSES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** operation_id 遵循 CommandEnvelope 的 UUID 约束；其他资源 ID 保持非空 opaque string。 */
export function isOperationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

const requireId = (value: string, field: string): string => {
  if (!value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  return value;
};

export const chatItemIds = {
  message: (messageId: string): string => `message:${requireId(messageId, 'messageId')}`,
  taskAssistant: (taskId: string): string => `task:${requireId(taskId, 'taskId')}:assistant`,
  taskThinking: (taskId: string): string => `task:${requireId(taskId, 'taskId')}:thinking`,
  taskRuntime: (taskId: string): string => `task:${requireId(taskId, 'taskId')}:runtime`,
  tool: (toolCallId: string): string => `tool:${requireId(toolCallId, 'toolCallId')}`,
  approval: (confirmationId: string): string => `approval:${requireId(confirmationId, 'confirmationId')}`,
  preview: (previewId: string): string => `preview:${requireId(previewId, 'previewId')}`,
  candidate: (candidateId: string): string => `candidate:${requireId(candidateId, 'candidateId')}`,
} as const;

export const TASK_STATE_TO_CHAT_ITEM_STATUS = {
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  waiting_privacy_decision: 'pending',
  waiting_tool_approval: 'pending',
} as const satisfies Record<TaskState, ChatItemStatus>;

export const SESSION_MESSAGE_STATUS_TO_CHAT_ITEM_STATUS = {
  pending: 'pending',
  streaming: 'streaming',
  complete: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const satisfies Record<SessionMessageStatus, ChatItemStatus>;

export function taskStateToChatItemStatus(state: TaskState): ChatItemStatus {
  return TASK_STATE_TO_CHAT_ITEM_STATUS[state];
}

export function sessionMessageStatusToChatItemStatus(
  status: SessionMessageStatus,
): ChatItemStatus {
  return SESSION_MESSAGE_STATUS_TO_CHAT_ITEM_STATUS[status];
}
