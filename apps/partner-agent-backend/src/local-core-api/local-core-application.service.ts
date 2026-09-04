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

@Injectable()
export class LocalCoreApplicationService extends LocalCoreApplicationPort {
  constructor(
    private readonly sessionStore: SessionStore,
    private readonly confirmationTransaction: ConfirmationTransactionService,
    private readonly chatTasks: ChatTaskStore,
    private readonly scheduler: ChatTaskScheduler,
    private readonly privacyDecisions: PrivacyDecisionService,
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

    if (query === 'GetChatSession') {
      return this.getChatSession(request);
    }

    if (query === 'GetTaskStatus') {
      return this.getTaskStatus(request);
    }

    throw this.notImplemented('query', query);
  }

  private async getChatSession(request: LocalCoreRequest): Promise<unknown> {
    const sessionId = request.input.session_id;
    if (typeof sessionId !== 'string' || !sessionId) {
      throw new HttpException(
        {
          code: 'VALIDATION_002',
          message: '缺少 session_id',
          details: { field: 'session_id' },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const session = await this.sessionStore.find(sessionId, request.userId);
    if (!session) {
      throw new NotFoundException({
        code: 'AUTH_002',
        message: '会话不存在',
      });
    }

    const lastMessage = session.messages.at(-1);
    return {
      id: session.id,
      created_at: session.createdAt.toISOString(),
      updated_at: session.lastActiveAt.toISOString(),
      message_count: session.messages.length,
      messages: await this.chatTasks.listSessionMessages(
        request.userId,
        session.id,
      ),
      ...(lastMessage
        ? { last_message_preview: lastMessage.content.slice(0, 120) }
        : {}),
    };
  }

  private async submitTextInput(
    request: LocalCoreCommandRequest,
  ): Promise<unknown> {
    const payload = this.objectPayload(request);
    const text = this.requiredString(payload, 'text');
    const inputId = this.requiredString(payload, 'input_id');
    const sessionId = this.optionalString(payload, 'session_id');
    try {
      const accepted = await this.chatTasks.submitText({
        ownerId: request.userId,
        operationId: this.requiredEnvelopeString(request, 'operation_id'),
        requestFingerprint: this.requiredEnvelopeString(
          request,
          'request_fingerprint',
        ),
        clientSource: this.requiredEnvelopeString(request, 'client_source'),
        text,
        inputId,
        ...(sessionId ? { sessionId } : {}),
      });
      if (accepted.task) this.scheduler.schedule(accepted.task);
      return accepted.result;
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
