import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { AuthService } from './auth.service.js';

@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket>();
    delete client.data.userId;
    try {
      client.data.userId = await this.authService.verifyToken(
        this.extractToken(client),
      );
      return true;
    } catch {
      throw new WsException('未认证');
    }
  }

  private extractToken(client: Socket): string {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string') {
      return authToken;
    }

    const authorization = client.handshake.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      return authorization.slice('Bearer '.length);
    }

    return '';
  }
}
