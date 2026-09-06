import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionStore } from '../database/session-store.js';
import { LocalCoreApplicationPort } from './local-core-application.port.js';
import type {
  LocalCoreCommandRequest,
  LocalCoreRequest,
} from './local-core-api.types.js';
import { ConfirmationTransactionService } from './confirmation-transaction.service.js';
import { ChatTaskConflictError, ChatTaskStore } from './chat-task.store.js';
import { ChatTaskScheduler } from './chat-task-scheduler.js';
import { PrivacyDecisionService } from './privacy-decision.service.js';
import { requestedInputAnalysis } from './input-analysis.validator.js';
import { ModelSelectionService } from './model-selection.service.js';
import { buildSessionSummary, getChatSessionSnapshot } from './chat-session-snapshot.js';
import {
  isOperationId,
  parseSubmitTextInputCommandResult,
  parseSubmitTextInputPayload,
} from '@partner-agent/contracts';
import { ToolOperationStore } from '../tools/tool-operation.store.js';
import type { EntityManager } from 'typeorm';

@Injectable()
export class LocalCoreApplicationService extends LocalCoreApplicationPort {
  constructor(
    private readonly sessionStore: SessionStore,
    private readonly confirmationTransaction: ConfirmationTransactionService,
    private readonly chatTasks: ChatTaskStore,
    private readonly scheduler: ChatTaskScheduler,
    private readonly privacyDecisions: PrivacyDecisionService,
    private readonly modelSelection?: ModelSelectionService,
    private readonly toolOperations?: ToolOperationStore,
  ) {
    super();
  }

  async executeCommand(
    command: string,
    request: LocalCoreCommandRequest,
  ): Promise<unknown> {
    if (command === 'SubmitTextInput') {
      return this.submitTextInput(request);
    }
    if (command === 'RenameChatSession') {
      return this.renameChatSession(request);
    }
    if (command === 'ArchiveChatSession') {
      return this.archiveChatSession(request);
    }
    if (command === 'SetMessageModelSelection') {
      return this.setMessageModelSelection(request);
    }
    if (command === 'CancelTask') {
      return this.cancelTask(request);
    }
    if (command === 'SubmitPrivacyDecision') {
      return this.privacyDecisions.submit(request);
    }
    if (command === 'SubmitConfirmationBatch') {
      return this.confirmationTransaction.submit(request);
    }
    throw this.notImplemented(
      'command',
      command,
      request.envelope.operation_id,
    );
  }

  async executeQuery(
    query: string,
    request: LocalCoreRequest,
  ): Promise<unknown> {
    if (query === 'GetCoreHealth') {
      return {
        status: 'ok',
        services: { local_core_api: { ok: true } },
        version: 'v1',
      };
    }

    if (query === 'ListChatSessions') {
      const sessions = await this.sessionStore.list(request.userId);
      return {
        items: await Promise.all(
          sessions.map((session) =>
            buildSessionSummary(session, request.userId, this.chatTasks),
          ),
        ),
      };
    }

    if (query === 'GetChatSession') {
      return getChatSessionSnapshot(request, {
        sessions: this.sessionStore,
        tasks: this.chatTasks,
        tools: this.toolOperations,
      });
    }

    if (query === 'ListModelConfigs') {
      if (!this.modelSelection) throw new Error('模型选择服务未初始化');
      return { items: this.modelSelection.list() };
    }

    if (query === 'GetTaskStatus') {
      return this.getTaskStatus(request);
    }

    throw this.notImplemented('query', query);
  }

