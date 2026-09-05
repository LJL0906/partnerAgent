import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify } from 'jose';
import { AccountStore } from './账户存储.js';

const MINIMUM_SECRET_BYTES = 32;

@Injectable()
export class AuthService {
  private readonly secret: Uint8Array;

  constructor(
    configService: ConfigService,
    @Optional() private readonly accounts?: AccountStore,
  ) {
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

    if (payload.sid !== undefined) {
      if (
        typeof payload.sid !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(payload.sid) ||
        protectedHeader.typ !== 'at+jwt' ||
        payload.iss !== 'partner-agent' ||
        payload.aud !== 'partner-agent'
      )
        throw new Error('访问令牌无效');
      const session = await this.accounts?.getSession(payload.sid);
      if (
        !session ||
        session.user_id !== userId ||
        session.revoked_at ||
        session.expires_at.getTime() <= Date.now()
      )
        throw new Error('登录会话已失效');
    }

    return userId;
  }

  /** Call only after verifyToken; close active account sockets on expiry or local logout. */
  async watchToken(token: string, close: () => void): Promise<() => void> {
    const { payload } = await jwtVerify(token, this.secret, {
      algorithms: ['HS256'],
    });
    if (typeof payload.sid !== 'string') return () => undefined;
    const stop = this.accounts?.onRevoke((id) => {
      if (id === payload.sid) close();
    });
    const timer = setTimeout(
      close,
      Math.max(
        0,
        Math.min((payload.exp ?? 0) * 1000 - Date.now(), 2_147_483_647),
      ),
    );
    timer.unref();
    try {
      await this.verifyToken(token);
    } catch {
      stop?.();
      clearTimeout(timer);
      close();
    }
    return () => {
      stop?.();
      clearTimeout(timer);
    };
  }
}
