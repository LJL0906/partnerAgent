import type {
  AgentCancelledEvent,
  AgentErrorEvent,
  CancelRequest,
  ChatRequest,
  SessionHistoryEvent,
  SessionRequest,
} from '@partner-agent/contracts';
import { WS_EVENTS } from '@partner-agent/contracts';
import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { PiAgentService } from './pi-agent.service.js';
import { Logger } from '@nestjs/common';
import { SessionManager } from './session-manager.service.js';

type ActiveRequest = {
  socketId: string;
};

@WebSocketGateway({
  cors: {
    origin: '*', // 生产环境需要配置具体域名
  },
})
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AgentGateway.name);
  private readonly activeRequests = new Map<string, ActiveRequest>();

  constructor(
    private readonly piAgentService: PiAgentService,
    private readonly sessionManager: SessionManager,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    for (const [sessionId, request] of this.activeRequests) {
      if (request.socketId === client.id) {
        this.activeRequests.delete(sessionId);
        this.piAgentService.cancel(sessionId);
      }
    }
  }

  @SubscribeMessage(WS_EVENTS.CHAT)
  async handleChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ChatRequest,
  ) {
    let sessionId = '';
    let request: ActiveRequest | undefined;
    try {
      sessionId = this.requireSessionId(data);
      if (!data.message?.trim()) {
        throw new Error('消息不能为空');
      }
      if (this.activeRequests.has(sessionId)) {
        throw new Error(`会话 ${sessionId} 已有请求正在处理中`);
      }

      this.logger.log(
        `Received chat message from ${client.id} for session ${sessionId}`,
      );
      request = { socketId: client.id };
      this.activeRequests.set(sessionId, request);

      for await (const event of this.piAgentService.chat(
        sessionId,
        data.message,
        data.userId,
      )) {
        if (this.activeRequests.get(sessionId) !== request) {
          this.logger.log(`Session ${sessionId} cancelled`);
          break;
        }

        client.emit(WS_EVENTS.AGENT_EVENT, { ...event, sessionId });
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error in chat handler: ${err.message}`, err.stack);
      this.emitError(client, sessionId, err.message);
    } finally {
      if (request && this.activeRequests.get(sessionId) === request) {
        this.activeRequests.delete(sessionId);
      }
    }
  }

  @SubscribeMessage(WS_EVENTS.CANCEL)
  handleCancel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: CancelRequest,
  ) {
    const sessionId = this.requireSessionId(data);
    this.logger.log(`Cancel requested for session ${sessionId}`);
    this.activeRequests.delete(sessionId);
    this.piAgentService.cancel(sessionId);
    const event: AgentCancelledEvent = {
      type: 'cancelled',
      sessionId,
      timestamp: Date.now(),
    };
    client.emit(WS_EVENTS.AGENT_EVENT, event);
  }

  @SubscribeMessage(WS_EVENTS.RESUME_SESSION)
  handleResumeSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SessionRequest,
  ) {
    const sessionId = this.requireSessionId(data);
    const event: SessionHistoryEvent = {
      type: 'history',
      sessionId,
      data: {
        messages: this.sessionManager.getHistory(sessionId, data.userId),
      },
      timestamp: Date.now(),
    };
    client.emit(WS_EVENTS.AGENT_EVENT, event);
  }

  private requireSessionId(data?: { sessionId?: string }): string {
    const sessionId = data?.sessionId?.trim();
    if (!sessionId) {
      throw new Error('sessionId 不能为空');
    }
    return sessionId;
  }

  private emitError(client: Socket, sessionId: string, message: string): void {
    const event: AgentErrorEvent = {
      type: 'error',
      sessionId,
      data: { message },
      timestamp: Date.now(),
    };
    client.emit(WS_EVENTS.AGENT_EVENT, event);
  }
}
