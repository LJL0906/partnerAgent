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

export interface RejectInputAnalysisCommand {
  ownerId: string;
  operationId: string;
  requestFingerprint: string;
  requestedTypes: string[];
}

export const INPUT_ANALYSIS_REJECTION_COMMAND =
  'SubmitTextInput:input-analysis';

export function inputAnalysisNotImplementedResult(
  command: RejectInputAnalysisCommand,
) {
  return {
    code: 'NOT_IMPLEMENTED_001',
    message: 'input_analysis 尚未实现',
    details: {
      feature: 'input_analysis',
      requested_types: [...command.requestedTypes],
      operation_id: command.operationId,
    },
  };
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
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  attemptCount: number;
  waitingToolConfirmationId?: string;
}

export interface SessionMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export class ChatTaskConflictError extends Error {}

export abstract class ChatTaskStore {
  abstract rejectInputAnalysis(
    command: RejectInputAnalysisCommand,
  ): Promise<Record<string, unknown>>;
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
  abstract listWaitingPrivacyTasks(): Promise<StoredChatTask[]>;
  abstract failWaitingPrivacyDecision(
    taskId: string,
    ownerId: string,
    code: string,
    message: string,
  ): Promise<StoredChatTask | undefined>;
  abstract markRunning(taskId: string, ownerId: string): Promise<boolean>;
  abstract recoverExpiredLeases(now?: Date): Promise<number>;
  abstract claimNextRunnable(
    leaseOwner: string,
    leaseDurationMs: number,
  ): Promise<StoredChatTask | undefined>;
  abstract renewLease(
    taskId: string,
    ownerId: string,
    leaseOwner: string,
    leaseDurationMs: number,
  ): Promise<boolean>;
  abstract releaseLeases(leaseOwner: string): Promise<number>;
  abstract claimPrivacyResume(
    taskId: string,
    ownerId: string,
  ): Promise<StoredChatTask | undefined>;
  abstract claimToolResume(
    taskId: string,
    ownerId: string,
    confirmationId: string,
    leaseOwner: string,
    leaseDurationMs: number,
  ): Promise<StoredChatTask | undefined>;
  abstract markWaiting(
    taskId: string,
    ownerId: string,
    leaseOwner?: string,
  ): Promise<boolean>;
  abstract markWaitingToolApproval(
    taskId: string,
    ownerId: string,
    confirmationId: string,
    leaseOwner?: string,
  ): Promise<boolean>;
  abstract failWaitingToolApproval(
    taskId: string,
    ownerId: string,
    confirmationId: string,
    code: string,
    message: string,
  ): Promise<StoredChatTask | undefined>;
  abstract markCompleted(
    taskId: string,
    ownerId: string,
    leaseOwner?: string,
  ): Promise<StoredChatTask | undefined>;
  abstract markFailed(
    taskId: string,
    ownerId: string,
    code: string,
    message: string,
    leaseOwner?: string,
  ): Promise<StoredChatTask | undefined>;
  abstract listSessionMessages(
    ownerId: string,
    sessionId: string,
  ): Promise<SessionMessageView[]>;
}
