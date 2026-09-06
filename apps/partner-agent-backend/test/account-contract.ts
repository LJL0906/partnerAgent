import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashPassword } from '../src/auth/account-security.js';
import { AccountStore } from '../src/auth/account-store.js';
import { type AccountTokens } from '../src/auth/account-service.js';
import { LocalCoreApiModule } from '../src/local-core-api/local-core-api.module.js';
import { ChatTaskScheduler } from '../src/local-core-api/chat-task-scheduler.js';
import { SessionStore } from '../src/database/session-store.js';

export function accountContract(
  name: string,
  create: () => Promise<{ store: AccountStore; close?: () => Promise<void> }>,
) {
  describe(name, () => {
    let app: INestApplication;
    let fixture: Awaited<ReturnType<typeof create>>;
    let tokens: AccountTokens;
    let rotated: AccountTokens;
    const username = `verify_${Date.now()}`;
    const password = 'this is a test passphrase 2026';
    const origin = 'http://localhost:8089';

    beforeAll(async () => {
      fixture = await create();
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => ({
                SESSION_STORE: 'memory',
                AUTH_JWT_SECRET: 'account-tests-secret-at-least-32-bytes',
                CORS_ALLOWED_ORIGINS: origin,
              }),
            ],
          }),
          AuthModule,
          LocalCoreApiModule,
        ],
      })
        .overrideProvider(ChatTaskScheduler)
        .useValue({ schedule: vi.fn(), resumeAfterPrivacyDecision: vi.fn(), cancel: vi.fn() })
        .overrideProvider(AccountStore)
        .useValue(fixture.store)
        .compile();
      app = module.createNestApplication();
      await app.init();
    });
    afterAll(async () => {
      await app?.close();
      await fixture?.close?.();
    });

    it('rejects malformed usernames without inserting an account', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ username: 'x', password: 'abc123' })
        .expect(400);
      expect(await fixture.store.find('x')).toBeUndefined();
    });
    it.each([
      ['少于 6 位', 'a1b2c'],
      ['不含英文字母', '123456789012'],
      ['不含数字', 'abcdefghijkl'],
      ['超过 128 位', `a${'1'.repeat(128)}`],
    ])('rejects invalid passwords: %s', async (_reason, password) => {
      const username = 'invalid_password';
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ username, password })
        .expect(400);
      expect(response.body.message).toBe(
        '密码须为 6–128 个字符，且至少包含一个英文字母和一个数字。',
      );
      expect(await fixture.store.find(username)).toBeUndefined();
    });
    it('registers and logs in with the minimum valid password', async () => {
      const username = `minimum_${Date.now()}`;
      const password = 'abc123';
      const registered = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ username, password })
        .expect(201);
      const loggedIn = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username, password })
        .expect(200);
      expect(loggedIn.body.user).toEqual(registered.body.user);
    });
    it.each(['abcdefghijklmnop', 'legacy password phrase'])(
      'logs in with a stored legacy password: %s',
      async (password) => {
        const account = {
          id: randomUUID(),
          username: `legacy_${randomUUID().slice(0, 8)}`,
          password_hash: await hashPassword(password),
        };
        expect(await fixture.store.create(account)).toBe(true);
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ username: account.username, password })
          .expect(200);
        expect(response.body.user.id).toBe(account.id);
        expect(await app.get(AuthService).verifyToken(response.body.access_token)).toBe(account.id);
      },
    );
    it('registers a stable owner and stores only a salted password hash', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ username: username.toUpperCase(), password })
        .expect(201);
      tokens = response.body;
      expect(tokens.user.username).toBe(username);
      expect(response.headers['cache-control']).toBe('no-store');
      const account = await fixture.store.find(username);
      expect(account?.password_hash).toMatch(/^scrypt-v1:/);
      expect(account?.password_hash).not.toContain(password);
      expect(await app.get(AuthService).verifyToken(tokens.access_token)).toBe(
        tokens.user.id,
      );
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.access_token}`)
        .expect(200);
      expect(me.body).toEqual(tokens.user);
    });
    it('does not create duplicate or merge independent users', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ username, password })
        .expect(409)
        .expect((response) => expect(response.body.message).toBe('用户名已被占用，请更换一个用户名。'));
      const other = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ username: `${username}_b`, password })
        .expect(201);
      expect(other.body.user.id).not.toBe(tokens.user.id);
      const sessions = app.get(SessionStore);
      const sessionId = `private-${tokens.user.id}`;
      await sessions.createIfAllowed(sessionId, tokens.user.id, 100);
      await sessions.appendMessage(sessionId, tokens.user.id, 'user', 'account isolation test');
      await request(app.getHttpServer()).get(`/api/v1/chat-sessions/${sessionId}`).set('Authorization', `Bearer ${tokens.access_token}`).expect(200);
      await request(app.getHttpServer()).get(`/api/v1/chat-sessions/${sessionId}`).set('Authorization', `Bearer ${other.body.access_token}`).expect(404);
    });
    it('uses one error for wrong passwords and unknown accounts', async () => {
      const wrong = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username, password: 'incorrect123' })
        .expect(401);
      const absent = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'nonexistent_test', password })
        .expect(401);
      expect(wrong.body).toEqual(absent.body);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username, password })
        .expect(200);
      expect(login.body.user.id).toBe(tokens.user.id);
    });
    it('atomically rotates refresh tokens; a concurrent replay loses', async () => {
      const responses = await Promise.all(
        [1, 2].map(() =>
          request(app.getHttpServer())
            .post('/api/v1/auth/refresh')
            .send({ refresh_token: tokens.refresh_token }),
        ),
      );
      expect(responses.map((res) => res.status).sort()).toEqual([200, 401]);
      rotated = responses.find((res) => res.status === 200)!.body;
      expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
      expect(rotated.user.id).toBe(tokens.user.id);
    });
    it('logout revokes refresh/access and closes subscribed account connections', async () => {
      const close = vi.fn();
      const stop = await app
        .get(AuthService)
        .watchToken(rotated.access_token, close);
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refresh_token: rotated.refresh_token })
        .expect(204);
      expect(close).toHaveBeenCalledOnce();
      await expect(
        app.get(AuthService).verifyToken(rotated.access_token),
      ).rejects.toThrow();
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: rotated.refresh_token })
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.access_token}`)
        .expect(401);
      stop();
    });
    it('web credentials use HttpOnly cookies and reject cross-origin refresh', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .set('X-Auth-Client', 'web')
        .send({ username, password })
        .expect(200);
      expect(login.body.refresh_token).toBeUndefined();
      const cookie = login.headers['set-cookie'][0];
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      const refresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', origin)
        .set('X-Auth-Client', 'web')
        .set('Cookie', cookie)
        .send({})
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', 'https://untrusted.example')
        .set('X-Auth-Client', 'web')
        .set('Cookie', refresh.headers['set-cookie'][0])
        .send({})
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', origin)
        .set('X-Auth-Client', 'web')
        .set('Cookie', refresh.headers['set-cookie'][0])
        .send({})
        .expect(204);
    });
    it('caps repeated attempts before allowing unbounded password hashing', async () => {
      for (let i = 0; i < 30; i++)
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ username: 'limit_test', password });
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'limit_test', password })
        .expect(429);
    });
  });
}
