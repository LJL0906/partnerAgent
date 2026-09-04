import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SignJWT } from 'jose';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { AgentEvent } from '@partner-agent/contracts';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PiAgentService } from '../src/agent/pi-agent.service.js';
import { SecureIoAdapter } from '../src/websocket/secure-io.adapter.js';

const secret = 'test-secret-that-is-at-least-32-bytes';
const allowedOrigin = 'https://allowed.example';

describe('Agent WebSocket authentication (e2e)', () => {
  let app: INestApplication;
  let url: string;
  const clients: ClientSocket[] = [];
  const cancel = vi.fn();

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = secret;
    process.env.CORS_ALLOWED_ORIGINS = allowedOrigin;
    process.env.MAX_SESSIONS_PER_USER = '1';
    process.env.SESSION_STORE = 'memory';

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PiAgentService)
      .useValue({
        async *chat() {
          yield { type: 'done', timestamp: Date.now() };
        },
        cancel,
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(
      new SecureIoAdapter(app, app.get(AuthService), app.get(ConfigService)),
    );
    await app.listen(0);
    expect(app.getHttpServer().listenerCount('upgrade')).toBeGreaterThan(0);
    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.disconnect();
    cancel.mockClear();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.AUTH_JWT_SECRET;
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.MAX_SESSIONS_PER_USER;
    delete process.env.SESSION_STORE;
  });

  it('rejects connections without a token or from a non-allowed origin', async () => {
    await expect(connect(undefined, allowedOrigin)).rejects.toThrow(
      '连接被拒绝',
    );
    await expect(
      connect(await createToken('cors-user'), 'https://evil.example'),
    ).rejects.toThrow('连接被拒绝');
  });

  it('prevents one user from reading, continuing or cancelling another user session', async () => {
    const owner = await connect(await createToken('owner-x'), allowedOrigin);
    const attacker = await connect(
      await createToken('attacker-y'),
      allowedOrigin,
    );
    let leakedHistory = false;
    attacker.on('agent_event', (event: AgentEvent) => {
      if (event.type === 'history') leakedHistory = true;
    });

    await emitAndWait(
      owner,
      'chat',
      {
        sessionId: 'private-session',
        message: '创建会话',
      },
      'done',
    );

    for (const eventName of ['resume_session', 'chat', 'cancel']) {
      const payload =
        eventName === 'chat'
          ? { sessionId: 'private-session', message: '越权请求' }
          : { sessionId: 'private-session' };
      const event = await emitAndWait(attacker, eventName, payload, 'error');
      expect(event).toMatchObject({ data: { message: '会话不存在' } });
    }

    expect(cancel).not.toHaveBeenCalled();
    expect(leakedHistory).toBe(false);
  });

  it('limits sessions per user without affecting another user', async () => {
    const userX = await connect(await createToken('limited-x'), allowedOrigin);
    const userY = await connect(await createToken('limited-y'), allowedOrigin);

    await emitAndWait(
      userX,
      'chat',
      { sessionId: 'limited-x-1', message: '第一个' },
      'done',
    );
    const limitError = await emitAndWait(
      userX,
      'chat',
      { sessionId: 'limited-x-2', message: '第二个' },
      'error',
    );
    expect(limitError).toMatchObject({
      data: { message: '用户会话数量已达到上限 1' },
    });

    await expect(
      emitAndWait(
        userY,
        'chat',
        { sessionId: 'limited-y-1', message: '另一个用户' },
        'done',
      ),
    ).resolves.toMatchObject({ type: 'done' });
  });

  async function connect(
    token: string | undefined,
    origin: string,
  ): Promise<ClientSocket> {
    const client = io(url, {
      auth: token ? { token } : {},
      extraHeaders: { Origin: origin },
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    clients.push(client);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接超时')), 3000);
      client.once('connect', () => {
        clearTimeout(timer);
        resolve(client);
      });
      client.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(new Error(`连接被拒绝: ${error.message}`));
      });
    });
  }

  function emitAndWait(
    client: ClientSocket,
    eventName: string,
    payload: object,
    expectedType: AgentEvent['type'],
  ): Promise<AgentEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('事件等待超时')), 3000);
      const listener = (event: AgentEvent) => {
        if (event.type !== expectedType) return;
        clearTimeout(timer);
        client.off('agent_event', listener);
        resolve(event);
      };
      client.on('agent_event', listener);
      client.emit(eventName, payload);
    });
  }
});

async function createToken(subject: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}
