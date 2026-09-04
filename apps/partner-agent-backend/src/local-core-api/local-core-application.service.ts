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

@Injectable()
export class LocalCoreApplicationService extends LocalCoreApplicationPort {
  constructor(
    private readonly sessionStore: SessionStore,
    private readonly confirmationTransaction: ConfirmationTransactionService,
  ) {
    super();
  }

  async executeCommand(
    command: string,
    request: LocalCoreCommandRequest,
  ): Promise<unknown> {
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
      ...(lastMessage
        ? { last_message_preview: lastMessage.content.slice(0, 120) }
        : {}),
    };
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