  private async renameChatSession(request: LocalCoreCommandRequest): Promise<unknown> {
    const payload = this.objectPayload(request);
    const sessionId = this.requiredString(payload, 'session_id');
    const title = this.requiredString(payload, 'title').replace(/\s+/g, ' ').trim().slice(0, 48);
    if (!title) throw new HttpException({ code: 'VALIDATION_001', message: '会话名称不能为空' }, HttpStatus.BAD_REQUEST);
    try {
      return await this.idempotent(request, 'RenameChatSession', async (manager) => {
        const session = await this.sessionStore.rename(sessionId, request.userId, title, manager);
        return buildSessionSummary(session, request.userId, this.chatTasks);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof ChatTaskConflictError) this.mapTaskError(error);
      throw new NotFoundException({ code: 'AUTH_002', message: '会话不存在' });
    }
  }


  private async archiveChatSession(request: LocalCoreCommandRequest): Promise<unknown> {
    const payload = this.objectPayload(request);
    const sessionId = this.requiredString(payload, 'session_id');
    try {
      return await this.idempotent(request, 'ArchiveChatSession', async (manager) => {
        const session = await this.sessionStore.archive(sessionId, request.userId, manager);
        return buildSessionSummary(session, request.userId, this.chatTasks);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof ChatTaskConflictError) this.mapTaskError(error);
      throw new NotFoundException({ code: 'AUTH_002', message: '会话不存在' });
    }
  }

  private async setMessageModelSelection(request: LocalCoreCommandRequest): Promise<unknown> {
    const payload = this.objectPayload(request);
    const sessionId = this.requiredString(payload, 'session_id');
    const modelConfigId = this.requiredString(payload, 'model_config_id');
    const reasoningLevel = this.optionalString(payload, 'reasoning_level');
    const modelSelection = this.modelSelection;
    if (!modelSelection) throw new Error('模型选择服务未初始化');
    const selection = modelSelection.resolve(modelConfigId, reasoningLevel);
    const defaultSelection = modelSelection.resolve(undefined, undefined);
    const previous = this.optionalString(payload, 'previous_model_config_id') ??
      `${defaultSelection.provider}:${defaultSelection.modelId}`;
    const fromName = previous.split(':').slice(1).join(':') || previous;
    const resolvedModelConfigId = `${selection.provider}:${selection.modelId}`;
    const toName = selection.modelId;
    try {
      return await this.idempotent(request, 'SetMessageModelSelection', async (manager) => {
        const message = await this.sessionStore.appendSystemTip(
          sessionId,
          request.userId,
          previous === resolvedModelConfigId
            ? `模型保持为 ${toName}`
            : `模型由 ${fromName} 切换成 ${toName}`,
          {
            model_config_id: resolvedModelConfigId,
            previous_model_config_id: previous,
          },
          manager,
        );
        return {
          session_id: sessionId,
          message_ref: { kind: 'chat_message' as const, id: message.id },
          item_id: `message:${message.id}`,
          resolved_model: {
            model_config_id: resolvedModelConfigId,
            reasoning_level: selection.reasoningLevel,
          },
        };
      });
    } catch (error) {
      this.mapTaskError(error);
    }
  }

  private async submitTextInput(
    request: LocalCoreCommandRequest,
  ): Promise<unknown> {
    const payload = this.objectPayload(request);
    const operationId = this.requiredEnvelopeString(request, 'operation_id');
    const requestFingerprint = this.requiredEnvelopeString(
      request,
      'request_fingerprint',
    );
    const analysisTypes = requestedInputAnalysis(payload);
    if (analysisTypes) {
      try {
        const error = await this.chatTasks.rejectInputAnalysis({
          ownerId: request.userId,
          operationId,
          requestFingerprint,
          requestedTypes: analysisTypes,
        });
        throw new HttpException(error, HttpStatus.NOT_IMPLEMENTED);
      } catch (error) {
        this.mapTaskError(error);
      }
    }
    let parsedPayload;
    try {
      parsedPayload = parseSubmitTextInputPayload(payload);
    } catch {
      const field =
        payload.reasoning_level !== undefined &&
        !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
          String(payload.reasoning_level),
        )
          ? 'reasoning_level'
          : payload.output_mode === 'structured_preview'
            ? 'preview_kind'
            : 'payload';
      throw new HttpException(
        {
          code: 'VALIDATION_001',
          message: '聊天请求模式或字段无效',
          details: { field },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const selection = this.modelSelection?.resolve(
      parsedPayload.model_config_id,
      parsedPayload.reasoning_level,
    );
    if (!selection) throw new Error('模型选择服务未初始化');
    try {
      const accepted = await this.chatTasks.submitText({
        ownerId: request.userId,
        operationId,
        requestFingerprint,
        clientSource: this.requiredEnvelopeString(request, 'client_source'),
        text: parsedPayload.text,
        inputId: parsedPayload.input_id,
        ...(parsedPayload.session_id ? { sessionId: parsedPayload.session_id } : {}),
        modelConfigId: `${selection.provider}:${selection.modelId}`,
        reasoningLevel: selection.reasoningLevel,
        outputMode: parsedPayload.output_mode ?? 'chat',
        ...(parsedPayload.preview_kind
          ? { previewKind: parsedPayload.preview_kind }
          : {}),
      });
      if (accepted.task) this.scheduler.schedule(accepted.task);
      const result = {
        ...accepted.result,
        data: {
          ...(accepted.result.data as Record<string, unknown>),
          resolved_model: {
            model_config_id: `${selection.provider}:${selection.modelId}`,
            reasoning_level: selection.reasoningLevel,
          },
        },
      };
      try {
        return parseSubmitTextInputCommandResult(result, operationId);
      } catch {
        throw this.contractError('聊天受理结果引用不一致');
      }
    } catch (error) {
      this.mapTaskError(error);
    }
  }

  private async cancelTask(request: LocalCoreCommandRequest): Promise<unknown> {
    const payload = this.objectPayload(request);
    this.requiredString(payload, 'task_id');
    try {
      const cancelled = await this.chatTasks.cancelTask(
        request.userId,
        request.envelope,
      );
      if (cancelled.task?.state === 'cancelled') {
        await this.privacyDecisions.cancelForTask(
          cancelled.task.taskId,
          cancelled.task.ownerId,
        );
        await this.scheduler.cancel(cancelled.task);
      }
      return cancelled.result;
    } catch (error) {
      this.mapTaskError(error);
    }
  }

  private async getTaskStatus(request: LocalCoreRequest): Promise<unknown> {
    const taskId = this.requiredString(request.input, 'task_id');
    const task = await this.chatTasks.getTask(request.userId, taskId);
    if (!task) {
      throw new NotFoundException({ code: 'AUTH_002', message: '任务不存在' });
    }
    const privacyDecision =
      task.state === 'waiting_privacy_decision'
        ? await this.privacyDecisions.currentForTask(task.taskId, task.ownerId)
        : undefined;
    return {
      task_id: task.taskId,
      state: task.state,
      ...(privacyDecision ? { privacy_decision: privacyDecision } : {}),
      ...(task.errorMessage ? { error: task.errorMessage } : {}),
      ...(task.errorCode ? { error_code: task.errorCode } : {}),
      ...(task.resultMessageId
        ? {
            result_ref: {
              kind: 'chat_message',
              id: task.resultMessageId,
            },
          }
        : {}),
      created_at: task.createdAt.toISOString(),
      updated_at: task.updatedAt.toISOString(),
    };
  }

  private async idempotent<T extends Record<string, unknown>>(
    request: LocalCoreCommandRequest,
    commandName: string,
    execute: (manager?: EntityManager) => Promise<T>,
  ): Promise<T> {
    const operationId = this.requiredEnvelopeString(request, 'operation_id');
    const requestFingerprint = this.requiredEnvelopeString(
      request,
      'request_fingerprint',
    );
    if (!isOperationId(operationId)) {
      throw new HttpException(
        {
          code: 'VALIDATION_001',
          message: 'operation_id 必须是 RFC 4122 UUID',
          details: { field: 'operation_id' },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.chatTasks.executeIdempotentCommand(
      {
        ownerId: request.userId,
        operationId,
        requestFingerprint,
        commandName,
      },
      execute,
    );
  }

  private objectPayload(request: LocalCoreCommandRequest) {
    const payload = request.envelope.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new HttpException(
        { code: 'VALIDATION_001', message: 'payload 必须是对象' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return payload as Record<string, unknown>;
  }

  private requiredString(input: Record<string, unknown>, field: string) {
    const value = input[field];
    if (typeof value !== 'string' || !value.trim()) {
      throw new HttpException(
        {
          code: 'VALIDATION_002',
          message: `缺少 ${field}`,
          details: { field },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return value;
  }

  private optionalString(input: Record<string, unknown>, field: string) {
    const value = input[field];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value.trim()) {
      throw new HttpException(
        {
          code: 'VALIDATION_001',
          message: `${field} 必须是非空字符串`,
          details: { field },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return value;
  }

  private requiredEnvelopeString(
    request: LocalCoreCommandRequest,
    field: string,
  ) {
    return this.requiredString(request.envelope, field);
  }

  private mapTaskError(error: unknown): never {
    if (error instanceof ChatTaskConflictError) {
      throw new HttpException(
        { code: 'IDEMPOTENCY_001', message: '幂等标识对应的请求不一致' },
        HttpStatus.CONFLICT,
      );
    }
    if (error instanceof Error && error.message === 'AUTH_002') {
      throw new NotFoundException({ code: 'AUTH_002', message: '资源不存在' });
    }
    if (
      error instanceof Error &&
      (error.message === 'RATE_001' ||
        error.message.includes('会话数量已达到上限'))
    ) {
      throw new HttpException(
        { code: 'RATE_001', message: '用户会话数量已达到上限' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    throw error;
  }

  private contractError(message: string): HttpException {
    return new HttpException(
      { code: 'CONTRACT_001', message },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private notImplemented(
    kind: 'command' | 'query',
    handler: string,
    operationId?: string,
  ): HttpException {
    return new HttpException(
      {
        code: 'NOT_IMPLEMENTED_001',
        message: `${handler} 尚未实现`,
        details: {
          handler_kind: kind,
          handler,
          ...(operationId ? { operation_id: operationId } : {}),
        },
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
