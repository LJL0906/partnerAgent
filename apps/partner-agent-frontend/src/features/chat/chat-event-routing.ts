import type { ChatItem, ServerPushEventV1, SubscriptionChannel } from '@partner-agent/contracts';

type ApplicationEventType = 'candidate' | 'reminder' | 'summary';
export type ApplicationEvent = Extract<ServerPushEventV1, { event_type: ApplicationEventType }>;

const APPLICATION_EVENT_TYPES = new Set<ApplicationEventType>([
  'candidate',
  'reminder',
  'summary',
]);
const applicationEventListeners = new Set<(event: ApplicationEvent) => void>();

export const PENDING_CHAT_TASK_ID = '__pending_task__';

export type AgentEventRoute = 'application' | 'chat' | 'ignore';

export function subscribeApplicationEvents(
  listener: (event: ApplicationEvent) => void,
): () => void {
  applicationEventListeners.add(listener);
  return () => applicationEventListeners.delete(listener);
}

export function dispatchApplicationEvent(event: ServerPushEventV1): void {
  if (!isApplicationEvent(event)) return;
  for (const listener of applicationEventListeners) {
    try {
      listener(event);
    } catch {
      // 一个应用级消费方失败，不得阻断实时流上的其他事件。
    }
  }
}

interface ChatEventContext {
  activeOperationId?: string;
  currentTaskId?: string;
  pendingOperationId?: string;
  previousTaskId?: string;
  sessionId: string;
}

/**
 * user:self 也会承载其他会话的候选、提醒和摘要。这些事件应交给应用级
 * 消费方，而不能被当前聊天任务过滤或写入 chat store。
 */
export function routeAgentEvent(
  event: ServerPushEventV1,
  context: ChatEventContext,
): AgentEventRoute {
  const eventSessionId = event.session_id ?? channelId(event.channel, 'session');
  if (isApplicationEvent(event)) {
    if (event.channel === 'user:self') return 'application';
    return !eventSessionId || eventSessionId === context.sessionId ? 'application' : 'ignore';
  }

  if (eventSessionId && eventSessionId !== context.sessionId) return 'ignore';

  if (event.operation_id) {
    const operationMatches =
      event.operation_id === context.activeOperationId ||
      event.operation_id === context.pendingOperationId;
    if (!operationMatches && event.channel.startsWith('operation:')) return 'ignore';
  }

  const eventTaskId = event.task_id ?? channelId(event.channel, 'task');
  if (!eventTaskId) return 'chat';
  if (context.currentTaskId === PENDING_CHAT_TASK_ID) {
    if (eventTaskId === context.previousTaskId) return 'ignore';
    return event.operation_id === context.pendingOperationId ? 'chat' : 'ignore';
  }
  return !context.currentTaskId || eventTaskId === context.currentTaskId ? 'chat' : 'ignore';
}

function isApplicationEvent(event: ServerPushEventV1): event is ApplicationEvent {
  return APPLICATION_EVENT_TYPES.has(event.event_type as ApplicationEventType);
}

export function initialChatChannels(): SubscriptionChannel[] {
  return ['user:self'];
}

export function desiredChannels(
  sessionId: string,
  taskId?: string,
  operationId?: string,
): SubscriptionChannel[] {
  const channels: SubscriptionChannel[] = ['user:self', `session:${sessionId}`];
  if (taskId) channels.push(`task:${taskId}`);
  if (operationId) channels.push(`operation:${operationId}`);
  return channels;
}

export function channelId(
  channel: SubscriptionChannel,
  kind: 'task' | 'session',
): string | undefined {
  const prefix = `${kind}:`;
  return channel.startsWith(prefix) ? channel.slice(prefix.length) : undefined;
}



