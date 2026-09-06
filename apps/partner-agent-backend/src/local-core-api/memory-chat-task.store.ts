import { memorySessionTaskRefs } from './session-task-reference.js';
import { randomUUID } from 'node:crypto';
import { SessionStore } from '../database/session-store.js';
import {
  ChatTaskConflictError,
  ChatTaskStore,
  INPUT_ANALYSIS_REJECTION_COMMAND,
  inputAnalysisNotImplementedResult,
  parseAssistantCompletionPreviews,
  type RejectInputAnalysisCommand,
  type AssistantCompletionCommand,
  type AssistantProgressCommand,
  type IdempotentCommand,
  type StoredChatTask,
  type SubmitTextCommand,
} from './chat-task.store.js';
import { recoverChatPreviewsV1 } from '@partner-agent/contracts';
import type { CommandEnvelopeBody } from './local-core-api.types.js';
import type { EntityManager } from 'typeorm';
import {
  copyStoredChatTask,
  countRunnableChatTasks,
  failWaitingPrivacyTask,
  hasBlockingChatTask,
  hasRunningChatTask,
  memoryChatTaskResult,
  memoryMessageId,
  memorySessionMessageViews,
  memoryTaskKey,
  toolConfirmationIdFromLeaseOwner,
} from './memory-chat-task-helpers.js';

export class MemoryChatTaskStore extends ChatTaskStore {
  private readonly operations = new Map<
    string,
    {
      commandName: string;
      fingerprint: string;
      result: Record<string, unknown>;
    }
  >();
  private readonly inputs = new Map<
    string,
    { fingerprint: string; taskId: string }
  >();
  private readonly tasks = new Map<string, StoredChatTask>();
  private readonly messageIds = new Map<string, string>();

  constructor(
    private readonly sessions: SessionStore,
    private readonly maxSessionsPerUser = 100,
  ) {
    super();
  }

  async executeIdempotentCommand<T extends Record<string, unknown>>(
    command: IdempotentCommand,
    execute: (manager?: EntityManager) => Promise<T>,
  ): Promise<T> {
    const operationKey = memoryTaskKey(command.ownerId, command.operationId);
    const prior = this.operations.get(operationKey);
    if (prior) {
      if (
        prior.commandName !== command.commandName ||
        prior.fingerprint !== command.requestFingerprint
      ) throw new ChatTaskConflictError();
      return structuredClone(prior.result) as T;
    }
    const result = await execute(undefined);
    this.operations.set(operationKey, {
      commandName: command.commandName,
      fingerprint: command.requestFingerprint,
      result: structuredClone(result),
    });
    return result;
  }

  async rejectInputAnalysis(command: RejectInputAnalysisCommand) {
    const operationKey = memoryTaskKey(command.ownerId, command.operationId);
    const prior = this.operations.get(operationKey);
    if (prior) {
      if (
        prior.commandName !== INPUT_ANALYSIS_REJECTION_COMMAND ||
        prior.fingerprint !== command.requestFingerprint
      )
        throw new ChatTaskConflictError();
      return { ...prior.result };
    }
    const result = inputAnalysisNotImplementedResult(command);
    this.operations.set(operationKey, {
      commandName: INPUT_ANALYSIS_REJECTION_COMMAND,
      fingerprint: command.requestFingerprint,
      result,
    });
    return { ...result };
  }

