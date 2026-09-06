import type {
  ChatItem,
  ChatItemStatus,
  ServerPushEventV1,
} from '@partner-agent/contracts';
import { createChatItemDefaults } from '@partner-agent/contracts';
import type { SessionMessageView } from './chat-task.store.js';
import type { ChatTaskState } from '../database/entities/chat-task.entity.js';

export interface ChatTaskSnapshotRef {
  taskId: string;
  ownerId: string;
  sessionId: string;
  operationId: string;
  state: ChatTaskState;
  updatedAt: Date;
  errorCode?: string;
  errorMessage?: string;
  waitingToolConfirmationId?: string;
}

const terminalStates = new Set<ChatItemStatus>(['completed', 'failed', 'cancelled', 'dismissed', 'expired']);
const secretKey = /password|secret|token|api[_-]?key|authorization|bearer|raw/i;

export function buildChatItemsSnapshot(messages: SessionMessageView[], task?: ChatTaskSnapshotRef): ChatItem[] {
  const items: ChatItem[] = messages.map((message, index) => item('message', message.id, messageStatus(message.status ?? 'complete'), {
    created_at: Date.parse(message.created_at), updated_at: Date.parse(message.created_at), sequence: message.sequence ?? index + 1,
    session_id: message.session_id ?? task?.sessionId, message_id: message.id, task_id: message.task_id, operation_id: message.operation_id,
    payload: { role: message.role, content: message.content, format: 'text',
      ...(message.model_config_id ? { model_config_id: message.model_config_id } : {}),
      ...(message.reasoning_level ? { reasoning_level: message.reasoning_level } : {}),
      ...(message.metadata ? { metadata: message.metadata } : {}), },
  }));
  if (task) items.push(taskToRuntimeItem(task));
  return items;
}

export function mapServerPushEventToChatItems(event: ServerPushEventV1): ChatItem[] {
  const common = { session_id: event.session_id, task_id: event.task_id, operation_id: event.operation_id, updated_at: event.timestamp, created_at: event.timestamp };
  const data = asRecord(event.data);
  switch (event.event_type) {
    case 'text_delta':
      return [item('message', stableMessageId(event), statusFor(event.event_type), { ...common, message_id: stableMessageId(event), payload: { role: 'assistant', content: event.data, format: 'markdown' } })];
    case 'history':
      return Array.isArray(data.messages) ? data.messages.map((message, index) => {
        const m = asRecord(message);
        const id = `${event.session_id ?? event.event_id}:history:${index}:${stringValue(m.timestamp)}`;
        return item('message', id, 'completed', { ...common, message_id: id, sequence: index + 1, payload: { role: m.role === 'assistant' || m.role === 'system' ? m.role : 'user', content: safeSummary(m.content), format: 'text' } });
      }) : [];
    case 'thinking_delta':
      return [item('thinking', stableId(event, 'thinking'), 'streaming', { ...common, payload: { text: event.data, display: 'progress' } })];
    case 'tool_execution_start':
      return [item('tool', stableId(event, data.tool_call_id ?? 'tool'), 'running', { ...common, tool_call_id: stringValue(data.tool_call_id), payload: { tool: stringValue(data.tool), input_summary: safeSummary(data.input_summary) } })];
    case 'tool_execution_end':
      return [item('tool', stableId(event, data.tool_call_id ?? 'tool'), data.success === false ? 'failed' : 'completed', { ...common, tool_call_id: stringValue(data.tool_call_id), execution_id: stringValue(data.execution_id), payload: { tool: stringValue(data.tool), output_summary: safeSummary(data.output_summary), undo_available: data.undo_available === true } })];
    case 'tool_confirmation_pending':
      return [item('approval', stableId(event, data.confirmation_id ?? 'approval'), 'pending', { ...common, approval_id: stringValue(data.confirmation_id), tool_call_id: stringValue(data.tool_call_id), payload: { approval_id: stringValue(data.confirmation_id), tool: stringValue(data.tool), request_summary: safeSummary(data.request_summary), risk_level: risk(data.risk_level), expires_at: numberValue(data.expires_at) } })];
    case 'tool_confirmation_confirmed':
      return [item('approval', stableId(event, data.confirmation_id ?? 'approval'), 'completed', { ...common, approval_id: stringValue(data.confirmation_id), payload: { approval_id: stringValue(data.confirmation_id), tool: stringValue(data.tool), request_summary: '工具审批已处理', risk_level: 'medium' } })];
    case 'tool_confirmation_dismissed':
      return [item('approval', stableId(event, data.confirmation_id ?? 'approval'), data.reason === 'expired' ? 'expired' : 'dismissed', { ...common, approval_id: stringValue(data.confirmation_id), payload: { approval_id: stringValue(data.confirmation_id), tool: stringValue(data.tool), request_summary: '工具审批已处理', risk_level: 'medium' } })];
    case 'candidate':
      return candidateItems(event, data);
    case 'reminder':
      return [item('reminder', event.event_id, 'pending', { ...common, payload: { reminder_id: stringValue(data.reminder_instance_id), title: '提醒' } })];
    case 'summary':
      return [item('summary', event.event_id, 'completed', { ...common, payload: { content: '摘要已生成' } })];
    case 'task_state':
      return [runtimeEventItem(event, stringValue(data.state)), ...(data.privacy_decision ? [item('system', stableId(event, 'privacy'), 'pending', { ...common, payload: { code: 'PRIVACY_DECISION_REQUIRED', message: '需要确认隐私外发范围' } })] : [])];
    case 'done':
      return [runtimeEventItem(event, 'completed')];
    case 'cancelled':
      return [runtimeEventItem(event, 'cancelled')];
    case 'recovery_required':
      return [item('system', event.event_id, 'pending', { ...common, payload: { code: 'RECOVERY_REQUIRED', message: '部分实时事件已过期，请从会话快照恢复' } })];
    case 'error':
      return [item('error', event.event_id, 'failed', { ...common, payload: { code: stringValue(data.code, 'INTERNAL_000'), message: safeSummary(data.message) } })];
    default:
      return [];
  }
}

