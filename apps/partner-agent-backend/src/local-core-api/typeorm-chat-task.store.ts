import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { ChatSessionEntity } from '../database/entities/chat-session.entity.js';
import {
  ChatTaskEntity,
  LocalCoreOperationEntity,
  OriginalRecordEntity,
  type ChatTaskState,
} from '../database/entities/chat-task.entity.js';
import { SessionMessageEntity } from '../database/entities/session-message.entity.js';
import { UserEntity } from '../database/entities/core/user.entity.js';
import {
  ChatTaskConflictError,
  ChatTaskStore,
  INPUT_ANALYSIS_REJECTION_COMMAND,
  inputAnalysisNotImplementedResult,
  type RejectInputAnalysisCommand,
  type StoredChatTask,
  type SubmitTextCommand,
} from './chat-task.store.js';
import type { CommandEnvelopeBody } from './local-core-api.types.js';

export class TypeOrmChatTaskStore extends ChatTaskStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly maxSessionsPerUser = 100,
  ) {
    super();
  }

  async rejectInputAnalysis(command: RejectInputAnalysisCommand) {
    return this.dataSource.transaction(async (manager) => {
      await this.lock(manager, command.ownerId, command.operationId);
      const prior = await this.findOperation(
        manager,
        command.ownerId,
        command.operationId,
      );
      if (prior) {
        if (
          prior.commandName !== INPUT_ANALYSIS_REJECTION_COMMAND ||
          prior.requestFingerprint !== command.requestFingerprint
        )
          throw new ChatTaskConflictError();
        return { ...prior.resultJson };
      }
      await manager
        .getRepository(UserEntity)
        .createQueryBuilder()
        .insert()
        .values({
          id: command.ownerId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .orIgnore()
        .execute();
      const result = inputAnalysisNotImplementedResult(command);
      await manager.getRepository(LocalCoreOperationEntity).insert({
        id: randomUUID(),
        ownerId: command.ownerId,
        operationId: command.operationId,
        requestFingerprint: command.requestFingerprint,
        commandName: INPUT_ANALYSIS_REJECTION_COMMAND,
        resultJson: result,
        createdAt: new Date(),
      });
      return result;
    });
  }

  async submitText(command: SubmitTextCommand) {
    return this.dataSource.transaction(async (manager) => {
      await this.lock(
        manager,
        command.ownerId,
        '__session_limit__',
        command.operationId,
        command.inputId,
      );
      const prior = await this.findOperation(
        manager,
        command.ownerId,
        command.operationId,
      );
      if (prior)
        return {
          result: this.replay(
            prior,
            command.requestFingerprint,
            'SubmitTextInput',
          ),
        };

      const existingRecord = await manager
        .getRepository(OriginalRecordEntity)
        .findOne({
          where: { ownerId: command.ownerId, inputId: command.inputId },
        });
      if (existingRecord) {
        if (existingRecord.requestFingerprint !== command.requestFingerprint)
          throw new ChatTaskConflictError();
        const task = await manager
          .getRepository(ChatTaskEntity)
          .findOneByOrFail({
            ownerId: command.ownerId,
            originalRecordId: existingRecord.id,
          });
        const result = this.commandResult(
          command.operationId,
          task,
          'duplicate',
        );
        await this.saveOperation(manager, command, result);
        return { result };
      }

      await manager
        .getRepository(UserEntity)
        .upsert(
          { id: command.ownerId, createdAt: new Date(), updatedAt: new Date() },
          ['id'],
        );
      const sessionId = command.sessionId ?? randomUUID();
      let session = await manager.getRepository(ChatSessionEntity).findOne({
        where: { id: sessionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (session && (session.ownerId !== command.ownerId || session.deletedAt))
        throw new Error('AUTH_002');
      const now = new Date();
      if (!session) {
        const sessionCount = await manager
          .getRepository(ChatSessionEntity)
          .count({ where: { ownerId: command.ownerId, deletedAt: IsNull() } });
        if (sessionCount >= this.maxSessionsPerUser) {
          throw new Error('RATE_001');
        }
        session = manager.getRepository(ChatSessionEntity).create({
          id: sessionId,
          ownerId: command.ownerId,
          title: null,
          contextFormat: 'pi-agent-v1',
          contextJson: '[]',
          contextRevision: 0,
          version: '1',
          lifecycleStatus: 'active',
          createdAt: now,
          lastActiveAt: now,
          updatedAt: now,
          archivedAt: null,
          deletedAt: null,
        });
        await manager.getRepository(ChatSessionEntity).insert(session);
      }
      const last = await manager
        .getRepository(SessionMessageEntity)
        .findOne({ where: { sessionId }, order: { sequence: 'DESC' } });
      const messageId = randomUUID();
      const recordId = randomUUID();
      const taskId = randomUUID();
      await manager.getRepository(SessionMessageEntity).insert({
        id: messageId,
        sessionId,
        ownerId: command.ownerId,
        sequence: (last?.sequence ?? 0) + 1,
        role: 'user',
        content: command.text,
        status: 'complete',
        inputId: command.inputId,
        operationId: this.uuidOrNull(command.operationId),
        taskId,
        originalRecordId: recordId,
        analysisResultId: null,
        createdAt: now,
        completedAt: now,
      });
      await manager.getRepository(OriginalRecordEntity).insert({
        id: recordId,
        ownerId: command.ownerId,
        sessionId,
        inputId: command.inputId,
        requestFingerprint: command.requestFingerprint,
        content: command.text,
        createdAt: now,
      });
      const task = manager.getRepository(ChatTaskEntity).create({
        id: taskId,
        ownerId: command.ownerId,
        sessionId,
        operationId: command.operationId,
        inputId: command.inputId,
        originalRecordId: recordId,
        userMessageId: messageId,
        resultMessageId: null,
        state: 'queued',
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
      });
      const result = this.commandResult(command.operationId, task, 'accepted');
      await this.saveOperation(manager, command, result);
      await manager.getRepository(ChatTaskEntity).insert(task);
      await manager
        .getRepository(ChatSessionEntity)
        .update(
          { id: sessionId, ownerId: command.ownerId },
          { lastActiveAt: now, updatedAt: now },
        );
      return { result, task: this.toStored(task, command.text) };
    });
  }

  async cancelTask(ownerId: string, envelope: CommandEnvelopeBody) {
    return this.dataSource.transaction(async (manager) => {
      const operationId = String(envelope.operation_id);
      const fingerprint = String(envelope.request_fingerprint);
      const taskId = String(
        (envelope.payload as Record<string, unknown>).task_id,
      );
      await this.lock(manager, ownerId, operationId, taskId);
      const prior = await this.findOperation(manager, ownerId, operationId);
      if (prior)
        return { result: this.replay(prior, fingerprint, 'CancelTask') };
      const task = await manager.getRepository(ChatTaskEntity).findOne({
        where: { id: taskId, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task) throw new Error('AUTH_002');
      if (!['completed', 'failed', 'cancelled'].includes(task.state)) {
        task.state = 'cancelled';
        task.completedAt = new Date();
        task.updatedAt = task.completedAt;
        await manager.getRepository(ChatTaskEntity).save(task);
      }
      const result = {
        operation_id: operationId,
        status: 'completed',
        task_refs: [{ task_id: task.id, kind: 'chat_response' }],
        data: { task_id: task.id, state: task.state },
      };
      await manager.getRepository(LocalCoreOperationEntity).insert({
        id: randomUUID(),
        ownerId,
        operationId,
        requestFingerprint: fingerprint,
        commandName: 'CancelTask',
        resultJson: result,
        createdAt: new Date(),
      });
      return { result, task: await this.loadStored(manager, task) };
    });
  }

  async getTask(ownerId: string, taskId: string) {
    const task = await this.dataSource
      .getRepository(ChatTaskEntity)
      .findOneBy({ id: taskId, ownerId });
    return task ? this.loadStored(this.dataSource.manager, task) : undefined;
  }
  async ownsTask(ownerId: string, taskId: string) {
    return (
      (await this.dataSource
        .getRepository(ChatTaskEntity)
        .countBy({ id: taskId, ownerId })) > 0
    );
  }
  async ownsOperation(ownerId: string, operationId: string) {
    return (
      (await this.dataSource
        .getRepository(LocalCoreOperationEntity)
        .countBy({ ownerId, operationId })) > 0
    );
  }
  async markRunning(taskId: string, ownerId: string) {
    const now = new Date();
    const result = await this.dataSource
      .getRepository(ChatTaskEntity)
      .update(
        { id: taskId, ownerId, state: 'queued' },
        { state: 'running', startedAt: now, updatedAt: now },
      );
    return Boolean(result.affected);
  }
  async claimPrivacyResume(taskId: string, ownerId: string) {
    const claimed = await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(ChatTaskEntity)
        .set({ state: 'running', updatedAt: () => 'CURRENT_TIMESTAMP' })
        .where(
          'id = :taskId and owner_id = :ownerId and state = :waitingState',
          {
            taskId,
            ownerId,
            waitingState: 'waiting_privacy_decision',
          },
        )
        .returning('*')
        .execute();
      return result.raw[0] as ChatTaskEntity | undefined;
    });
    if (!claimed) return undefined;
    const task = await this.dataSource
      .getRepository(ChatTaskEntity)
      .findOneBy({ id: taskId, ownerId });
    return task ? this.loadStored(this.dataSource.manager, task) : undefined;
  }
  async markWaiting(taskId: string, ownerId: string) {
    return this.updateState(taskId, ownerId, 'waiting_privacy_decision');
  }
  async markCompleted(taskId: string, ownerId: string) {
    return this.finish(taskId, ownerId, 'completed');
  }
  async markFailed(
    taskId: string,
    ownerId: string,
    code: string,
    message: string,
  ) {
    return this.finish(taskId, ownerId, 'failed', code, message);
  }
  async listSessionMessages(ownerId: string, sessionId: string) {
    const rows = await this.dataSource
      .getRepository(SessionMessageEntity)
      .find({ where: { ownerId, sessionId }, order: { sequence: 'ASC' } });
    return rows
      .filter(
        (
          message,
        ): message is SessionMessageEntity & {
          role: 'user' | 'assistant';
        } => message.role !== 'system',
      )
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.createdAt.toISOString(),
      }));
  }

  private async finish(
    taskId: string,
    ownerId: string,
    state: 'completed' | 'failed',
    errorCode?: string,
    errorMessage?: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const task = await manager.getRepository(ChatTaskEntity).findOne({
        where: { id: taskId, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task) return undefined;
      if (task.state === 'cancelled') return this.loadStored(manager, task);
      if (state === 'completed') {
        const message = await manager
          .getRepository(SessionMessageEntity)
          .findOne({
            where: {
              ownerId,
              sessionId: task.sessionId,
              role: 'assistant',
              taskId: IsNull(),
            },
            order: { sequence: 'DESC' },
          });
        if (message) {
          message.taskId = task.id;
          await manager.getRepository(SessionMessageEntity).save(message);
          task.resultMessageId = message.id;
        }
      }
      task.state = state;
      task.errorCode = errorCode ?? null;
      task.errorMessage = errorMessage ?? null;
      task.completedAt = new Date();
      task.updatedAt = task.completedAt;
      await manager.getRepository(ChatTaskEntity).save(task);
      return this.loadStored(manager, task);
    });
  }

  private async updateState(
    taskId: string,
    ownerId: string,
    state: ChatTaskState,
  ) {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(ChatTaskEntity)
      .set({ state, updatedAt: new Date() })
      .where('id = :taskId and owner_id = :ownerId and state <> :cancelled', {
        taskId,
        ownerId,
        cancelled: 'cancelled',
      })
      .execute();
    return Boolean(result.affected);
  }
  private async loadStored(
    manager: EntityManager,
    task: ChatTaskEntity,
  ): Promise<StoredChatTask> {
    const record = await manager
      .getRepository(OriginalRecordEntity)
      .findOneByOrFail({ id: task.originalRecordId, ownerId: task.ownerId });
    return this.toStored(task, record.content);
  }
  private toStored(task: ChatTaskEntity, text: string): StoredChatTask {
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
      ...(task.resultMessageId
        ? { resultMessageId: task.resultMessageId }
        : {}),
      ...(task.errorCode ? { errorCode: task.errorCode } : {}),
      ...(task.errorMessage ? { errorMessage: task.errorMessage } : {}),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      ...(task.startedAt ? { startedAt: task.startedAt } : {}),
      ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    };
  }
  private async findOperation(
    manager: EntityManager,
    ownerId: string,
    operationId: string,
  ) {
    return manager
      .getRepository(LocalCoreOperationEntity)
      .findOneBy({ ownerId, operationId });
  }
  private replay(
    operation: LocalCoreOperationEntity,
    fingerprint: string,
    commandName: string,
  ) {
    if (
      operation.commandName !== commandName ||
      operation.requestFingerprint !== fingerprint
    )
      throw new ChatTaskConflictError();
    return { ...operation.resultJson, status: 'duplicate' };
  }
  private async saveOperation(
    manager: EntityManager,
    command: SubmitTextCommand,
    result: Record<string, unknown>,
  ) {
    const repository = manager.getRepository(LocalCoreOperationEntity);
    await repository.save(
      repository.create({
        id: randomUUID(),
        ownerId: command.ownerId,
        operationId: command.operationId,
        requestFingerprint: command.requestFingerprint,
        commandName: 'SubmitTextInput',
        resultJson: result,
        createdAt: new Date(),
      }),
    );
  }
  private async lock(
    manager: EntityManager,
    ownerId: string,
    ...keys: string[]
  ) {
    for (const key of keys)
      await manager.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${ownerId}:${key}`,
      ]);
  }
  private uuidOrNull(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
      ? value
      : null;
  }
  private commandResult(
    operationId: string,
    task: ChatTaskEntity,
    status: 'accepted' | 'duplicate',
  ) {
    const message = { kind: 'chat_message', id: task.userMessageId };
    const record = { kind: 'original_record', id: task.originalRecordId };
    const taskRef = { task_id: task.id, kind: 'chat_response' };
    return {
      operation_id: operationId,
      status,
      resource_refs: [{ kind: 'session', id: task.sessionId }, message, record],
      task_refs: [taskRef],
      data: {
        session_id: task.sessionId,
        message_ref: message,
        original_record: record,
        chat_task: taskRef,
      },
    };
  }
}
