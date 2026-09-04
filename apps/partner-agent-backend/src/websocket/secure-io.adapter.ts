import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service.js';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
];

export function getAllowedOrigins(configService: ConfigService): Set<string> {
  const configured = configService.get<string>('CORS_ALLOWED_ORIGINS');
  const origins = configured
    ? configured
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;

  if (origins.length === 0 || origins.includes('*')) {
    throw new Error('CORS_ALLOWED_ORIGINS 必须是非空的明确来源白名单');
  }

  return new Set(origins);
}

export class SecureIoAdapter extends IoAdapter {
  private readonly allowedOrigins: Set<string>;

  constructor(
    app: INestApplicationContext,
    private readonly authService: AuthService,
    configService: ConfigService,
  ) {
    super(app);
    this.allowedOrigins = getAllowedOrigins(configService);
  }

  createIOServer(port: number, options?: Partial<ServerOptions>): Server {
    const isAllowed = (origin?: string): boolean =>
      typeof origin === 'string' && this.allowedOrigins.has(origin);
    const serverOptions = {
      ...options,
      cors: {
        ...options?.cors,
        origin: (origin, callback) => {
          if (isAllowed(origin)) callback(null, true);
          else callback(new Error('Origin 不在允许列表中'));
        },
      },
      allowRequest: (request, callback) => {
        callback(null, isAllowed(request.headers.origin));
      },
    } as ServerOptions;
    const server = super.createIOServer(port, serverOptions) as Server;

    server.use(async (socket: Socket, next) => {
      try {
        const token = this.extractToken(socket);
        socket.data.userId = await this.authService.verifyToken(token);
        next();
      } catch {
        next(new Error('未认证'));
      }
    });

    return server;
  }

  private extractToken(socket: Socket): string {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string') return authToken;

    const authorization = socket.handshake.headers.authorization;
    return authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
  }
}
