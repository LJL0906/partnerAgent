import { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service.js';

const secret = 'test-secret-that-is-at-least-32-bytes';
const accountSessionId = '11111111-1111-4111-8111-111111111111';

async function createToken(
  claims: Record<string, unknown>,
  header: Record<string, string> = {},
  expiresIn = '5m',
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', ...header })
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

describe('AuthService', () => {
  const service = new AuthService(
    new ConfigService({ AUTH_JWT_SECRET: secret }),
  );

  it('returns the subject from a valid legacy Agent HS256 token', async () => {
    await expect(
      service.verifyToken(await createToken({ sub: 'user-x' })),
    ).resolves.toBe('user-x');
  });

  it('requires all account access token claims when the account token marker is present', async () => {
    const accountClaims = { sub: 'user-x', sid: accountSessionId };
    await expect(
      service.verifyToken(await createToken(accountClaims, { typ: 'at+jwt' })),
    ).rejects.toThrow('访问令牌无效');
    await expect(
      service.verifyToken(await createToken({ sub: 'user-x' }, { typ: 'at+jwt' })),
    ).rejects.toThrow('访问令牌无效');
    await expect(
      service.verifyToken(
        await createToken(
          { sub: 'user-x', sid: accountSessionId },
          { typ: 'at+jwt' },
        ),
      ),
    ).rejects.toThrow('访问令牌无效');
  });

  it('rejects an account-marked token with an invalid session instead of treating it as a legacy token', async () => {
    const token = await createToken(
      {
        sub: 'user-x',
        sid: accountSessionId,
        iss: 'partner-agent',
        aud: 'partner-agent',
      },
      { typ: 'at+jwt' },
    );
    await expect(service.verifyToken(token)).rejects.toThrow('登录会话已失效');
  });

  it('rejects missing, expired, invalid and subject-less tokens', async () => {
    await expect(service.verifyToken('')).rejects.toThrow();
    await expect(
      service.verifyToken(await createToken({ sub: 'user-x' }, {}, '0s')),
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
