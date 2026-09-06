import { postgresSessionTaskRefs } from './session-task-reference.js';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { ChatSessionEntity } from '../database/entities/chat-session.entity.js';
import {
  ChatTaskEntity,
  LocalCoreOperationEntity,
  OriginalRecordEntity,
} from '../database/entities/chat-task.entity.js';
import { SessionMessageEntity } from '../database/entities/session-message.entity.js';
import { UserEntity } from '../database/entities/core/user.entity.js';
import {
  ChatTaskConflictError,
  ChatTaskStore,
  INPUT_ANALYSIS_REJECTION_COMMAND,
  inputAnalysisNotImplementedResult,
  parseAssistantCompletionPreviews,
  type IdempotentCommand,
  type AssistantCompletionCommand,
  type AssistantProgressCommand,
  type RejectInputAnalysisCommand,
  type StoredChatTask,
  type SubmitTextCommand,
} from './chat-task.store.js';
import { recoverChatPreviewsV1 } from '@partner-agent/contracts';
import type { CommandEnvelopeBody } from './local-core-api.types.js';
import { TypeOrmChatTaskRuntime } from './typeorm-chat-task-runtime.js';
import { toStoredChatTask } from './typeorm-chat-task-mapper.js';
import {
  ChatTaskLifecycleOutboxWriter,
  TypeOrmChatTaskLifecycleOutbox,
} from './chat-task-lifecycle-outbox.js';
import {
  actionPreviewDisposition,
  persistActionCandidates,
} from './action-candidate-production.js';
import { executeConfirmationTransaction } from './confirmation-transaction.executor.js';
export class TypeOrmChatTaskStore extends ChatTaskStore {
  private readonly runtime: TypeOrmChatTaskRuntime;
  override readonly lifecycleOutbox: TypeOrmChatTaskLifecycleOutbox;
  constructor(
    private readonly dataSource: DataSource,
    private readonly maxSessionsPerUser = 100,
  ) {
    super();
    this.runtime = new TypeOrmChatTaskRuntime(dataSource, (manager, task) =>
      this.loadStored(manager, task),
    );
    this.lifecycleOutbox = new TypeOrmChatTaskLifecycleOutbox(dataSource);
  }