export function mergeChatItems(items: ChatItem[], incoming: ChatItem): ChatItem[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index < 0) return [...items, incoming].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  const current = items[index];
  if (terminalStates.has(current.status) && !terminalStates.has(incoming.status)) return items;
  const merged = { ...current, ...incoming, payload: { ...current.payload, ...incoming.payload } } as ChatItem;
  return items.map((item, i) => (i === index ? merged : item));
}

export function previewCandidate(input: Record<string, unknown>) {
  const candidateId = stringValue(input.candidate_id, 'unknown-candidate');
  const kind = stringValue(input.kind, 'candidate');
  const marks: string[] = [];
  const preview = sanitize(input, '', marks);
  delete preview.candidate_id; delete preview.kind; delete preview.applied;
  return { candidate_id: candidateId, kind, applied: false as const, preview, ...(marks.length ? { sensitive_marks: marks } : {}) };
}

function candidateItems(event: ServerPushEventV1, data: Record<string, unknown>): ChatItem[] {
  const refs = Array.isArray(data.candidate_refs) ? data.candidate_refs : [];
  const summary = safeSummary(data.safe_summary);
  return refs.map((ref, index) => {
    const r = asRecord(ref);
    const candidateId = stringValue(r.id, `${event.event_id}:${index}`);
    const payload = { candidate_id: candidateId, kind: 'candidate', preview: { summary }, applied: false as const, ...(data.risk_level ? { risk: data.risk_level as 'normal' | 'high' } : {}) };
    return item('candidate', candidateId, 'pending', { session_id: event.session_id, task_id: event.task_id, operation_id: event.operation_id, candidate_id: candidateId, payload, created_at: event.timestamp, updated_at: event.timestamp });
  });
}

function taskToRuntimeItem(task: ChatTaskSnapshotRef): ChatItem {
  return item('runtime', `task:${task.taskId}:runtime`, runtimeStatus(task.state), { session_id: task.sessionId, task_id: task.taskId, operation_id: task.operationId, payload: { state: task.state, ...(task.errorMessage ? { detail: safeSummary(task.errorMessage) } : {}) }, created_at: task.updatedAt.getTime(), updated_at: task.updatedAt.getTime() });
}
function runtimeEventItem(event: ServerPushEventV1, state: string): ChatItem {
  return item('runtime', `task:${event.task_id ?? event.operation_id ?? event.session_id ?? event.event_id}:runtime`, runtimeStatus(state), { session_id: event.session_id, task_id: event.task_id, operation_id: event.operation_id, payload: { state }, created_at: event.timestamp, updated_at: event.timestamp });
}
function item<T extends ChatItem['type']>(type: T, id: string, status: ChatItemStatus, rest: Record<string, unknown>): ChatItem { return { schema_version: 1, id, type, status, ...createChatItemDefaults(type), created_at: rest.created_at as number, updated_at: rest.updated_at as number, ...rest, payload: rest.payload } as ChatItem; }
function stableId(event: ServerPushEventV1, suffix: unknown) { return `${event.task_id ?? event.operation_id ?? event.session_id ?? event.event_id}:${String(suffix)}`; }
function stableMessageId(event: ServerPushEventV1) { return `${event.task_id ?? event.operation_id ?? event.session_id ?? event.event_id}:assistant`; }
function statusFor(type: string): ChatItemStatus { return type === 'text_delta' ? 'streaming' : 'pending'; }
function messageStatus(status: SessionMessageView['status'] | undefined): ChatItemStatus { return status === 'complete' ? 'completed' : status; }
function runtimeStatus(state: string): ChatItemStatus { return state === 'completed' || state === 'done' ? 'completed' : state === 'failed' ? 'failed' : state === 'cancelled' ? 'cancelled' : state.startsWith('waiting_') ? 'pending' : state === 'running' ? 'running' : 'queued'; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown, fallback = '') { return typeof value === 'string' ? value : fallback; }
function numberValue(value: unknown) { return typeof value === 'number' ? value : undefined; }
function risk(value: unknown): 'read_only' | 'low' | 'medium' | 'high' { return value === 'read_only' || value === 'low' || value === 'high' ? value : 'medium'; }
function safeSummary(value: unknown) { return sanitizeString(stringValue(value)); }
function sanitizeString(value: string) { return value.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/\b(?:sk|key)-[a-z0-9_-]{8,}\b/gi, '[REDACTED]').slice(0, 500); }
function sanitize(value: unknown, path: string, marks: string[]): Record<string, unknown> { const source = asRecord(value); return Object.fromEntries(Object.entries(source).filter(([key]) => !['candidate_id', 'kind', 'applied'].includes(key)).map(([key, entry]) => { const nextPath = path ? `${path}.${key}` : key; if (secretKey.test(key)) { marks.push(nextPath); return [key, '[REDACTED]']; } if (typeof entry === 'string') return [key, sanitizeString(entry)]; if (Array.isArray(entry)) return [key, entry.map((child, index) => child && typeof child === 'object' ? sanitize(child, `${nextPath}.${index}`, marks) : typeof child === 'string' ? sanitizeString(child) : child)]; if (entry && typeof entry === 'object') return [key, sanitize(entry, nextPath, marks)]; return [key, entry]; })); }
