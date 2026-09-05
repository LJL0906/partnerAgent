import { UseGuards } from '@nestjs/common';
import type {
  PingRequestV1,
  SubscribeRequestV1,
  ToolConfirmationControlRequestV1,
  ToolUndoControlRequestV1,
  UnsubscribeRequestV1,
} from '@partner-agent/contracts';
import { WS_CONTROL_EVENTS, WS_SERVER_EVENTS } from '@partner-agent/contracts';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type {
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service.js';
import { WsAuthGuard } from '../auth/ws-auth.guard.js';
import { WsV1Service } from './ws-v1.service.js';
import { WsV1ToolControlService } from './ws-v1-tool-control.service.js';

@UseGuards(WsAuthGuard)
@WebSocketGateway({ namespace: '/ws/v1' })
export class WsV1Gateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private readonly authService: AuthService,
    private readonly service: WsV1Service,
    private readonly toolControl: WsV1ToolControlService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      client.data.userId = await this.authService.verifyToken(
        this.extractToken(client),
      );
      this.service.connect(client);
      const stopWatching = await this.authService.watchToken(this.extractToken(client), () => client.disconnect(true));
      if (!client.connected) stopWatching();
      else client.once('disconnect', stopWatching);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.service.disconnect(client);
  }

  @SubscribeMessage(WS_CONTROL_EVENTS.SUBSCRIBE)
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() request: SubscribeRequestV1,
  ): Promise<void> {
    const result = await this.service.subscribe(client, request);
    client.emit(WS_CONTROL_EVENTS.SUBSCRIPTION_ACK, result.ack);
    for (const event of result.replay) {
      client.emit(WS_SERVER_EVENTS.AGENT_EVENT, event);
    }
    this.service.activateSubscriptions(client, result.ack.accepted);
  }

  @SubscribeMessage(WS_CONTROL_EVENTS.UNSUBSCRIBE)
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() request: UnsubscribeRequestV1,
  ): void {
    client.emit(
      WS_CONTROL_EVENTS.SUBSCRIPTION_ACK,
      this.service.unsubscribe(client, request),
    );
  }

  @SubscribeMessage(WS_CONTROL_EVENTS.CONFIRM_TOOL_EXECUTION)
  async handleConfirmToolExecution(
    @ConnectedSocket() client: Socket,
    @MessageBody() request: ToolConfirmationControlRequestV1,
  ): Promise<void> {
    client.emit(
      WS_CONTROL_EVENTS.TOOL_CONTROL_ACK,
      await this.toolControl.confirm(client, request),
    );
  }

  @SubscribeMessage(WS_CONTROL_EVENTS.DISMISS_TOOL_EXECUTION)
  async handleDismissToolExecution(
    @ConnectedSocket() client: Socket,
    @MessageBody() request: ToolConfirmationControlRequestV1,
  ): Promise<void> {
    client.emit(
      WS_CONTROL_EVENTS.TOOL_CONTROL_ACK,
      await this.toolControl.dismiss(client, request),
    );
  }

  @SubscribeMessage(WS_CONTROL_EVENTS.UNDO_TOOL_EXECUTION)
  async handleUndoToolExecution(
    @ConnectedSocket() client: Socket,
    @MessageBody() request: ToolUndoControlRequestV1,
  ): Promise<void> {
    client.emit(
      WS_CONTROL_EVENTS.TOOL_CONTROL_ACK,
      await this.toolControl.undo(client, request),
    );
  }

  @SubscribeMessage(WS_CONTROL_EVENTS.PING)
  handlePing(
    @ConnectedSocket() client: Socket,
    @MessageBody() request: PingRequestV1,
  ): void {
    client.emit(WS_CONTROL_EVENTS.PONG, request);
  }

  private extractToken(client: Socket): string {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string') return authToken;
    const authorization = client.handshake.headers.authorization;
    return authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
  }
}
