import type { ChatTaskEntity } from '../database/entities/chat-task.entity.js';
import type { StoredChatTask } from './chat-task.store.js';

export function toStoredChatTask(
  task: ChatTaskEntity,
  text: string,
): StoredChatTask {
  return {
    taskId: task.id,
    ownerId: task.ownerId,
    sessionId: task.sessionId,
    operationId: task.operationId,
    inputId: task.inputId,
    text,
    state: task.state,
    originalRecordId: task.originalRecordId,
    userMessageId: task.userMessageId,
    ...(task.resultMessageId ? { resultMessageId: task.resultMessageId } : {}),
    ...(task.errorCode ? { errorCode: task.errorCode } : {}),
    ...(task.errorMessage ? { errorMessage: task.errorMessage } : {}),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    ...(task.leaseOwner ? { leaseOwner: task.leaseOwner } : {}),
    ...(task.leaseExpiresAt ? { leaseExpiresAt: task.leaseExpiresAt } : {}),
    attemptCount: task.attemptCount,
    ...(task.waitingToolConfirmationId
      ? { waitingToolConfirmationId: task.waitingToolConfirmationId }
      : {}),
  };
}