  async submitText(command: SubmitTextCommand) {
    const operationKey = memoryTaskKey(command.ownerId, command.operationId);
    const priorOperation = this.operations.get(operationKey);
    if (priorOperation) {
      if (
        priorOperation.commandName !== 'SubmitTextInput' ||
        priorOperation.fingerprint !== command.requestFingerprint
      )
        throw new ChatTaskConflictError();
      return { result: { ...priorOperation.result, status: 'duplicate' } };
    }

    const inputKey = memoryTaskKey(command.ownerId, command.inputId);
    const priorInput = this.inputs.get(inputKey);
    if (priorInput) {
      if (priorInput.fingerprint !== command.requestFingerprint)
        throw new ChatTaskConflictError();
      const priorTask = this.tasks.get(priorInput.taskId)!;
      const result = memoryChatTaskResult(
        command.operationId,
        priorTask,
        priorTask.userMessageId,
        priorTask.originalRecordId,
        'duplicate',
      );
      this.operations.set(operationKey, {
        commandName: 'SubmitTextInput',
        fingerprint: command.requestFingerprint,
        result,
      });
      return { result };
    }

    const sessionId = command.sessionId ?? randomUUID();
    const existing = await this.sessions.find(sessionId);
    if (existing && existing.ownerId !== command.ownerId)
      return Promise.reject(new Error('AUTH_002'));
    if (!existing)
      await this.sessions.createIfAllowed(
        sessionId,
        command.ownerId,
        this.maxSessionsPerUser,
      );
    await this.sessions.appendMessage(
      sessionId,
      command.ownerId,
      'user',
      command.text,
    );
    const session = await this.sessions.find(sessionId, command.ownerId);
    const sequence = session?.messages.at(-1)?.sequence ?? 1;
    const messageId = session?.messages.at(-1)?.id ?? randomUUID();
    this.messageIds.set(`${sessionId}:${sequence}`, messageId);
    const now = new Date();
    const task: StoredChatTask = {
      taskId: randomUUID(),
      ownerId: command.ownerId,
      sessionId,
      operationId: command.operationId,
      inputId: command.inputId,
      modelConfigId: command.modelConfigId ?? `${process.env.DEFAULT_PROVIDER ?? 'deepseek'}:${process.env.DEFAULT_MODEL ?? ''}`,
      reasoningLevel: command.reasoningLevel ?? 'medium',
      outputMode: command.outputMode ?? 'chat',
      ...(command.previewKind ? { previewKind: command.previewKind } : {}),
      text: command.text,
      state: 'queued',
      revision: 1,
      originalRecordId: randomUUID(),
      userMessageId: messageId,
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
    };
    const result = memoryChatTaskResult(
      command.operationId,
      task,
      messageId,
      task.originalRecordId,
      'accepted',
    );
    this.tasks.set(task.taskId, task);
    this.inputs.set(inputKey, {
      fingerprint: command.requestFingerprint,
      taskId: task.taskId,
    });
    this.operations.set(operationKey, {
      commandName: 'SubmitTextInput',
      fingerprint: command.requestFingerprint,
      result,
    });
    return { result, task: copyStoredChatTask(task) };
  }

  async cancelTask(ownerId: string, envelope: CommandEnvelopeBody) {
    const operationId = String(envelope.operation_id);
    const fingerprint = String(envelope.request_fingerprint);
    const operationKey = memoryTaskKey(ownerId, operationId);
    const prior = this.operations.get(operationKey);
    if (prior) {
      if (
        prior.commandName !== 'CancelTask' ||
        prior.fingerprint !== fingerprint
      )
        throw new ChatTaskConflictError();
      return { result: { ...prior.result, status: 'duplicate' } };
    }
    const taskId = String(
      (envelope.payload as Record<string, unknown>).task_id,
    );
    const task = this.tasks.get(taskId);
    if (!task || task.ownerId !== ownerId) throw new Error('AUTH_002');
    if (!['completed', 'failed', 'cancelled'].includes(task.state)) {
      task.state = 'cancelled';
      task.revision += 1;
      delete task.leaseOwner;
      delete task.leaseExpiresAt;
      delete task.waitingToolConfirmationId;
      task.completedAt = new Date();
      task.updatedAt = task.completedAt;
    }
    const result = {
      operation_id: operationId,
      status: 'completed',
      task_refs: [{ task_id: taskId, kind: 'chat_response' }],
      data: { task_id: taskId, state: task.state },
    };
    this.operations.set(operationKey, {
      commandName: 'CancelTask',
      fingerprint,
      result,
    });
    return { result, task: copyStoredChatTask(task) };
  }

  async getSessionTaskRefs(ownerId: string, sessionId: string) {
    return memorySessionTaskRefs(this.tasks.values(), ownerId, sessionId);
  }

