import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import type { AuthenticatedRequest } from './local-core-api.types.js';

@Injectable()
export class HttpAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;

    if (!token) throw this.unauthorized();

    try {
      request.userId = await this.authService.verifyToken(token);
      return true;
    } catch {
      throw this.unauthorized();
    }
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'AUTH_001',
      message: '未认证或访问令牌无效',
    });
  }
}
