import { randomUUID } from 'node:crypto';
import { SessionStore } from '../database/session-store.js';
import {
  ChatTaskConflictError,
  ChatTaskStore,
  INPUT_ANALYSIS_REJECTION_COMMAND,
  inputAnalysisNotImplementedResult,
  type AcceptedChatTask,
  type RejectInputAnalysisCommand,
  type SessionMessageView,
  type StoredChatTask,
  type SubmitTextCommand,
} from './chat-task.store.js';
import type { CommandEnvelopeBody } from './local-core-api.types.js';

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

  async rejectInputAnalysis(command: RejectInputAnalysisCommand) {
    const operationKey = this.key(command.ownerId, command.operationId);
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
    const operationKey = this.key(command.ownerId, command.operationId);
    const priorOperation = this.operations.get(operationKey);
    if (priorOperation) {
      if (
        priorOperation.commandName !== 'SubmitTextInput' ||
        priorOperation.fingerprint !== command.requestFingerprint
      )
        throw new ChatTaskConflictError();
      return { result: { ...priorOperation.result, status: 'duplicate' } };
    }

    const inputKey = this.key(command.ownerId, command.inputId);
    const priorInput = this.inputs.get(inputKey);
    if (priorInput) {
      if (priorInput.fingerprint !== command.requestFingerprint)
        throw new ChatTaskConflictError();
      const priorTask = this.tasks.get(priorInput.taskId)!;
      const result = this.result(
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
    const messageId = randomUUID();
    this.messageIds.set(`${sessionId}:${sequence}`, messageId);
    const now = new Date();
    const task: StoredChatTask = {
      taskId: randomUUID(),
      ownerId: command.ownerId,
      sessionId,
      operationId: command.operationId,
      inputId: command.inputId,
      text: command.text,
      state: 'queued',
      originalRecordId: randomUUID(),
      userMessageId: messageId,
      createdAt: now,
      updatedAt: now,
    };
    const result = this.result(
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
    return { result, task: this.copy(task) };
  }

  async cancelTask(ownerId: string, envelope: CommandEnvelopeBody) {
    const operationId = String(envelope.operation_id);
    const fingerprint = String(envelope.request_fingerprint);
    const operationKey = this.key(ownerId, operationId);
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
    return { result, task: this.copy(task) };
  }

  async getTask(ownerId: string, taskId: string) {
    const task = this.tasks.get(taskId);
    return task?.ownerId === ownerId ? this.copy(task) : undefined;
  }
  async ownsTask(ownerId: string, taskId: string) {
    return Boolean(await this.getTask(ownerId, taskId));
  }
  async ownsOperation(ownerId: string, operationId: string) {
    return this.operations.has(this.key(ownerId, operationId));
  }
  async markRunning(taskId: string, ownerId: string) {
    const task = this.tasks.get(taskId);
    if (!task || task.ownerId !== ownerId || task.state !== 'queued')
      return false;
    task.state = 'running';
    task.startedAt = new Date();
    task.updatedAt = task.startedAt;
    return true;
  }
  async claimPrivacyResume(taskId: string, ownerId: string) {
    const task = this.tasks.get(taskId);
    if (
      !task ||
      task.ownerId !== ownerId ||
      task.state !== 'waiting_privacy_decision'
    )
      return undefined;
    task.state = 'running';
    task.updatedAt = new Date();
    return this.copy(task);
  }
  async markWaiting(taskId: string, ownerId: string) {
    return this.transition(taskId, ownerId, 'waiting_privacy_decision');
  }
  async markCompleted(taskId: string, ownerId: string) {
    const task = this.tasks.get(taskId);
    if (!task || task.ownerId !== ownerId || task.state === 'cancelled')
      return task && this.copy(task);
    const session = await this.sessions.find(task.sessionId, ownerId);
    const last = session?.messages.at(-1);
    if (last?.role === 'assistant')
      task.resultMessageId = this.messageId(task.sessionId, last.sequence);
    task.state = 'completed';
    task.completedAt = new Date();
    task.updatedAt = task.completedAt;
    return this.copy(task);
  }
  async markFailed(
    taskId: string,
    ownerId: string,
    code: string,
    message: string,
  ) {
    const task = this.tasks.get(taskId);
    if (!task || task.ownerId !== ownerId || task.state === 'cancelled')
      return task && this.copy(task);
    task.state = 'failed';
    task.errorCode = code;
    task.errorMessage = message;
    task.completedAt = new Date();
    task.updatedAt = task.completedAt;
    return this.copy(task);
  }
  async listSessionMessages(
    ownerId: string,
    sessionId: string,
  ): Promise<SessionMessageView[]> {
    const session = await this.sessions.find(sessionId, ownerId);
    return (
      session?.messages.map((m) => ({
        id: this.messageId(sessionId, m.sequence),
        role: m.role,
        content: m.content,
        created_at: new Date(m.timestamp).toISOString(),
      })) ?? []
    );
  }

  private transition(
    taskId: string,
    ownerId: string,
    state: StoredChatTask['state'],
  ) {
    const task = this.tasks.get(taskId);
    if (!task || task.ownerId !== ownerId || task.state === 'cancelled')
      return Promise.resolve(false);
    task.state = state;
    task.updatedAt = new Date();
    return Promise.resolve(true);
  }
  private messageId(sessionId: string, sequence: number) {
    const key = `${sessionId}:${sequence}`;
    const id = this.messageIds.get(key) ?? randomUUID();
    this.messageIds.set(key, id);
    return id;
  }
  private key(ownerId: string, id: string) {
    return `${ownerId}:${id}`;
  }
  private copy(task: StoredChatTask): StoredChatTask {
    return {
      ...task,
      createdAt: new Date(task.createdAt),
      updatedAt: new Date(task.updatedAt),
      ...(task.startedAt ? { startedAt: new Date(task.startedAt) } : {}),
      ...(task.completedAt ? { completedAt: new Date(task.completedAt) } : {}),
    };
  }
  private result(
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
}