  async getTask(ownerId: string, taskId: string) {
    const task = this.tasks.get(taskId);
    return task?.ownerId === ownerId ? copyStoredChatTask(task) : undefined;
  }
  async ownsTask(ownerId: string, taskId: string) {
    return Boolean(await this.getTask(ownerId, taskId));
  }
  async ownsOperation(ownerId: string, operationId: string) {
    return this.operations.has(memoryTaskKey(ownerId, operationId));
  }
  async listWaitingPrivacyTasks() {
    return [...this.tasks.values()]
      .filter((task) => task.state === 'waiting_privacy_decision')
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      )
      .map((task) => copyStoredChatTask(task));
  }
  async failWaitingPrivacyDecision(
    taskId: string,
    ownerId: string,
    code: string,
    message: string,
  ) {
    return failWaitingPrivacyTask(this.tasks, taskId, ownerId, code, message);
  }
  async markRunning(taskId: string, ownerId: string) {
    const task = this.tasks.get(taskId);
    if (
      !task ||
      task.ownerId !== ownerId ||
      task.state !== 'queued' ||
      hasBlockingChatTask(this.tasks.values(), task.sessionId)
    )
      return false;
    task.state = 'running';
    task.revision += 1;
    delete task.waitingToolConfirmationId;
    task.leaseOwner = 'legacy-direct-claim';
    task.leaseExpiresAt = new Date(Date.now() + 30_000);
    task.attemptCount += 1;
    task.startedAt = new Date();
    task.updatedAt = task.startedAt;
    return true;
  }
  async recoverExpiredLeases(now = new Date()) {
    let recovered = 0;
    for (const task of this.tasks.values()) {
      if (
        task.state === 'running' &&
        (!task.leaseExpiresAt || task.leaseExpiresAt.getTime() <= now.getTime())
      ) {
        task.state = task.leaseOwner?.startsWith('tool-decision:')
          ? 'waiting_tool_approval'
          : 'queued';
        task.revision += 1;
        task.waitingToolConfirmationId = toolConfirmationIdFromLeaseOwner(
          task.leaseOwner,
        );
        delete task.leaseOwner;
        delete task.leaseExpiresAt;
        task.updatedAt = new Date(now);
        recovered += 1;
      }
    }
    return recovered;
  }
  async claimNextRunnable(leaseOwner: string, leaseDurationMs: number) {
    await this.recoverExpiredLeases();
    const task = [...this.tasks.values()]
      .filter(
        (candidate) =>
          candidate.state === 'queued' &&
          !hasBlockingChatTask(this.tasks.values(), candidate.sessionId),
      )
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      )[0];
    if (!task) return undefined;
    const now = new Date();
    task.state = 'running';
    task.revision += 1;
    delete task.waitingToolConfirmationId;
    task.leaseOwner = leaseOwner;
    task.leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
    task.attemptCount += 1;
    task.startedAt ??= now;
    task.updatedAt = now;
    return copyStoredChatTask(task);
  }
  async countRunnable(limit = 10_000) {
    return countRunnableChatTasks(this.tasks, limit);
  }
  async renewLease(
    taskId: string,
    ownerId: string,
    leaseOwner: string,
    leaseDurationMs: number,
  ) {
    const task = this.tasks.get(taskId);
    if (
      !task ||
      task.ownerId !== ownerId ||
      task.state !== 'running' ||
      task.leaseOwner !== leaseOwner ||
      !task.leaseExpiresAt ||
      task.leaseExpiresAt.getTime() <= Date.now()
    ) {
      return false;
    }
    task.leaseExpiresAt = new Date(Date.now() + leaseDurationMs);
    return true;
  }

  async releaseLeases(leaseOwner: string) {
    let released = 0;
    for (const task of this.tasks.values()) {
      if (task.state !== 'running' || task.leaseOwner !== leaseOwner) continue;
      task.state = leaseOwner.startsWith('tool-decision:')
        ? 'waiting_tool_approval'
        : 'queued';
      task.revision += 1;
      task.waitingToolConfirmationId =
        toolConfirmationIdFromLeaseOwner(leaseOwner);
      delete task.leaseOwner;
      delete task.leaseExpiresAt;
      task.updatedAt = new Date();
      released += 1;
    }
    return released;
  }

  async claimPrivacyResume(taskId: string, ownerId: string) {
    return this.claimWaitingTask(taskId, ownerId, 'waiting_privacy_decision');
  }

  private claimWaitingTask(
    taskId: string,
    ownerId: string,
    waitingState: 'waiting_privacy_decision' | 'waiting_tool_approval',
  ) {
    const task = this.tasks.get(taskId);
    if (!task || task.ownerId !== ownerId || task.state !== waitingState) {
      return undefined;
    }
    task.state = 'queued';
    task.revision += 1;
    delete task.waitingToolConfirmationId;
    task.updatedAt = new Date();
    return copyStoredChatTask(task);
  }

  async claimToolResume(
    taskId: string,
    ownerId: string,
    confirmationId: string,
    leaseOwner: string,
    leaseDurationMs: number,
  ) {
    const task = this.tasks.get(taskId);
    if (
      !task ||
      task.ownerId !== ownerId ||
      task.state !== 'waiting_tool_approval' ||
      task.waitingToolConfirmationId !== confirmationId ||
      hasRunningChatTask(this.tasks.values(), task.sessionId)
    ) {
      return undefined;
    }
    const now = new Date();
    task.state = 'running';
    task.revision += 1;
    delete task.waitingToolConfirmationId;
    task.leaseOwner = leaseOwner;
    task.leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
    task.attemptCount += 1;
    task.startedAt ??= now;
    task.updatedAt = now;
    return copyStoredChatTask(task);
  }
  async markWaiting(taskId: string, ownerId: string, leaseOwner?: string) {
    return this.markWaitingState(
      taskId,
      ownerId,
      'waiting_privacy_decision',
      undefined,
      leaseOwner,
    );
  }

  async markWaitingToolApproval(
    taskId: string,
    ownerId: string,
    confirmationId: string,
    leaseOwner?: string,
  ) {
    return this.markWaitingState(
      taskId,
      ownerId,
      'waiting_tool_approval',
      confirmationId,
      leaseOwner,
    );
  }

  private markWaitingState(
    taskId: string,
    ownerId: string,
    state: 'waiting_privacy_decision' | 'waiting_tool_approval',
    confirmationId: string | undefined,
    leaseOwner?: string,
  ) {
    const task = this.tasks.get(taskId);
    if (
      !task ||
      task.ownerId !== ownerId ||
      task.state !== 'running' ||
      (leaseOwner !== undefined && task.leaseOwner !== leaseOwner)
    ) {
      return false;
    }
    task.state = state;
    task.revision += 1;
    task.waitingToolConfirmationId = confirmationId;
    delete task.leaseOwner;
    delete task.leaseExpiresAt;
    task.updatedAt = new Date();
    return true;
  }

  async failWaitingToolApproval(
    taskId: string,
    ownerId: string,
    confirmationId: string,
    code: string,
    message: string,
  ) {
    const task = this.tasks.get(taskId);
    if (
      !task ||
      task.ownerId !== ownerId ||
      task.state !== 'waiting_tool_approval' ||
      task.waitingToolConfirmationId !== confirmationId
    ) {
      return undefined;
    }
    task.state = 'failed';
    task.revision += 1;
    delete task.waitingToolConfirmationId;
    task.errorCode = code;
    task.errorMessage = message;
    task.completedAt = new Date();
    task.updatedAt = task.completedAt;
    return copyStoredChatTask(task);
  }

  async markCompleted(taskId: string, ownerId: string, leaseOwner?: string) {
    const task = this.tasks.get(taskId);
    if (!task || task.ownerId !== ownerId) return undefined;
    if (
      ['completed', 'failed', 'cancelled'].includes(task.state) ||
      (leaseOwner !== undefined &&
        (task.state !== 'running' || task.leaseOwner !== leaseOwner ||
          !task.leaseExpiresAt || task.leaseExpiresAt.getTime() <= Date.now()))
    ) {
      return ['completed', 'failed', 'cancelled'].includes(task.state)
        ? copyStoredChatTask(task)
        : undefined;
    }
    const session = await this.sessions.find(task.sessionId, ownerId);
    const last = session?.messages.at(-1);
    if (last?.role === 'assistant')
      task.resultMessageId = memoryMessageId(
        this.messageIds,
        task.sessionId,
        last.sequence,
      );
    task.state = 'completed';
    task.revision += 1;
    delete task.waitingToolConfirmationId;
    delete task.leaseOwner;
    delete task.leaseExpiresAt;
    task.completedAt = new Date();
    task.updatedAt = task.completedAt;
    return copyStoredChatTask(task);
  }
  async markFailed(
    taskId: string,
    ownerId: string,
    code: string,
    message: string,
    leaseOwner?: string,
  ) {
    const task = this.tasks.get(taskId);
    if (!task || task.ownerId !== ownerId) return undefined;
    if (
      ['completed', 'failed', 'cancelled'].includes(task.state) ||
      (leaseOwner !== undefined &&
        (task.state !== 'running' || task.leaseOwner !== leaseOwner ||
          !task.leaseExpiresAt || task.leaseExpiresAt.getTime() <= Date.now()))
    ) {
      return ['completed', 'failed', 'cancelled'].includes(task.state)
        ? copyStoredChatTask(task)
        : undefined;
    }
    task.state = 'failed';
    task.revision += 1;
    delete task.waitingToolConfirmationId;
    delete task.leaseOwner;
    delete task.leaseExpiresAt;
    task.errorCode = code;
    task.errorMessage = message;
    task.completedAt = new Date();
    task.updatedAt = task.completedAt;
    return copyStoredChatTask(task);
  }

  async appendAssistantProgress(command: AssistantProgressCommand) {
    const task = this.tasks.get(command.taskId);
    if (!this.hasCurrentLease(task, command)) return { outcome: 'fence_rejected' as const };
    const session = await this.sessions.find(command.sessionId, command.ownerId);
    const existing = session?.messages.find(
      (message) => message.role === 'assistant' && message.taskId === task.taskId,
    );
    const revision = existing?.revision ?? 0;
    const content = existing?.content ?? '';
    if (
      command.expectedRevision !== revision ||
      command.textOffset !== content.length ||
      command.delta.length === 0
    ) return { outcome: 'conflict' as const };
    const messageId = existing?.id ?? task.resultMessageId ?? randomUUID();
    const written = await this.sessions.saveTaskAssistantMessage(
      task.sessionId,
      task.ownerId,
      {
        id: messageId,
        taskId: task.taskId,
        operationId: task.operationId,
        modelConfigId: task.modelConfigId,
        reasoningLevel: task.reasoningLevel,
        content: content + command.delta,
        status: 'streaming',
        revision: revision + 1,
      },
    );
    task.resultMessageId = messageId;
    task.updatedAt = new Date();
    return {
      outcome: 'committed' as const,
      textOffset: command.textOffset,
      message: this.messageDto(task, written.sequence, written.createdAt, {
        id: messageId,
        content: content + command.delta,
        status: 'streaming',
        revision: revision + 1,
      }),
    };
  }

  async completeAssistantOutput(command: AssistantCompletionCommand) {
    const task = this.tasks.get(command.taskId);
    if (!task || task.ownerId !== command.ownerId || task.sessionId !== command.sessionId || task.operationId !== command.operationId) {
      return { outcome: 'fence_rejected' as const };
    }
    if (task.state === 'completed' && task.resultMessageId) {
      const session = await this.sessions.find(task.sessionId, task.ownerId);
      const existing = session?.messages.find((message) => message.id === task.resultMessageId);
      if (!existing) return { outcome: 'conflict' as const };
      const existingId = existing.id ?? task.resultMessageId;
      existing.id = existingId;
      return {
        outcome: 'already_completed' as const,
        task: copyStoredChatTask(task),
        message: this.messageDto(task, existing.sequence, new Date(existing.timestamp), {
          id: existingId,
          content: existing.content,
          status: 'complete',
          revision: existing.revision ?? 1,
        }),
      };
    }
    if (!this.hasCurrentLease(task, command)) return { outcome: 'fence_rejected' as const };
    const session = await this.sessions.find(task.sessionId, task.ownerId);
    const existing = session?.messages.find(
      (message) => message.role === 'assistant' && message.taskId === task.taskId,
    );
    if (command.expectedRevision !== (existing?.revision ?? 0)) {
      return { outcome: 'conflict' as const };
    }
    const previewValidation = parseAssistantCompletionPreviews(
      task,
      command.chatPreviews,
    );
    if (!previewValidation.valid) {
      return {
        outcome: 'invalid_output' as const,
        code: previewValidation.code,
        message: previewValidation.message,
      };
    }
    const { previews } = previewValidation;
    const messageId = existing?.id ?? task.resultMessageId ?? randomUUID();
    const revision = (existing?.revision ?? 0) + 1;
    const written = await this.sessions.saveTaskAssistantMessage(task.sessionId, task.ownerId, {
      id: messageId,
      taskId: task.taskId,
      operationId: task.operationId,
      modelConfigId: task.modelConfigId,
      reasoningLevel: task.reasoningLevel,
      content: command.content,
      status: 'complete',
      revision,
      ...(previews.length ? { metadata: { chat_previews: previews } } : {}),
    });
    await this.sessions.saveContextSnapshot(
      task.sessionId,
      task.ownerId,
      command.contextMessages,
      written.sequence,
    );
    task.resultMessageId = messageId;
    task.state = 'completed';
    task.revision += 1;
    delete task.waitingToolConfirmationId;
    delete task.leaseOwner;
    delete task.leaseExpiresAt;
    task.completedAt = new Date();
    task.updatedAt = task.completedAt;
    return {
      outcome: 'committed' as const,
      task: copyStoredChatTask(task),
      message: this.messageDto(task, written.sequence, written.createdAt, {
        id: messageId,
        content: command.content,
        status: 'complete',
        revision,
      }),
    };
  }

  async listSessionMessages(ownerId: string, sessionId: string) {
    const session = await this.sessions.find(sessionId, ownerId);
    return memorySessionMessageViews(session, this.messageIds);
  }

  async listSessionChatPreviews(ownerId: string, sessionId: string) {
    const session = await this.sessions.find(sessionId, ownerId);
    if (!session) return [];
    const seenPreviewIds = new Set<string>();
    return session.messages.flatMap((message) => {
      const messageId = message.id;
      if (message.role !== 'assistant' || !messageId || !message.taskId || !message.operationId) return [];
      const taskId = message.taskId;
      const operationId = message.operationId;
      const previews = message.metadata?.chat_previews;
      if (!Array.isArray(previews)) return [];
      return recoverChatPreviewsV1(previews).flatMap((preview) => {
        if (seenPreviewIds.has(preview.preview_id)) return [];
        seenPreviewIds.add(preview.preview_id);
        return [{
          session_id: sessionId,
          task_id: taskId,
          operation_id: operationId,
          message_id: messageId,
          message_revision: message.revision ?? 1,
          preview,
        }];
      });
    });
  }

  private hasCurrentLease(
    task: StoredChatTask | undefined,
    command: { ownerId: string; sessionId: string; operationId: string; leaseToken: string },
  ): task is StoredChatTask {
    return Boolean(
      task && task.ownerId === command.ownerId && task.sessionId === command.sessionId &&
      task.operationId === command.operationId && task.state === 'running' &&
      task.leaseOwner === command.leaseToken && task.leaseExpiresAt &&
      task.leaseExpiresAt.getTime() > Date.now(),
    );
  }

  private messageDto(
    task: StoredChatTask,
    sequence: number,
    createdAt: Date,
    message: { id: string; content: string; status: 'streaming' | 'complete'; revision: number },
  ) {
    return {
      id: message.id,
      session_id: task.sessionId,
      sequence,
      role: 'assistant' as const,
      content: message.content,
      status: message.status,
      revision: message.revision,
      task_id: task.taskId,
      operation_id: task.operationId,
      model_config_id: task.modelConfigId,
      reasoning_level: task.reasoningLevel,
      created_at: createdAt.toISOString(),
    };
  }
}
