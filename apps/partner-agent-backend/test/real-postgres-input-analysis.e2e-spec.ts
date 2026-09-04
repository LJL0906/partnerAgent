import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PiAgentService } from '../src/agent/pi-agent.service.js';
import { SessionStore } from '../src/database/session-store.js';
import { TypeOrmSessionStore } from '../src/database/typeorm-session.store.js';
import { ModelGatewayService } from '../src/model-gateway/model-gateway.service.js';

const databaseUrl = process.env.REAL_POSTGRES_DATABASE_URL;
const describeReal = databaseUrl ? describe : describe.skip;
const jwtSecret = 'real-postgres-analysis-secret-32-bytes';

describeReal('PostgreSQL input analysis rejection boundary', () => {
  let app: INestApplication;
  let token: string;
  let store: TypeOrmSessionStore;
  const ownerId = 'real-pg-analysis-owner';
  const operationId = 'real-pg-analysis-operation';
  const inputId = 'real-pg-analysis-input';
  const agentChat = vi.fn();
  const providerCreateStream = vi.fn();

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.SESSION_STORE = 'postgres';
    process.env.AUTH_JWT_SECRET = jwtSecret;
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PiAgentService)
      .useValue({ chat: agentChat, cancel: vi.fn(), onModuleInit: vi.fn() })
      .overrideProvider(ModelGatewayService)
      .useValue({
        listModels: vi.fn(() => []),
        resolveModel: vi.fn(),
        createStreamFunction: providerCreateStream,
      })
      .compile();
    app = fixture.createNestApplication();
    await app.init();
    store = app.get(SessionStore) as TypeOrmSessionStore;
    token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ownerId)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(jwtSecret));
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.DATABASE_URL;
    delete process.env.SESSION_STORE;
    delete process.env.AUTH_JWT_SECRET;
  });

  it('persists only the rejected operation and keeps all chat artifacts absent', async () => {
    const body = command('real-pg-analysis-fingerprint');
    const first = await submit(body);
    const replay = await submit(body);
    const collision = await submit(command('real-pg-analysis-other-fingerprint'));

    expect(first.status).toBe(501);
    expect(replay.status).toBe(501);
    expect(replay.body).toEqual(first.body);
    expect(collision.status).toBe(409);
    expect(collision.body).toMatchObject({ code: 'IDEMPOTENCY_001' });
    expect(agentChat).not.toHaveBeenCalled();
    expect(providerCreateStream).not.toHaveBeenCalled();

    const dataSource = store.getDataSource();
    const [operations, tasks, records, messages] = await Promise.all([
      dataSource.query(
        `select command_name, result_json from local_core_operations
         where owner_id=$1 and operation_id=$2`,
        [ownerId, operationId],
      ),
      dataSource.query(
        'select id from chat_tasks where owner_id=$1 and operation_id=$2',
        [ownerId, operationId],
      ),
      dataSource.query(
        'select id from original_records where owner_id=$1 and input_id=$2',
        [ownerId, inputId],
      ),
      dataSource.query(
        'select id from session_messages where owner_id=$1 and input_id=$2',
        [ownerId, inputId],
      ),
    ]);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      command_name: 'SubmitTextInput:input-analysis',
      result_json: { code: 'NOT_IMPLEMENTED_001' },
    });
    expect(tasks).toHaveLength(0);
    expect(records).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });

  function submit(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/inputs/text')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function command(fingerprint: string) {
    return {
      operation_id: operationId,
      client_source: 'web',
      request_fingerprint: fingerprint,
      payload: {
        text: '需要分析但不应落入聊天表',
        input_id: inputId,
        request_analysis: true,
        analysis_types: ['content_extract'],
      },
    };
  }
});
