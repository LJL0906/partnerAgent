import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { ServerPushEventV1 } from '@partner-agent/contracts';
import { SignJWT } from 'jose';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { SessionStore } from '../src/database/session-store.js';
import { TypeOrmSessionStore } from '../src/database/typeorm-session.store.js';
import { SecureIoAdapter } from '../src/websocket/secure-io.adapter.js';

const databaseUrl = process.env.REAL_POSTGRES_DATABASE_URL;
const describeReal = databaseUrl ? describe : describe.skip;
const secret = 'real-postgres-restart-secret-32-bytes';
const origin = 'https://real-postgres-restart.example';

describeReal('PostgreSQL restart recovery', () => {
  let app: INestApplication;
  let baseUrl: string;
  let taskId: string;
  let sessionId: string;
  let token: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.SESSION_STORE = 'postgres';
    process.env.AUTH_JWT_SECRET = secret;
    process.env.CORS_ALLOWED_ORIGINS = origin;
    const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.useWebSocketAdapter(
      new SecureIoAdapter(app, app.get(AuthService), app.get(ConfigService)),
    );
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    const store = app.get(SessionStore) as TypeOrmSessionStore;
    const rows = await store.getDataSource().query(
      `select id, session_id from chat_tasks
       where owner_id=$1 and state='completed'
       order by completed_at desc limit 1`,
      ['real-pg-owner'],
    );
    expect(rows).toHaveLength(1);
    taskId = rows[0].id;
    sessionId = rows[0].session_id;
    token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('real-pg-owner')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret));
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.DATABASE_URL;
    delete process.env.SESSION_STORE;
    delete process.env.AUTH_JWT_SECRET;
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  it('requests REST recovery and returns persisted task and message watermarks', async () => {
    const socket = io(`${baseUrl}/ws/v1`, {
      auth: { token },
      extraHeaders: { Origin: origin },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    await once(socket, 'connect');
    const recovery = once<ServerPushEventV1>(socket, 'agent_event');
    socket.emit('subscribe', {
      request_id: 'after-restart',
      channels: [`task:${taskId}`],
      after: { [`task:${taskId}`]: 'event-from-before-restart' },
    });
    await expect(recovery).resolves.toMatchObject({
      channel: `task:${taskId}`,
      event_type: 'recovery_required',
    });
    socket.disconnect();

    const task = await request(app.getHttpServer())
      .get(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(task.body.state).toBe('completed');
    const session = await request(app.getHttpServer())
      .get(`/api/v1/chat-sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(session.body.messages).toHaveLength(2);
    expect(session.body.message_count).toBe(2);
  });
});

function once<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 ${event} 超时`)), 5000);
    socket.once(event, (value: T) => {
      clearTimeout(timer);
      resolve(value);
    });
    socket.once('connect_error', reject);
  });
}
