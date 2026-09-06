import {
  parseChatPreviewsV1,
  type ChatPreviewV1,
  type ChatOutputMode,
  type ChatPreviewKind,
  type ChatSessionTaskRef,
  type ReasoningLevel,
  type SessionMessageDto,
  type TaskState,
} from '@partner-agent/contracts';
import type { CommandEnvelopeBody } from './local-core-api.types.js';
import type { TypeOrmChatTaskLifecycleOutbox } from './chat-task-lifecycle-outbox.js';

export interface SubmitTextCommand {
  ownerId: string;
  operationId: string;
  requestFingerprint: string;
  clientSource: string;
  text: string;
  inputId: string;
  sessionId?: string;
  modelConfigId?: string;
  reasoningLevel?: ReasoningLevel;
  outputMode?: ChatOutputMode;
  previewKind?: ChatPreviewKind;
}

export interface RejectInputAnalysisCommand {
  ownerId: string;
  operationId: string;
  requestFingerprint: string;
  requestedTypes: string[];
}

export interface IdempotentCommand {
  ownerId: string;
  operationId: string;
  requestFingerprint: string;
  commandName: string;
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
  modelConfigId: string;
  reasoningLevel: ReasoningLevel;
  outputMode: ChatOutputMode;
  previewKind?: ChatPreviewKind;
  originalRecordId: string;
  userMessageId: string;
}

export interface StoredChatTask extends AcceptedChatTask {
  state: TaskState;
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

export function parseAssistantCompletionPreviews(
  task: Pick<StoredChatTask, 'outputMode' | 'previewKind'>,
  value: unknown,
): ChatPreviewV1[] | undefined {
  if (task.outputMode === 'chat') {
    return Array.isArray(value) && value.length === 0 ? [] : undefined;
  }
  if (task.outputMode !== 'structured_preview' || task.previewKind !== 'action') {
    return undefined;
  }
  try {
    const previews = parseChatPreviewsV1(value);
    return previews.every((preview) => preview.kind === task.previewKind)
      ? previews
      : undefined;
  } catch {
    return undefined;
  }
}

export type SessionMessageView = SessionMessageDto;

export interface AssistantProgressCommand {
  ownerId: string;
  sessionId: string;
  taskId: string;
  operationId: string;
  leaseToken: string;
  expectedRevision: number;
  textOffset: number;
  delta: string;
}

export interface AssistantCompletionCommand {
  ownerId: string;
  sessionId: string;
  taskId: string;
  operationId: string;
  leaseToken: string;
  expectedRevision: number;
  content: string;
  chatPreviews: ChatPreviewV1[];
  contextMessages: unknown[];
}

export type AssistantWriteResult =
  | { outcome: 'committed'; message: SessionMessageDto; textOffset: number }
  | { outcome: 'conflict' | 'fence_rejected' };

export type AssistantCompletionResult =
  | { outcome: 'committed' | 'already_completed'; task: StoredChatTask; message: SessionMessageDto }
  | { outcome: 'conflict' | 'fence_rejected' };

export interface StoredChatPreviewAttachment {
  session_id: string;
  task_id: string;
  operation_id: string;
  message_id: string;
  message_revision: number;
  preview: ChatPreviewV1;
}

export class ChatTaskConflictError extends Error {}

export abstract class ChatTaskStore {
  readonly lifecycleOutbox?: TypeOrmChatTaskLifecycleOutbox;
  abstract rejectInputAnalysis(
    command: RejectInputAnalysisCommand,
  ): Promise<Record<string, unknown>>;
  abstract executeIdempotentCommand<T extends Record<string, unknown>>(
    command: IdempotentCommand,
    execute: () => Promise<T>,
  ): Promise<T>;
  abstract submitText(command: SubmitTextCommand): Promise<{
    result: Record<string, unknown>;
    task?: AcceptedChatTask;
  }>;
  abstract cancelTask(
    ownerId: string,
    envelope: CommandEnvelopeBody,
  ): Promise<{ result: Record<string, unknown>; task?: StoredChatTask }>;
  abstract getSessionTaskRefs(
    ownerId: string,
    sessionId: string,
  ): Promise<{
    active_task?: ChatSessionTaskRef;
    latest_task?: ChatSessionTaskRef;
  }>;
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
  abstract countRunnable(limit?: number): Promise<number>;
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
    lifecycleData?: Record<string, unknown>,
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
  abstract appendAssistantProgress(
    command: AssistantProgressCommand,
  ): Promise<AssistantWriteResult>;
  abstract completeAssistantOutput(
    command: AssistantCompletionCommand,
  ): Promise<AssistantCompletionResult>;
  abstract listSessionMessages(
    ownerId: string,
    sessionId: string,
  ): Promise<SessionMessageView[]>;
  abstract listSessionChatPreviews(
    ownerId: string,
    sessionId: string,
  ): Promise<StoredChatPreviewAttachment[]>;
}