export function mapServerPushEventToChatItems(event: ServerPushEventV1): ChatItem[] {
  const common = { schema_version: 1 as const, session_id: event.session_id, task_id: event.task_id, operation_id: event.operation_id, created_at: event.timestamp, updated_at: event.timestamp };
  const id = (suffix: string) => `${event.task_id ?? event.operation_id ?? event.session_id ?? event.event_id}:${suffix}`;
  switch (event.event_type) {
    case 'thinking_delta':
      return [{ ...common, id: id('thinking'), type: 'thinking', status: 'streaming', collapsed: true, payload: { text: event.data, display: 'progress' } }];
    case 'tool_execution_start':
      return [{ ...common, id: id(event.data.tool_call_id), type: 'tool', status: 'running', collapsed: true, tool_call_id: event.data.tool_call_id, payload: { tool: event.data.tool } }];
    case 'tool_execution_end':
      return [{ ...common, id: id(event.data.tool_call_id), type: 'tool', status: event.data.success ? 'completed' : 'failed', collapsed: true, tool_call_id: event.data.tool_call_id, execution_id: event.data.execution_id, payload: { tool: event.data.tool, undo_available: event.data.undo_available } }];
    case 'tool_confirmation_pending':
      return [{ ...common, id: id(event.data.confirmation_id), type: 'approval', status: 'pending', collapsed: true, approval_id: event.data.confirmation_id, tool_call_id: event.data.tool_call_id, payload: { approval_id: event.data.confirmation_id, tool: event.data.tool, request_summary: event.data.request_summary, risk_level: event.data.risk_level, expires_at: event.data.expires_at } }];
    case 'tool_confirmation_confirmed':
      return [{ ...common, id: id(event.data.confirmation_id), type: 'approval', status: 'completed', collapsed: true, approval_id: event.data.confirmation_id, tool_call_id: event.data.tool_call_id, payload: { approval_id: event.data.confirmation_id, tool: event.data.tool, request_summary: '工具审批已确认', risk_level: 'medium' } }];
    case 'tool_confirmation_dismissed':
      return [{ ...common, id: id(event.data.confirmation_id), type: 'approval', status: event.data.reason === 'expired' ? 'expired' : 'dismissed', collapsed: true, approval_id: event.data.confirmation_id, tool_call_id: event.data.tool_call_id, payload: { approval_id: event.data.confirmation_id, tool: event.data.tool, request_summary: event.data.reason === 'expired' ? '工具审批已过期' : '工具审批已拒绝', risk_level: 'medium' } }];
    case 'tool_undo_available':
      return [{ ...common, id: id(event.data.execution_id), type: 'tool', status: 'pending', collapsed: true, execution_id: event.data.execution_id, payload: { tool: event.data.tool, undo_available: true } }];
    case 'tool_undo_completed':
      return [{ ...common, id: id(event.data.execution_id), type: 'tool', status: event.data.success ? 'completed' : 'failed', collapsed: true, execution_id: event.data.execution_id, payload: { tool: event.data.tool, undo_available: false, output_summary: event.data.success ? '工具操作已撤销' : '工具操作撤销失败' } }];
    case 'candidate':
      return event.data.candidate_refs.map((ref) => ({ ...common, id: ref.id, type: 'candidate', status: 'pending', collapsed: true, candidate_id: ref.id, payload: { candidate_id: ref.id, kind: ref.kind, preview: { summary: event.data.safe_summary, candidate_count: event.data.candidate_count, risk_level: event.data.risk_level }, applied: false, source_refs: [ref], risk: event.data.risk_level } } as ChatItem));
    case 'reminder':
      return [{ ...common, id: id(event.data.reminder_instance_id), type: 'reminder', status: 'pending', collapsed: true, payload: { reminder_id: event.data.reminder_instance_id, title: '提醒' } }];
    case 'summary':
      return [{ ...common, id: id(event.data.summary_id), type: 'summary', status: 'completed', collapsed: true, payload: { content: '摘要已生成', period: event.data.summary_kind } }];
    case 'error':
      return [{ ...common, id: event.event_id, type: 'error', status: 'failed', collapsed: true, payload: { code: event.data.code, message: event.data.message } }];
    case 'text_delta':
      return [{ ...common, id: id('assistant'), type: 'message', status: 'streaming', collapsed: false, message_id: id('assistant'), payload: { role: 'assistant', content: event.data, format: 'markdown' } }];
    case 'task_state':
      return [{ ...common, id: id('runtime'), type: 'runtime', status: event.data.state === 'running' ? 'running' : event.data.state === 'completed' ? 'completed' : event.data.state === 'failed' ? 'failed' : event.data.state === 'cancelled' ? 'cancelled' : 'queued', collapsed: true, payload: { state: event.data.state, detail: event.data.message } }];
    case 'done':
      return [{ ...common, id: id('runtime'), type: 'runtime', status: 'completed', collapsed: true, payload: { state: 'completed' } }];
    case 'cancelled':
      return [{ ...common, id: id('runtime'), type: 'runtime', status: 'cancelled', collapsed: true, payload: { state: 'cancelled' } }];
    case 'recovery_required':
      return [{ ...common, id: event.event_id, type: 'system', status: 'pending', collapsed: true, payload: { code: 'RECOVERY_REQUIRED', message: '实时事件需要从会话快照恢复' } }];
    default:
      return [];
  }
}
