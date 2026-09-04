import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocalCoreApiModule } from '../src/local-core-api/local-core-api.module.js';
import { SessionStore } from '../src/database/session-store.js';
import { ConfirmationTransactionService } from '../src/local-core-api/confirmation-transaction.service.js';
import { ChatTaskScheduler } from '../src/local-core-api/chat-task-scheduler.js';

const secret = 'test-secret-that-is-at-least-32-bytes';

describe('Local Core REST API (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = secret;
    process.env.SESSION_STORE = 'memory';

    const moduleFixture = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), LocalCoreApiModule],
    })
      .overrideProvider(ConfirmationTransactionService)
      .useValue({
        submit: vi.fn(async (request) => ({
          operation_id: request.envelope.operation_id,
          status: 'completed',
          data: {
            batch_ref: {
              kind: 'confirmation_batch',
              id: '20000000-0000-4000-8000-000000000001',
            },
            confirmed: [],
          },
        })),
      })
      .overrideProvider(ChatTaskScheduler)
      .useValue({ schedule: vi.fn(), cancel: vi.fn() })
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    ownerToken = await createToken('owner');
    otherToken = await createToken('other');
    const store = app.get(SessionStore);
    await store.createIfAllowed('owned-session', 'owner', 10);
    await store.appendMessage('owned-session', 'owner', 'user', '私有消息');
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.AUTH_JWT_SECRET;
    delete process.env.SESSION_STORE;
  });

  it('requires HTTP bearer authentication', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/core/health',
    );
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'AUTH_001' });
  });

  it('reports core health for an authenticated user', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/core/health')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      services: { local_core_api: { ok: true } },
      version: 'v1',
    });
  });

  it('reads only a session owned by the authenticated user', async () => {
    const owned = await request(app.getHttpServer())
      .get('/api/v1/chat-sessions/owned-session')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(owned.status).toBe(200);
    expect(owned.body).toMatchObject({
      id: 'owned-session',
      message_count: 1,
      last_message_preview: '私有消息',
    });

    const hidden = await request(app.getHttpServer())
      .get('/api/v1/chat-sessions/owned-session')
      .set('Authorization', `Bearer ${otherToken}`);
    expect(hidden.status).toBe(404);
    expect(hidden.body).toMatchObject({ code: 'AUTH_002' });
  });

  it('accepts text input and exposes its persisted task', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/inputs/text')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(command('operation-1', { text: 'hello', input_id: 'input-1' }));
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      operation_id: 'operation-1',
      status: 'accepted',
      data: { session_id: expect.any(String) },
    });
    const taskId = response.body.data.chat_task.task_id;
    const task = await request(app.getHttpServer())
      .get(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(task.status).toBe(200);
    expect(task.body).toMatchObject({ task_id: taskId, state: 'queued' });
  });

  it('maps maintenance routes to candidate-only handlers', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/object-change-candidates/restore')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(command('operation-2', { object_id: 'goal-1' }));
    expect(response.status).toBe(501);
    expect(response.body.details.handler).toBe('CreateRestoreObjectCandidate');
  });

  it('maps task cancellation to CancelTask', async () => {
    const submitted = await request(app.getHttpServer())
      .post('/api/v1/inputs/text')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(
        command('operation-before-cancel', {
          text: 'cancel me',
          input_id: 'input-cancel',
        }),
      );
    const taskId = submitted.body.data.chat_task.task_id;
    const response = await request(app.getHttpServer())
      .post('/api/v1/tasks/cancel')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(command('operation-3', { task_id: taskId }));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      operation_id: 'operation-3',
      status: 'completed',
      data: { task_id: taskId, state: 'cancelled' },
    });
  });

  it('keeps command and input retries idempotent and hides cross-owner tasks', async () => {
    const body = command('operation-idempotent', {
      text: 'once',
      input_id: 'input-idempotent',
    });
    const first = await request(app.getHttpServer())
      .post('/api/v1/inputs/text')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(body);
    const replay = await request(app.getHttpServer())
      .post('/api/v1/inputs/text')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(body);
    expect(replay.body.status).toBe('duplicate');
    expect(replay.body.data.chat_task.task_id).toBe(
      first.body.data.chat_task.task_id,
    );
    const hidden = await request(app.getHttpServer())
      .get(`/api/v1/tasks/${first.body.data.chat_task.task_id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(hidden.status).toBe(404);
    expect(hidden.body).toMatchObject({ code: 'AUTH_002' });
  });

  it('dispatches SubmitConfirmationBatch to the transactional service', async () => {
    const operationId = '10000000-0000-4000-8000-000000000001';
    const response = await request(app.getHttpServer())
      .post('/api/v1/confirmation-batches/submit')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(
        command(operationId, {
          mode: 'cancel',
          items: [
            {
              candidate_id: '30000000-0000-4000-8000-000000000001',
              kind: 'goal',
              action: 'create',
            },
          ],
        }),
      );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      operation_id: operationId,
      status: 'completed',
      data: { batch_ref: { kind: 'confirmation_batch' } },
    });
  });

  it('rejects malformed command envelopes before dispatch', async () => {
    const missing = await request(app.getHttpServer())
      .post('/api/v1/inputs/text')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ operation_id: 'operation-4', payload: {} });
    expect(missing.status).toBe(422);
    expect(missing.body).toMatchObject({ code: 'VALIDATION_002' });

    const invalid = await request(app.getHttpServer())
      .post('/api/v1/inputs/text')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(command('operation-5', []) as unknown);
    expect(invalid.status).toBe(422);
    expect(invalid.body).toMatchObject({ code: 'VALIDATION_001' });
  });
});

function command(operationId: string, payload: unknown) {
  return {
    operation_id: operationId,
    client_source: 'web',
    request_fingerprint: `fingerprint-${operationId}`,
    payload,
  };
}

async function createToken(subject: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}
