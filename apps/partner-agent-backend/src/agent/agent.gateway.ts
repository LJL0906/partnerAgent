import type {
  AgentCancelledEvent,
  AgentErrorEvent,
  CancelRequest,
  ChatRequest,
  SessionHistoryEvent,
  SessionRequest,
  ToolConfirmationConfirmedEvent,
  ToolConfirmationDismissedEvent,
  ToolConfirmationRequest,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  ToolUndoAvailableEvent,
  ToolUndoCompletedEvent,
  ToolUndoRequest,
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
import { Logger, UseGuards } from '@nestjs/common';
import { SessionManager } from './session-manager.service.js';
import { WsAuthGuard } from '../auth/ws-auth.guard.js';
import { ExternalToolApprovalService } from '../tools/confirmation-center.service.js';

type ActiveRequest = {
  socketId: string;
  ownerId: string;
};

@UseGuards(WsAuthGuard)
@WebSocketGateway()
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AgentGateway.name);
  private readonly activeRequests = new Map<string, ActiveRequest>();

  constructor(
    private readonly piAgentService: PiAgentService,
    private readonly sessionManager: SessionManager,
    private readonly externalToolApproval: ExternalToolApprovalService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    for (const [sessionId, request] of this.activeRequests) {
      if (request.socketId === client.id) {
        this.activeRequests.delete(sessionId);
        await this.piAgentService.cancel(sessionId, request.ownerId);
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
      const ownerId = this.requireUserId(client);
      if (!data.message?.trim()) {
        throw new Error('消息不能为空');
      }
      await this.sessionManager.getOrCreate(sessionId, ownerId);
      if (this.activeRequests.has(sessionId)) {
        throw new Error(`会话 ${sessionId} 已有请求正在处理中`);
      }

      this.logger.log(
        `Received chat message from ${client.id} for session ${sessionId}`,
      );
      request = { socketId: client.id, ownerId };
      this.activeRequests.set(sessionId, request);

      for await (const event of this.piAgentService.chat(
        sessionId,
        data.message,
        ownerId,
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
  async handleCancel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: CancelRequest,
  ) {
    let sessionId = '';
    try {
      sessionId = this.requireSessionId(data);
      const ownerId = this.requireUserId(client);
      await this.sessionManager.assertOwnership(sessionId, ownerId);
      this.logger.log(`Cancel requested for session ${sessionId}`);
      this.activeRequests.delete(sessionId);
      await this.piAgentService.cancel(sessionId, ownerId);
      const event: AgentCancelledEvent = {
        type: 'cancelled',
        sessionId,
        timestamp: Date.now(),
      };
      client.emit(WS_EVENTS.AGENT_EVENT, event);
    } catch (error) {
      const err = error as Error;
      this.emitError(client, sessionId, err.message);
    }
  }

  @SubscribeMessage(WS_EVENTS.RESUME_SESSION)
  async handleResumeSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SessionRequest,
  ) {
    let sessionId = '';
    try {
      sessionId = this.requireSessionId(data);
      const ownerId = this.requireUserId(client);
      const event: SessionHistoryEvent = {
        type: 'history',
        sessionId,
        data: {
          messages: await this.sessionManager.getHistory(sessionId, ownerId),
        },
        timestamp: Date.now(),
      };
      client.emit(WS_EVENTS.AGENT_EVENT, event);
    } catch (error) {
      const err = error as Error;
      this.emitError(client, sessionId, err.message);
    }
  }

  @SubscribeMessage(WS_EVENTS.CONFIRM_TOOL_EXECUTION)
  async handleConfirmToolExecution(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ToolConfirmationRequest,
  ) {
    const sessionId = data?.sessionId?.trim() ?? '';
    try {
      const ownerId = this.requireUserId(client);
      this.requireSessionId(data);
      const outcome = await this.externalToolApproval.confirm(
        data.confirmationId,
        { ownerId, sessionId },
        ({ tool, toolCallId }) => {
          const confirmed: ToolConfirmationConfirmedEvent = {
            type: 'tool_confirmation_confirmed',
            sessionId,
            timestamp: Date.now(),
            data: { confirmationId: data.confirmationId, tool, toolCallId },
          };
          const started: ToolExecutionStartEvent = {
            type: 'tool_execution_start',
            sessionId,
            timestamp: Date.now(),
            data: { tool, toolCallId },
          };
          client.emit(WS_EVENTS.AGENT_EVENT, confirmed);
          client.emit(WS_EVENTS.AGENT_EVENT, started);
        },
      );
      const ended: ToolExecutionEndEvent = {
        type: 'tool_execution_end',
        sessionId,
        timestamp: Date.now(),
        data: {
          tool: outcome.tool,
          toolCallId: outcome.toolCallId,
          success: true,
          executionId: outcome.outcome.executionId,
          undoAvailable: Boolean(outcome.outcome.executionId),
          undoExpiresAt: outcome.outcome.externalUndoExpiresAt?.getTime(),
        },
      };
      client.emit(WS_EVENTS.AGENT_EVENT, ended);
      if (
        outcome.outcome.executionId &&
        outcome.outcome.externalUndoExpiresAt
      ) {
        const undoAvailable: ToolUndoAvailableEvent = {
          type: 'tool_undo_available',
          sessionId,
          timestamp: Date.now(),
          data: {
            executionId: outcome.outcome.executionId,
            tool: outcome.tool,
            expiresAt: outcome.outcome.externalUndoExpiresAt.getTime(),
          },
        };
        client.emit(WS_EVENTS.AGENT_EVENT, undoAvailable);
      }
    } catch (error) {
      this.emitError(client, sessionId, (error as Error).message);
    }
  }

  @SubscribeMessage(WS_EVENTS.DISMISS_TOOL_EXECUTION)
  async handleDismissToolExecution(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ToolConfirmationRequest,
  ) {
    const sessionId = data?.sessionId?.trim() ?? '';
    try {
      const ownerId = this.requireUserId(client);
      this.requireSessionId(data);
      const outcome = await this.externalToolApproval.dismiss(
        data.confirmationId,
        { ownerId, sessionId },
      );
      const event: ToolConfirmationDismissedEvent = {
        type: 'tool_confirmation_dismissed',
        sessionId,
        timestamp: Date.now(),
        data: {
          confirmationId: data.confirmationId,
          tool: outcome.tool,
          toolCallId: outcome.toolCallId,
          reason: 'user_dismissed',
        },
      };
      client.emit(WS_EVENTS.AGENT_EVENT, event);
    } catch (error) {
      this.emitError(client, sessionId, (error as Error).message);
    }
  }

  @SubscribeMessage(WS_EVENTS.UNDO_TOOL_EXECUTION)
  async handleUndoToolExecution(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ToolUndoRequest,
  ) {
    const sessionId = data?.sessionId?.trim() ?? '';
    try {
      const ownerId = this.requireUserId(client);
      this.requireSessionId(data);
      const outcome = await this.externalToolApproval.undo(data.executionId, {
        ownerId,
        sessionId,
      });
      const event: ToolUndoCompletedEvent = {
        type: 'tool_undo_completed',
        sessionId,
        timestamp: Date.now(),
        data: {
          executionId: data.executionId,
          tool: outcome.tool,
          success: true,
        },
      };
      client.emit(WS_EVENTS.AGENT_EVENT, event);
    } catch (error) {
      this.emitError(client, sessionId, (error as Error).message);
    }
  }

  private requireUserId(client: Socket): string {
    const userId = client.data.userId;
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new Error('未认证');
    }
    return userId;
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
