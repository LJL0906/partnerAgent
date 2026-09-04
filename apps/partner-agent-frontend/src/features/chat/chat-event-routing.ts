import type { ServerPushEventV1, SubscriptionChannel } from '@partner-agent/contracts';

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
