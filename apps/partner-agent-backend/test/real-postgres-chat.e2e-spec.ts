import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { ServerPushEventV1 } from '@partner-agent/contracts';
import { SignJWT } from 'jose';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PiAgentService } from '../src/agent/pi-agent.service.js';
import { SessionManager } from '../src/agent/session-manager.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { SessionStore } from '../src/database/session-store.js';
import { TypeOrmSessionStore } from '../src/database/typeorm-session.store.js';
import { ConfirmationTransactionService } from '../src/local-core-api/confirmation-transaction.service.js';
import { SecureIoAdapter } from '../src/websocket/secure-io.adapter.js';

const databaseUrl = process.env.REAL_POSTGRES_DATABASE_URL;
const describeReal = databaseUrl ? describe : describe.skip;
const secret = 'real-postgres-e2e-secret-at-least-32-bytes';
const origin = 'https://real-postgres-e2e.example';

describeReal('PostgreSQL 16 REST + WS vertical chat loop', () => {
  let app: INestApplication;
  let sessions: SessionManager;
  let baseUrl: string;
  let token: string;
  let dataSource: DataSource;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.SESSION_STORE = 'postgres';
    process.env.AUTH_JWT_SECRET = secret;
    process.env.CORS_ALLOWED_ORIGINS = origin;

    const fakeAgent = {
      async *chat(sessionId: string, text: string, ownerId: string) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        yield { type: 'text_delta', data: `已收到：${text}`, timestamp: Date.now() };
        await sessions.saveMessage(sessionId, ownerId, 'assistant', `已收到：${text}`);
        yield { type: 'done', timestamp: Date.now() };
      },
      async cancel() {
        return true;
      },
      onModuleInit() {},
    };

    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PiAgentService)
      .useValue(fakeAgent)
      .compile();
    app = fixture.createNestApplication();
    sessions = app.get(SessionManager);
    const sessionStore = app.get(SessionStore);
    expect(sessionStore).toBeInstanceOf(TypeOrmSessionStore);
    dataSource = (sessionStore as TypeOrmSessionStore).getDataSource();
    app.useWebSocketAdapter(
      new SecureIoAdapter(app, app.get(AuthService), app.get(ConfigService)),
    );
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
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

  it('persists input, authorizes task subscription, streams and recovers final state', async () => {
    const operationId = '71000000-0000-4000-8000-000000000001';
    const inputId = '72000000-0000-4000-8000-000000000001';
    const envelope = {
      operation_id: operationId,
      client_source: 'other',
      request_fingerprint: 'real-pg-chat-fingerprint',
      payload: { text: '真实数据库闭环', input_id: inputId },
    };

    const accepted = await request(app.getHttpServer())
      .post('/api/v1/inputs/text')
      .set('Authorization', `Bearer ${token}`)
      .send(envelope)
      .expect(202);
    const taskId = accepted.body.data.chat_task.task_id as string;
    const sessionId = accepted.body.data.session_id as string;

    const socket = io(`${baseUrl}/ws/v1`, {
      auth: { token },
      extraHeaders: { Origin: origin },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    await once(socket, 'connect');
    const ackPromise = once<{ accepted: string[] }>(socket, 'subscription_ack');
    socket.emit('subscribe', {
      request_id: 'real-pg-subscribe',
      channels: [`task:${taskId}`, `operation:${operationId}`],
    });
    await expect(ackPromise).resolves.toMatchObject({
      accepted: [`task:${taskId}`, `operation:${operationId}`],
    });

    const pushed = await untilEvent(socket, 'done');
    expect(pushed).toMatchObject({
      task_id: taskId,
      operation_id: operationId,
      session_id: sessionId,
      event_type: 'done',
    });
    socket.disconnect();

    const task = await request(app.getHttpServer())
      .get(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(task.body).toMatchObject({ task_id: taskId, state: 'completed' });

    const session = await request(app.getHttpServer())
      .get(`/api/v1/chat-sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(session.body.messages.map((message: { role: string }) => message.role)).toEqual([
      'user',
      'assistant',
    ]);

    const replay = await request(app.getHttpServer())
      .post('/api/v1/inputs/text')
      .set('Authorization', `Bearer ${token}`)
      .send(envelope)
      .expect(200);
    expect(replay.body).toMatchObject({ operation_id: operationId, status: 'duplicate' });

    await request(app.getHttpServer())
      .get(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${await tokenFor('other-user')}`)
      .expect(404);
  });

  it('runs confirmation idempotency, concurrency, version and rollback checks on PostgreSQL', async () => {
    const batchId = '73000000-0000-4000-8000-000000000001';
    const candidateId = '74000000-0000-4000-8000-000000000001';
    const operationId = '75000000-0000-4000-8000-000000000001';
    await seedCandidate(batchId, candidateId);
    const service = app.get(ConfirmationTransactionService);
    const command = confirmationCommand(batchId, candidateId, operationId);

    const completed = await service.submit(command);
    expect(completed).toMatchObject({ status: 'completed' });
    const duplicate = await service.submit(command);
    expect(duplicate).toMatchObject({ status: 'duplicate' });
    await expect(
      service.submit({
        ...command,
        envelope: { ...command.envelope, request_fingerprint: 'collision' },
      }),
    ).rejects.toMatchObject({ status: 409 });
    const effects = await dataSource.query(
      `select
        (select count(*)::int from business_objects where user_id=$1 and created_by_batch_id=$2) objects,
        (select count(*)::int from object_versions v join business_objects o on o.id=v.object_id where o.user_id=$1 and o.created_by_batch_id=$2) versions,
        (select count(*)::int from object_index_jobs j join business_objects o on o.id=j.object_id where o.user_id=$1 and o.created_by_batch_id=$2) jobs`,
      ['real-pg-owner', batchId],
    );
    expect(effects[0]).toEqual({ objects: 1, versions: 1, jobs: 1 });

    const versionBatch = '73000000-0000-4000-8000-000000000002';
    const versionCandidate = '74000000-0000-4000-8000-000000000002';
    await seedCandidate(versionBatch, versionCandidate);
    const wrongVersion = confirmationCommand(
      versionBatch,
      versionCandidate,
      '75000000-0000-4000-8000-000000000002',
    );
    wrongVersion.envelope.payload.batch_version = '99';
    await expect(service.submit(wrongVersion)).rejects.toMatchObject({ status: 409 });
    expect(
      Number(
        (
          await dataSource.query(
            'select count(*) from business_objects where created_by_batch_id=$1',
            [versionBatch],
          )
        )[0].count,
      ),
    ).toBe(0);

    const concurrentBatch = '73000000-0000-4000-8000-000000000003';
    const concurrentCandidate = '74000000-0000-4000-8000-000000000003';
    await seedCandidate(concurrentBatch, concurrentCandidate);
    const concurrentResults = await Promise.allSettled([
      service.submit(
        confirmationCommand(
          concurrentBatch,
          concurrentCandidate,
          '75000000-0000-4000-8000-000000000003',
        ),
      ),
      service.submit(
        confirmationCommand(
          concurrentBatch,
          concurrentCandidate,
          '75000000-0000-4000-8000-000000000004',
        ),
      ),
    ]);
    expect(concurrentResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrentResults.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  function tokenFor(subject: string) {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(subject)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret));
  }

  async function seedCandidate(batchId: string, candidateId: string) {
    await dataSource.query(
      `insert into confirmation_batches(id,user_id,risk_level)
       values ($1,$2,'normal')`,
      [batchId, 'real-pg-owner'],
    );
    await dataSource.query(
      `insert into candidate_items(id,user_id,batch_id,kind,action,risk,payload,editable_fields)
       values ($1,$2,$3,'goal','create','normal',$4,'{title}')`,
      [candidateId, 'real-pg-owner', batchId, { title: '真实确认目标' }],
    );
  }

  function confirmationCommand(
    batchId: string,
    candidateId: string,
    operationId: string,
  ) {
    return {
      userId: 'real-pg-owner',
      input: {},
      envelope: {
        operation_id: operationId,
        client_source: 'other',
        request_fingerprint: `fingerprint-${operationId}`,
        payload: {
          confirmation_batch_id: batchId,
          batch_version: '1',
          items: [
            {
              candidate_id: candidateId,
              candidate_version: '1',
              decision: 'confirm' as const,
            },
          ],
        },
      },
    };
  }
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

function untilEvent(
  socket: ClientSocket,
  eventType: ServerPushEventV1['event_type'],
): Promise<ServerPushEventV1> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 ${eventType} 超时`)), 5000);
    const listener = (event: ServerPushEventV1) => {
      if (event.event_type !== eventType) return;
      clearTimeout(timer);
      socket.off('agent_event', listener);
      resolve(event);
    };
    socket.on('agent_event', listener);
  });
}
