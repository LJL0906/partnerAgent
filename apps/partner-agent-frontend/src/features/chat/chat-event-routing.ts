import {
  chatItemIds,
  taskStateToChatItemStatus,
  type ChatItem,
  type ServerPushEventV1,
  type SubscriptionChannel,
} from '@partner-agent/contracts';

type ApplicationEventType = 'reminder' | 'summary';
export type ApplicationEvent = Extract<ServerPushEventV1, { event_type: ApplicationEventType }>;
const APPLICATION_EVENT_TYPES = new Set<ApplicationEventType>(['reminder', 'summary']);
const applicationEventListeners = new Set<(event: ApplicationEvent) => void>();

export const PENDING_CHAT_TASK_ID = '__pending_task__';
export type AgentEventRoute = 'application' | 'chat' | 'ignore';

export function subscribeApplicationEvents(listener: (event: ApplicationEvent) => void): () => void {
  applicationEventListeners.add(listener);
  return () => applicationEventListeners.delete(listener);
}

export function dispatchApplicationEvent(event: ServerPushEventV1): void {
  if (!isApplicationEvent(event)) return;
  for (const listener of applicationEventListeners) {
    try { listener(event); } catch { /* One consumer must not stop the stream. */ }
  }
}

interface ChatEventContext {
  activeOperationId?: string;
  currentTaskId?: string;
  pendingOperationId?: string;
  previousTaskId?: string;
  sessionId: string;
  sessionPersisted?: boolean;
}

export function routeAgentEvent(event: ServerPushEventV1, context: ChatEventContext): AgentEventRoute {
  const eventSessionId = event.session_id ?? channelId(event.channel, 'session');
  if (isApplicationEvent(event)) {
    if (event.channel === 'user:self') return 'application';
    return !eventSessionId || eventSessionId === context.sessionId ? 'application' : 'ignore';
  }
  const mayAdoptPendingSession = event.channel === 'user:self'
    && context.sessionPersisted === false
    && context.currentTaskId === PENDING_CHAT_TASK_ID
    && !!eventSessionId
    && event.operation_id === context.pendingOperationId;
  if (eventSessionId && eventSessionId !== context.sessionId && !mayAdoptPendingSession) return 'ignore';
  if (event.operation_id) {
    const operationMatches = event.operation_id === context.activeOperationId
      || event.operation_id === context.pendingOperationId;
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

export function initialChatChannels(): SubscriptionChannel[] { return ['user:self']; }

export function desiredChannels(
  sessionId: string, taskId?: string, operationId?: string,
): SubscriptionChannel[] {
  const channels: SubscriptionChannel[] = ['user:self', `session:${sessionId}`];
  if (taskId) channels.push(`task:${taskId}`);
  if (operationId) channels.push(`operation:${operationId}`);
  return channels;
}

export function channelId(
  channel: SubscriptionChannel, kind: 'task' | 'session',
): string | undefined {
  const prefix = `${kind}:`;
  return channel.startsWith(prefix) ? channel.slice(prefix.length) : undefined;
}

export function mapServerPushEventToChatItems(event: ServerPushEventV1): ChatItem[] {
  if (!('item_id' in event) || !('item_revision' in event)) return [];
  const common = {
    schema_version: 1 as const,
    id: event.item_id,
    revision: event.item_revision,
    session_id: event.session_id,
    task_id: event.task_id,
    operation_id: event.operation_id,
    created_at: event.timestamp,
    updated_at: event.timestamp,
  };
  switch (event.event_type) {
    case 'tool_execution_start':
      return [{ ...common, type: 'tool', status: 'running', collapsed: true,
        tool_call_id: event.data.tool_call_id, payload: { tool: event.data.tool } }];
    case 'tool_execution_end':
      return [{ ...common, type: 'tool', status: event.data.success ? 'completed' : 'failed',
        collapsed: true, tool_call_id: event.data.tool_call_id,
        execution_id: event.data.execution_id,
        payload: { tool: event.data.tool, undo_available: event.data.undo_available } }];
    case 'tool_confirmation_pending':
      return [{ ...common, type: 'approval', status: 'pending', collapsed: true,
        approval_id: event.data.confirmation_id, tool_call_id: event.data.tool_call_id,
        payload: { approval_id: event.data.confirmation_id, tool: event.data.tool,
          request_summary: event.data.request_summary, risk_level: event.data.risk_level,
          expires_at: event.data.expires_at } }];
    case 'tool_undo_available':
      return [{ ...common, type: 'tool', status: 'completed', collapsed: true,
        tool_call_id: event.data.tool_call_id, execution_id: event.data.execution_id,
        payload: { tool: event.data.tool, undo_available: true } }];
    case 'candidate':
      return event.data.candidate_refs.map((ref) => ({ ...common,
        id: chatItemIds.candidate(ref.id), type: 'candidate', status: 'pending', collapsed: true,
        candidate_id: ref.id, payload: { candidate_id: ref.id, kind: ref.kind,
          batch_ref: event.data.batch_ref,
          preview: { summary: event.data.safe_summary,
            candidate_count: event.data.candidate_count,
            risk_level: event.data.risk_level },
          applied: false, source_refs: [ref], risk: event.data.risk_level } } as ChatItem));
    case 'reminder':
      return [{ ...common, type: 'reminder', status: 'pending', collapsed: true,
        payload: { reminder_id: event.data.reminder_instance_id, title: '提醒' } }];
    case 'summary':
      return [{ ...common, type: 'summary', status: 'completed', collapsed: true,
        payload: { content: '摘要已生成', period: event.data.summary_kind } }];
    case 'error':
      return [{ ...common, type: 'error', status: 'failed', collapsed: true,
        payload: { code: event.data.code, message: event.data.message } }];
    case 'task_state':
      if (!event.task_id) return [];
      return [{ ...common, id: chatItemIds.taskRuntime(event.task_id), type: 'runtime',
        status: taskStateToChatItemStatus(event.data.state), collapsed: true,
        payload: { state: event.data.state, detail: event.data.message } }];
    default:
      return [];
  }
}
