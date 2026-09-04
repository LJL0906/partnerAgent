import type { CommandEnvelopeBody } from './local-core-api.types.js';
import type { ChatTaskState } from '../database/entities/chat-task.entity.js';

export interface SubmitTextCommand {
  ownerId: string;
  operationId: string;
  requestFingerprint: string;
  clientSource: string;
  text: string;
  inputId: string;
  sessionId?: string;
}

export interface AcceptedChatTask {
  taskId: string;
  ownerId: string;
  sessionId: string;
  operationId: string;
  inputId: string;
  text: string;
}

export interface StoredChatTask extends AcceptedChatTask {
  state: ChatTaskState;
  originalRecordId: string;
  userMessageId: string;
  resultMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface SessionMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export class ChatTaskConflictError extends Error {}

export abstract class ChatTaskStore {
  abstract submitText(command: SubmitTextCommand): Promise<{
    result: Record<string, unknown>;
    task?: AcceptedChatTask;
  }>;
  abstract cancelTask(
    ownerId: string,
    envelope: CommandEnvelopeBody,
  ): Promise<{ result: Record<string, unknown>; task?: StoredChatTask }>;
  abstract getTask(
    ownerId: string,
    taskId: string,
  ): Promise<StoredChatTask | undefined>;
  abstract ownsTask(ownerId: string, taskId: string): Promise<boolean>;
  abstract ownsOperation(
    ownerId: string,
    operationId: string,
  ): Promise<boolean>;
  abstract markRunning(taskId: string, ownerId: string): Promise<boolean>;
  abstract markWaiting(taskId: string, ownerId: string): Promise<boolean>;
  abstract markCompleted(
    taskId: string,
    ownerId: string,
  ): Promise<StoredChatTask | undefined>;
  abstract markFailed(
    taskId: string,
    ownerId: string,
    code: string,
    message: string,
  ): Promise<StoredChatTask | undefined>;
  abstract listSessionMessages(
    ownerId: string,
    sessionId: string,
  ): Promise<SessionMessageView[]>;
}
