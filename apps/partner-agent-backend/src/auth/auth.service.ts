import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify } from 'jose';

const MINIMUM_SECRET_BYTES = 32;

@Injectable()
export class AuthService {
  private readonly secret: Uint8Array;

  constructor(configService: ConfigService) {
    const secret = configService.get<string>('AUTH_JWT_SECRET');
    if (!secret) {
      throw new Error('AUTH_JWT_SECRET 未配置');
    }

    this.secret = new TextEncoder().encode(secret);
    if (this.secret.byteLength < MINIMUM_SECRET_BYTES) {
      throw new Error(
        `AUTH_JWT_SECRET 长度不能少于 ${MINIMUM_SECRET_BYTES} 字节`,
      );
    }
  }

  async verifyToken(token: string): Promise<string> {
    if (!token.trim()) {
      throw new Error('缺少访问令牌');
    }

    const { payload, protectedHeader } = await jwtVerify(token, this.secret, {
      algorithms: ['HS256'],
    });
    if (protectedHeader.alg !== 'HS256') {
      throw new Error('访问令牌算法不受支持');
    }
    if (!payload.exp) {
      throw new Error('访问令牌缺少过期时间');
    }

    const userId = payload.sub?.trim();
    if (!userId) {
      throw new Error('访问令牌缺少用户标识');
    }

    return userId;
  }
}