  async executeIdempotentCommand<T extends Record<string, unknown>>(
    command: IdempotentCommand,
    execute: (manager?: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await this.lock(manager, command.ownerId, command.operationId);
      const prior = await this.findOperation(
        manager,
        command.ownerId,
        command.operationId,
      );
      if (prior) {
        if (
          prior.commandName !== command.commandName ||
          prior.requestFingerprint !== command.requestFingerprint
        ) throw new ChatTaskConflictError();
        return structuredClone(prior.resultJson) as T;
      }
      const result = await execute(manager);
      const repository = manager.getRepository(LocalCoreOperationEntity);
      await repository.save(repository.create({
        id: randomUUID(), ownerId: command.ownerId,
        operationId: command.operationId,
        requestFingerprint: command.requestFingerprint,
        commandName: command.commandName,
        resultJson: result as Record<string, unknown>, createdAt: new Date(),
      }));
      return result;
    });
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
        modelConfigId: command.modelConfigId ?? `${process.env.DEFAULT_PROVIDER ?? 'deepseek'}:${process.env.DEFAULT_MODEL ?? 'deepseek-v4-flash'}`,
        reasoningLevel: command.reasoningLevel ?? 'medium',
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
        modelConfigId: command.modelConfigId ?? `${process.env.DEFAULT_PROVIDER ?? 'deepseek'}:${process.env.DEFAULT_MODEL ?? ''}`,
        reasoningLevel: command.reasoningLevel ?? 'medium',
        outputMode: command.outputMode ?? 'chat',
        previewKind: command.previewKind ?? null,
        originalRecordId: recordId,
        userMessageId: messageId,
        resultMessageId: null,
        state: 'queued',
        revision: 1,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        attemptCount: 0,
        waitingToolConfirmationId: null,
      });
      const result = this.commandResult(command.operationId, task, 'accepted');
      await this.saveOperation(manager, command, result);
      await manager.getRepository(ChatTaskEntity).insert(task);
      await ChatTaskLifecycleOutboxWriter.append(manager, task);
      await manager
        .getRepository(ChatSessionEntity)
        .update(
          { id: sessionId, ownerId: command.ownerId },
          { lastActiveAt: now, updatedAt: now },
        );
      return { result, task: toStoredChatTask(task, command.text) };
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
        task.revision += 1;
        task.leaseOwner = null;
        task.leaseExpiresAt = null;
        task.waitingToolConfirmationId = null;
        task.completedAt = new Date();
        task.updatedAt = task.completedAt;
        await manager.getRepository(ChatTaskEntity).save(task);
        await ChatTaskLifecycleOutboxWriter.append(manager, task);
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
  async getSessionTaskRefs(ownerId: string, sessionId: string) {
    return postgresSessionTaskRefs(this.dataSource, ownerId, sessionId);
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
  async listWaitingPrivacyTasks() {
    return this.runtime.listWaitingPrivacyTasks();
  }
  async failWaitingPrivacyDecision(
    taskId: string,
    ownerId: string,
    code: string,
    message: string,
  ) {
    return this.runtime.failWaitingPrivacyDecision(
      taskId,
      ownerId,
      code,
      message,
    );
  }
  async markRunning(taskId: string, ownerId: string) {
    return this.runtime.markRunning(taskId, ownerId);
  }
  async recoverExpiredLeases(now = new Date()) {
    return this.runtime.recoverExpiredLeases(now);
  }
  async claimNextRunnable(leaseOwner: string, leaseDurationMs: number) {
    return this.runtime.claimNextRunnable(leaseOwner, leaseDurationMs);
  }
  async countRunnable(limit?: number) { return this.runtime.countRunnable(limit); }
  async renewLease(
    taskId: string,
    ownerId: string,
    leaseOwner: string,
    leaseDurationMs: number,
  ) {
    return this.runtime.renewLease(
      taskId,
      ownerId,
      leaseOwner,
      leaseDurationMs,
    );
  }
  async releaseLeases(leaseOwner: string) {
    return this.runtime.releaseLeases(leaseOwner);
  }
  async claimPrivacyResume(taskId: string, ownerId: string) {
    return this.runtime.claimPrivacyResume(taskId, ownerId);
  }
  async claimToolResume(
    taskId: string,
    ownerId: string,
    confirmationId: string,
    leaseOwner: string,
    leaseDurationMs: number,
  ) {
    return this.runtime.claimToolResume(
      taskId,
      ownerId,
      confirmationId,
      leaseOwner,
      leaseDurationMs,
    );
  }
  async markWaiting(
    taskId: string,
    ownerId: string,
    leaseOwner?: string,
    lifecycleData?: Record<string, unknown>,
  ) {
    return this.runtime.markWaiting(taskId, ownerId, leaseOwner, lifecycleData);
  }
  async markWaitingToolApproval(
    taskId: string,
    ownerId: string,
    confirmationId: string,
    leaseOwner?: string,
  ) {
    return this.runtime.markWaitingToolApproval(taskId, ownerId, confirmationId, leaseOwner);
  }
  async failWaitingToolApproval(
    taskId: string,
    ownerId: string,
    confirmationId: string,
    code: string,
    message: string,
  ) {
    return this.runtime.failWaitingToolApproval(
      taskId,
      ownerId,
      confirmationId,
      code,
      message,
    );
  }
  async markCompleted(taskId: string, ownerId: string, leaseOwner?: string) {
    return this.runtime.markCompleted(taskId, ownerId, leaseOwner);
  }
  async markFailed(
    taskId: string,
    ownerId: string,
    code: string,
    message: string,
    leaseOwner?: string,
  ) {
    return this.runtime.markFailed(taskId, ownerId, code, message, leaseOwner);
  }
  async appendAssistantProgress(command: AssistantProgressCommand) {
    return this.dataSource.transaction(async (manager) => {
      const task = await this.lockCurrentLease(manager, command);
      if (!task) return { outcome: 'fence_rejected' as const };
      const repository = manager.getRepository(SessionMessageEntity);
      let message = await repository.findOne({
        where: { ownerId: task.ownerId, sessionId: task.sessionId, taskId: task.id, role: 'assistant' },
        lock: { mode: 'pessimistic_write' },
      });
      const revision = message?.revision ?? 0;
      const content = message?.content ?? '';
      if (command.expectedRevision !== revision || command.textOffset !== content.length || command.delta.length === 0) {
        return { outcome: 'conflict' as const };
      }
      if (!message) {
        const last = await repository.findOne({ where: { sessionId: task.sessionId }, order: { sequence: 'DESC' } });
        message = repository.create({
          id: task.resultMessageId ?? randomUUID(), ownerId: task.ownerId,
          sessionId: task.sessionId, sequence: (last?.sequence ?? 0) + 1,
          role: 'assistant', createdAt: new Date(), completedAt: null,
          taskId: task.id, operationId: this.uuidOrNull(task.operationId),
          modelConfigId: task.modelConfigId, reasoningLevel: task.reasoningLevel,
          metadataJson: null,
        });
      }
      const textOffset = content.length;
      message.content = content + command.delta;
      message.status = 'streaming';
      message.revision = revision + 1;
      await repository.save(message);
      if (task.resultMessageId !== message.id) {
        task.resultMessageId = message.id;
        task.updatedAt = new Date();
        await manager.getRepository(ChatTaskEntity).save(task);
      }
      await manager.getRepository(ChatSessionEntity).update(
        { id: task.sessionId, ownerId: task.ownerId },
        { lastActiveAt: new Date(), updatedAt: new Date() },
      );
      return { outcome: 'committed' as const, textOffset, message: this.toMessageDto(message) };
    });
  }

  async completeAssistantOutput(command: AssistantCompletionCommand) {
    return this.dataSource.transaction(async (manager) => {
      const taskRepository = manager.getRepository(ChatTaskEntity);
      const task = await taskRepository.findOne({
        where: { id: command.taskId, ownerId: command.ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task || task.sessionId !== command.sessionId || task.operationId !== command.operationId) {
        return { outcome: 'fence_rejected' as const };
      }
      const messageRepository = manager.getRepository(SessionMessageEntity);
      let message = await messageRepository.findOne({
        where: { ownerId: task.ownerId, sessionId: task.sessionId, taskId: task.id, role: 'assistant' },
        lock: { mode: 'pessimistic_write' },
      });
      if (task.state === 'completed' && message) {
        return { outcome: 'already_completed' as const, task: await this.loadStored(manager, task), message: this.toMessageDto(message) };
      }
      if (!this.matchesCurrentLease(task, command.leaseToken)) {
        return { outcome: 'fence_rejected' as const };
      }
      if (command.expectedRevision !== (message?.revision ?? 0)) {
        return { outcome: 'conflict' as const };
      }
      const previewValidation = parseAssistantCompletionPreviews(
        {
          outputMode: task.outputMode,
          ...(task.previewKind ? { previewKind: task.previewKind } : {}),
        },
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
      if (!message) {
        const last = await messageRepository.findOne({ where: { sessionId: task.sessionId }, order: { sequence: 'DESC' } });
        message = messageRepository.create({
          id: task.resultMessageId ?? randomUUID(), ownerId: task.ownerId,
          sessionId: task.sessionId, sequence: (last?.sequence ?? 0) + 1,
          role: 'assistant', createdAt: new Date(), taskId: task.id,
          operationId: this.uuidOrNull(task.operationId), modelConfigId: task.modelConfigId,
          reasoningLevel: task.reasoningLevel,
        });
      }
      const autoApply = task.outputMode === 'chat'
        && actionPreviewDisposition(previews) === 'auto_apply';
      message.content = command.content;
      message.status = 'complete';
      message.revision = (message.revision ?? 0) + 1;
      const messageMetadata: Record<string, unknown> = {};
      if (!autoApply && previews.length) messageMetadata.chat_previews = previews;
      if (command.thinkingContent?.trim()) {
        messageMetadata.thinking_summary = command.thinkingContent.slice(0, 100_000);
      }
      message.metadataJson = Object.keys(messageMetadata).length ? messageMetadata : null;
      message.completedAt = new Date();
      if (autoApply) {
        const candidateBatch = await persistActionCandidates(
          manager,
          task,
          previews,
          message.completedAt,
        );
        if (!candidateBatch || !manager.queryRunner) {
          throw new Error('自动执行行动候选事务未初始化');
        }
        const confirmation = await executeConfirmationTransaction(
          manager.queryRunner,
          {
            userId: task.ownerId,
            input: {},
            envelope: {
              operation_id: task.operationId,
              client_source: 'other',
              request_fingerprint: `auto-confirm:${task.operationId}:${candidateBatch.batchId}`,
              payload: {
                confirmation_batch_id: candidateBatch.batchId,
                batch_version: '1',
                items: candidateBatch.candidateIds.map((candidateId) => ({
                  candidate_id: candidateId,
                  candidate_version: '1',
                  decision: 'confirm' as const,
                })),
              },
            },
          },
        );
        if (confirmation.outcome !== 'completed') {
          throw new Error('自动执行行动候选未完成');
        }
        const title = previews[0]?.content.title;
        message.content = `${command.content.trim()}${command.content.trim() ? '\n\n' : ''}已创建行动：${title}`;
      }
      await messageRepository.save(message);
      await manager.getRepository(ChatSessionEntity).update(
        { id: task.sessionId, ownerId: task.ownerId },
        { contextJson: JSON.stringify(command.contextMessages), contextFormat: 'pi-agent-v2-sequence-watermark', contextRevision: message.sequence, lastActiveAt: message.completedAt, updatedAt: message.completedAt },
      );
      task.resultMessageId = message.id;
      task.state = 'completed';
      task.revision += 1;
      task.waitingToolConfirmationId = null;
      task.leaseOwner = null;
      task.leaseExpiresAt = null;
      task.errorCode = null;
      task.errorMessage = null;
      task.completedAt = message.completedAt;
      task.updatedAt = message.completedAt;
      await taskRepository.save(task);
      await ChatTaskLifecycleOutboxWriter.append(manager, task);
      return {
        outcome: 'committed' as const,
        task: await this.loadStored(manager, task),
        message: this.toMessageDto(message),
      };
    });
  }

  async listSessionMessages(ownerId: string, sessionId: string) {
    const rows = await this.dataSource
      .getRepository(SessionMessageEntity)
      .find({ where: { ownerId, sessionId }, order: { sequence: 'ASC' } });
    return rows
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.createdAt.toISOString(),
        sequence: m.sequence,
        status: m.status,
        session_id: m.sessionId,
        revision: m.revision,
        ...(m.taskId ? { task_id: m.taskId } : {}),
        ...(m.operationId ? { operation_id: m.operationId } : {}),
        ...(m.modelConfigId ? { model_config_id: m.modelConfigId } : {}),
        ...(m.reasoningLevel ? { reasoning_level: m.reasoningLevel } : {}),
        ...(typeof m.metadataJson?.thinking_summary === 'string'
          ? { thinking_summary: m.metadataJson.thinking_summary }
          : {}),
      }));
  }
  async listSessionChatPreviews(ownerId: string, sessionId: string) {
    const rows = await this.dataSource.getRepository(SessionMessageEntity).find({
      where: { ownerId, sessionId, role: 'assistant' },
      order: { sequence: 'ASC' },
    });
    const seenPreviewIds = new Set<string>();
    return rows.flatMap((message) => {
      if (!message.taskId || !message.operationId) return [];
      const previews = message.metadataJson?.chat_previews;
      if (!Array.isArray(previews)) return [];
      return recoverChatPreviewsV1(previews).flatMap((preview) => {
        if (seenPreviewIds.has(preview.preview_id)) return [];
        seenPreviewIds.add(preview.preview_id);
        return [{
          session_id: message.sessionId,
          task_id: message.taskId!,
          operation_id: message.operationId!,
          message_id: message.id,
          message_revision: message.revision,
          preview,
        }];
      });
    });
  }
  async listSessionFormalCandidates(ownerId: string, sessionId: string) {
    const rows = (await this.dataSource.query(
      `select ci.id as candidate_id,ci.batch_id,ct.session_id,ar.chat_task_id as task_id,
              ct.operation_id,ci.kind,ci.payload,ci.source_refs,ci.confidence,
              ci.risk,ci.version,ci.created_at
       from candidate_items ci
       join confirmation_batches cb
         on cb.user_id=ci.user_id and cb.id=ci.batch_id
       join structured_analyses sa
         on sa.owner_id=cb.user_id and sa.id=cb.source_analysis_id
       join analysis_runs ar
         on ar.owner_id=sa.owner_id and ar.id=sa.analysis_run_id
       join chat_tasks ct
         on ct.owner_id=ar.owner_id and ct.id=ar.chat_task_id
       where ci.user_id=$1 and ct.session_id=$2 and ci.candidate_status='pending'
       order by ci.created_at asc,ci.id asc`,
      [ownerId, sessionId],
    )) as Array<{
      candidate_id: string; batch_id: string; session_id: string; task_id: string;
      operation_id: string; kind: string; payload: Record<string, unknown>;
      source_refs: unknown; confidence: string | number | null; risk: 'normal' | 'high';
      version: string | number; created_at: Date;
    }>;
    return rows.map((row) => ({
      candidate_id: row.candidate_id,
      batch_id: row.batch_id,
      session_id: row.session_id,
      task_id: row.task_id,
      operation_id: row.operation_id,
      kind: row.kind,
      payload: row.payload,
      source_refs: Array.isArray(row.source_refs)
        ? row.source_refs.filter(
            (ref): ref is { kind: string; id: string } =>
              Boolean(ref) && typeof ref === 'object'
              && typeof (ref as Record<string, unknown>).kind === 'string'
              && typeof (ref as Record<string, unknown>).id === 'string',
          )
        : [],
      ...(row.confidence === null
        ? {}
        : { confidence: Number(row.confidence) }),
      risk: row.risk,
      version: Number(row.version),
      created_at: new Date(row.created_at),
    }));
  }
  private async lockCurrentLease(
    manager: EntityManager,
    command: { taskId: string; ownerId: string; sessionId: string; operationId: string; leaseToken: string },
  ) {
    const task = await manager.getRepository(ChatTaskEntity).findOne({
      where: { id: command.taskId, ownerId: command.ownerId },
      lock: { mode: 'pessimistic_write' },
    });
    return task && task.sessionId === command.sessionId && task.operationId === command.operationId &&
      this.matchesCurrentLease(task, command.leaseToken) ? task : undefined;
  }
  private matchesCurrentLease(task: ChatTaskEntity, leaseToken: string) {
    return task.state === 'running' && task.leaseOwner === leaseToken &&
      Boolean(task.leaseExpiresAt && task.leaseExpiresAt.getTime() > Date.now());
  }
  private toMessageDto(message: SessionMessageEntity) {
    return {
      id: message.id, session_id: message.sessionId, sequence: message.sequence,
      role: message.role, content: message.content, status: message.status,
      revision: message.revision, created_at: message.createdAt.toISOString(),
      ...(message.taskId ? { task_id: message.taskId } : {}),
      ...(message.operationId ? { operation_id: message.operationId } : {}),
      ...(message.modelConfigId ? { model_config_id: message.modelConfigId } : {}),
      ...(message.reasoningLevel ? { reasoning_level: message.reasoningLevel } : {}),
      ...(typeof message.metadataJson?.thinking_summary === 'string'
        ? { thinking_summary: message.metadataJson.thinking_summary }
        : {}),
    };
  }
  private async loadStored(
    manager: EntityManager,
    task: ChatTaskEntity,
  ): Promise<StoredChatTask> {
    const record = await manager
      .getRepository(OriginalRecordEntity)
      .findOneByOrFail({ id: task.originalRecordId, ownerId: task.ownerId });
    return toStoredChatTask(task, record.content);
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
        resolved_model: {
          model_config_id: task.modelConfigId,
          reasoning_level: task.reasoningLevel,
        },
      },
    };
  }
}
