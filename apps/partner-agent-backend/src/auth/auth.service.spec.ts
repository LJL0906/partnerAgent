import { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service.js';

const secret = 'test-secret-that-is-at-least-32-bytes';

async function createToken(
  claims: { sub?: string },
  expiresIn = '5m',
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

describe('AuthService', () => {
  const service = new AuthService(
    new ConfigService({ AUTH_JWT_SECRET: secret }),
  );

  it('returns the subject from a valid HS256 token', async () => {
    await expect(
      service.verifyToken(await createToken({ sub: 'user-x' })),
    ).resolves.toBe('user-x');
  });

  it('rejects missing, expired, invalid and subject-less tokens', async () => {
    await expect(service.verifyToken('')).rejects.toThrow();
    await expect(
      service.verifyToken(await createToken({ sub: 'user-x' }, '0s')),
    ).rejects.toThrow();
    await expect(service.verifyToken('not-a-jwt')).rejects.toThrow();
    await expect(service.verifyToken(await createToken({}))).rejects.toThrow(
      '访问令牌缺少用户标识',
    );
  });

  it('fails closed when the signing secret is missing or too short', () => {
    expect(() => new AuthService(new ConfigService())).toThrow(
      'AUTH_JWT_SECRET 未配置',
    );
    expect(
      () =>
        new AuthService(
          new ConfigService({ AUTH_JWT_SECRET: 'public-placeholder' }),
        ),
    ).toThrow('AUTH_JWT_SECRET 长度不能少于 32 字节');
  });
});
