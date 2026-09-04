import { decodeProtectedHeader, jwtVerify } from 'jose';

import { generateDevJwt, parseDevJwtArgs, runDevJwt } from './dev-jwt.js';

const secretValue = 'development-secret-with-at-least-32-bytes';
const secret = new TextEncoder().encode(secretValue);

describe('development JWT CLI', () => {
  it('requires a non-empty subject and a bounded positive expiry', () => {
    expect(() => parseDevJwtArgs([])).toThrow('必须提供非空的 --subject');
    expect(() =>
      parseDevJwtArgs(['--subject', ' ', '--expires-in', '3600']),
    ).toThrow('必须提供非空的 --subject');
    expect(() => parseDevJwtArgs(['--subject', 'user-1'])).toThrow(
      '--expires-in 必须是正整数秒数',
    );
    expect(() =>
      parseDevJwtArgs(['--subject', 'user-1', '--expires-in', '0']),
    ).toThrow('--expires-in 必须在 1 到 86400 秒之间');
    expect(() =>
      parseDevJwtArgs(['--subject', 'user-1', '--expires-in', '86401']),
    ).toThrow('--expires-in 必须在 1 到 86400 秒之间');
  });

  it('rejects unknown, repeated, and valueless parameters', () => {
    expect(() => parseDevJwtArgs(['--other', 'value'])).toThrow(
      '未知参数：--other',
    );
    expect(() => parseDevJwtArgs(['--subject'])).toThrow('--subject 缺少值');
    expect(() =>
      parseDevJwtArgs([
        '--subject',
        'user-1',
        '--subject',
        'user-2',
        '--expires-in',
        '60',
      ]),
    ).toThrow('--subject 不能重复');
  });

  it('creates an HS256 token with the requested subject and expiry', async () => {
    const nowSeconds = 1_800_000_000;
    const token = await generateDevJwt(
      { subject: 'local-user', expiresInSeconds: 3600 },
      secretValue,
      nowSeconds,
    );

    expect(decodeProtectedHeader(token)).toEqual({ alg: 'HS256' });
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      currentDate: new Date(nowSeconds * 1000),
    });
    expect(payload.sub).toBe('local-user');
    expect(payload.iat).toBe(nowSeconds);
    expect(payload.exp).toBe(nowSeconds + 3600);
  });

  it('reads the secret from AUTH_JWT_SECRET', async () => {
    const token = await runDevJwt(
      ['--subject', 'local-user', '--expires-in', '60'],
      { AUTH_JWT_SECRET: secretValue },
    );

    await expect(
      jwtVerify(token, secret, { algorithms: ['HS256'] }),
    ).resolves.toMatchObject({ payload: { sub: 'local-user' } });
  });

  it('rejects missing or short secrets without including their values', async () => {
    await expect(
      generateDevJwt(
        { subject: 'local-user', expiresInSeconds: 60 },
        undefined,
      ),
    ).rejects.toThrow('AUTH_JWT_SECRET 未配置');

    const shortSecret = 'do-not-leak';
    await expect(
      generateDevJwt(
        { subject: 'local-user', expiresInSeconds: 60 },
        shortSecret,
      ),
    ).rejects.toThrow('AUTH_JWT_SECRET 长度不能少于 32 字节');
    await generateDevJwt(
      { subject: 'local-user', expiresInSeconds: 60 },
      shortSecret,
    ).catch((error: unknown) => {
      expect(String(error)).not.toContain(shortSecret);
    });
  });
});
