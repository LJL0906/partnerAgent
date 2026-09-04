import { randomUUID } from 'node:crypto';
import type { StoredSession } from '../database/session-store.js';
import type {
  AcceptedChatTask,
  SessionMessageView,
  StoredChatTask,
} from './chat-task.store.js';

export function memoryTaskKey(ownerId: string, id: string) {
  return `${ownerId}:${id}`;
}

export function copyStoredChatTask(task: StoredChatTask): StoredChatTask {
  return {
    ...task,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
    ...(task.startedAt ? { startedAt: new Date(task.startedAt) } : {}),
    ...(task.completedAt ? { completedAt: new Date(task.completedAt) } : {}),
    ...(task.leaseOwner ? { leaseOwner: task.leaseOwner } : {}),
    ...(task.leaseExpiresAt
      ? { leaseExpiresAt: new Date(task.leaseExpiresAt) }
      : {}),
  };
}

export function memoryChatTaskResult(
  operationId: string,
  task: AcceptedChatTask,
  messageId: string,
  recordId: string,
  status: string,
) {
  return {
    operation_id: operationId,
    status,
    resource_refs: [
      { kind: 'session', id: task.sessionId },
      { kind: 'chat_message', id: messageId },
      { kind: 'original_record', id: recordId },
    ],
    task_refs: [{ task_id: task.taskId, kind: 'chat_response' }],
    data: {
      session_id: task.sessionId,
      message_ref: { kind: 'chat_message', id: messageId },
      original_record: { kind: 'original_record', id: recordId },
      chat_task: { task_id: task.taskId, kind: 'chat_response' },
    },
  };
}

export function hasRunningChatTask(
  tasks: Iterable<StoredChatTask>,
  sessionId: string,
) {
  return [...tasks].some(
    (task) => task.sessionId === sessionId && task.state === 'running',
  );
}

export function hasBlockingChatTask(
  tasks: Iterable<StoredChatTask>,
  sessionId: string,
) {
  return [...tasks].some(
    (task) =>
      task.sessionId === sessionId &&
      ['running', 'waiting_privacy_decision', 'waiting_tool_approval'].includes(
        task.state,
      ),
  );
}

export function toolConfirmationIdFromLeaseOwner(leaseOwner?: string) {
  if (!leaseOwner?.startsWith('tool-decision:')) return undefined;
  return leaseOwner.slice(leaseOwner.lastIndexOf(':') + 1);
}

export function memoryMessageId(
  messageIds: Map<string, string>,
  sessionId: string,
  sequence: number,
) {
  const key = `${sessionId}:${sequence}`;
  const id = messageIds.get(key) ?? randomUUID();
  messageIds.set(key, id);
  return id;
}

export function memorySessionMessageViews(
  session: StoredSession | undefined,
  messageIds: Map<string, string>,
): SessionMessageView[] {
  return (
    session?.messages.map((message) => ({
      id: memoryMessageId(messageIds, session.id, message.sequence),
      role: message.role,
      content: message.content,
      created_at: new Date(message.timestamp).toISOString(),
    })) ?? []
  );
}

export function failWaitingPrivacyTask(
  tasks: Map<string, StoredChatTask>,
  taskId: string,
  ownerId: string,
  code: string,
  message: string,
) {
  const task = tasks.get(taskId);
  if (
    !task ||
    task.ownerId !== ownerId ||
    task.state !== 'waiting_privacy_decision'
  ) {
    return undefined;
  }
  task.state = 'failed';
  task.errorCode = code;
  task.errorMessage = message;
  task.completedAt = new Date();
  task.updatedAt = task.completedAt;
  return copyStoredChatTask(task);
}
