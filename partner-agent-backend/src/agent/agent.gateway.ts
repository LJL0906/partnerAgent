import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PiAgentService } from './pi-agent.service.js';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*', // 生产环境需要配置具体域名
  },
})
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AgentGateway.name);
  private activeSessions: Map<string, boolean> = new Map();

  constructor(private readonly piAgentService: PiAgentService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.activeSessions.delete(client.id);
  }

  @SubscribeMessage('chat')
  async handleChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { message: string; sessionId?: string },
  ) {
    try {
      this.logger.log(`Received chat message from ${client.id}: ${data.message}`);
      this.activeSessions.set(client.id, true);

      for await (const event of this.piAgentService.chat(data.message)) {
        if (!this.activeSessions.get(client.id)) {
          this.logger.log(`Session ${client.id} cancelled`);
          break;
        }

        client.emit('agent_event', event);
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error in chat handler: ${err.message}`, err.stack);
      client.emit('agent_event', {
        type: 'error',
        data: { message: err.message },
        timestamp: Date.now(),
      });
    } finally {
      this.activeSessions.delete(client.id);
    }
  }

  @SubscribeMessage('cancel')
  async handleCancel(@ConnectedSocket() client: Socket) {
    this.logger.log(`Cancel requested for ${client.id}`);
    this.activeSessions.delete(client.id);
    client.emit('agent_event', {
      type: 'cancelled',
      timestamp: Date.now(),
    });
  }
}