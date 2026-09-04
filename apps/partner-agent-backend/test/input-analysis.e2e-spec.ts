import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SignJWT } from 'jose';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PiAgentService } from '../src/agent/pi-agent.service.js';
import { SessionStore } from '../src/database/session-store.js';
import { ChatTaskStore } from '../src/local-core-api/chat-task.store.js';
import { ModelGatewayService } from '../src/model-gateway/model-gateway.service.js';

const secret = 'input-analysis-e2e-secret-at-least-32-bytes';
const ownerId = 'analysis-owner';
const forgedOwnerId = 'forged-owner';

describe('SubmitTextInput analysis parameters (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let forgedOwnerToken: string;
  let sessions: SessionStore;
  let chatTasks: ChatTaskStore;

  const agentChat = vi.fn(() =>
    (async function* () {
      yield { type: 'done', timestamp: Date.now() };
    })(),
  );
  const providerCreateStream = vi.fn();

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = secret;
    process.env.SESSION_STORE = 'memory';

    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ModelGatewayService)
      .useValue({
        listModels: vi.fn(() => []),
        resolveModel: vi.fn(),
        createStreamFunction: providerCreateStream,
      })
      .overrideProvider(PiAgentService)
      .useValue({
        chat: agentChat,
        cancel: vi.fn(async () => false),
        onModuleInit: vi.fn(),
      })
      .compile();

    app = fixture.createNestApplication();
    await app.init();
    sessions = app.get(SessionStore);
    chatTasks = app.get(ChatTaskStore);
    ownerToken = await tokenFor(ownerId);
    forgedOwnerToken = await tokenFor(forgedOwnerId);
  });

  beforeEach(() => {
    agentChat.mockClear();
    providerCreateStream.mockClear();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.AUTH_JWT_SECRET;
    delete process.env.SESSION_STORE;
  });

  it('keeps an ordinary request without analysis parameters on the chat path', async () => {
    const response = await submit(
      ownerToken,
      command('analysis-ordinary', 'analysis-ordinary-fingerprint', {
        text: '普通聊天',
        input_id: 'analysis-ordinary-input',
      }),
    );

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      operation_id: 'analysis-ordinary',
      status: 'accepted',
      data: { chat_task: { kind: 'chat_response' } },
    });
    await vi.waitFor(() => expect(agentChat).toHaveBeenCalledOnce());
  });

  it('returns stable 501 details for an explicit analysis request', async () => {
    const operationId = 'analysis-explicit-501';
    const requestedTypes = ['action'];
    const response = await submit(
      ownerToken,
      command(operationId, 'analysis-explicit-501-fingerprint', {
        text: '请分析这段内容',
        input_id: 'analysis-explicit-501-input',
        request_analysis: true,
        analysis_types: requestedTypes,
      }),
    );

    expect(response.status).toBe(501);
    expect(response.body).toMatchObject({
      code: 'NOT_IMPLEMENTED_001',
      details: {
        feature: 'input_analysis',
        requested_types: requestedTypes,
        operation_id: operationId,
      },
    });
  });

  it('rejects analysis_types when request_analysis is false', async () => {
    const response = await submit(
      ownerToken,
      command('analysis-false-with-types', 'analysis-false-with-types-fp', {
        text: '不要分析',
        input_id: 'analysis-false-with-types-input',
        request_analysis: false,
        analysis_types: ['content_extract'],
      }),
    );

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_001',
      details: { fields: ['request_analysis', 'analysis_types'] },
    });
  });

  it.each([
    ['an empty array', []],
    ['a duplicate array', ['idea_organize', 'idea_organize']],
    ['an unknown value', ['unsupported_analysis']],
  ])('rejects %s in analysis_types', async (_case, analysisTypes) => {
    const suffix = String(_case).replaceAll(' ', '-');
    const response = await submit(
      ownerToken,
      command(`analysis-invalid-${suffix}`, `analysis-invalid-${suffix}-fp`, {
        text: '非法分析参数',
        input_id: `analysis-invalid-${suffix}-input`,
        request_analysis: true,
        analysis_types: analysisTypes,
      }),
    );

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_001',
      details: { field: 'analysis_types' },
    });
  });

  it('rejects request_analysis=true without analysis_types before side effects', async () => {
    const before = sideEffects();
    const response = await submit(
      ownerToken,
      command('analysis-missing-types', 'analysis-missing-types-fingerprint', {
        text: '缺少分析类型',
        input_id: 'analysis-missing-types-input',
        session_id: 'analysis-missing-types-session',
        request_analysis: true,
      }),
    );

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_001',
      details: { field: 'analysis_types' },
    });
    expect(agentChat).not.toHaveBeenCalled();
    expect(providerCreateStream).not.toHaveBeenCalled();
    expect(sideEffects()).toEqual(before);
    await expect(
      sessions.find('analysis-missing-types-session', ownerId),
    ).resolves.toBeUndefined();
  });

  it('does not invoke the Agent or Provider and leaves chat data unchanged', async () => {
    const before = sideEffects();
    const response = await submit(
      ownerToken,
      command('analysis-zero-effects', 'analysis-zero-effects-fingerprint', {
        text: '不能产生任何聊天副作用',
        input_id: 'analysis-zero-effects-input',
        session_id: 'analysis-zero-effects-session',
        request_analysis: true,
        analysis_types: ['experience_review'],
      }),
    );

    expect(response.status).toBe(501);
    expect(agentChat).not.toHaveBeenCalled();
    expect(providerCreateStream).not.toHaveBeenCalled();
    expect(sideEffects()).toEqual(before);
    await expect(
      sessions.find('analysis-zero-effects-session', ownerId),
    ).resolves.toBeUndefined();
  });

  it('strips forged envelope and payload identities in favor of JWT sub', async () => {
    const response = await submit(ownerToken, {
      ...command('analysis-forged-owner', 'analysis-forged-owner-fingerprint', {
        text: '身份边界',
        input_id: 'analysis-forged-owner-input',
        session_id: 'analysis-forged-owner-session',
        user_id: forgedOwnerId,
        userId: forgedOwnerId,
      }),
      user_id: forgedOwnerId,
      userId: forgedOwnerId,
    });

    expect(response.status).toBe(202);
    await expect(
      sessions.find('analysis-forged-owner-session', ownerId),
    ).resolves.toMatchObject({ ownerId, messages: [{ content: '身份边界' }] });
    await expect(
      sessions.find('analysis-forged-owner-session', forgedOwnerId),
    ).resolves.toBeUndefined();
  });

  it('scopes rejected-operation idempotency to JWT owner, not forged body identity', async () => {
    const operationId = 'analysis-owner-boundary';
    const body = {
      ...analysisCommand(operationId, 'analysis-owner-boundary-fingerprint'),
      user_id: forgedOwnerId,
      payload: {
        ...analysisCommand(operationId, 'unused').payload,
        user_id: forgedOwnerId,
      },
    };

    const ownerResponse = await submit(ownerToken, body);
    const forgedOwnerResponse = await submit(forgedOwnerToken, {
      ...body,
      request_fingerprint: 'analysis-owner-boundary-other-fingerprint',
    });

    expect(ownerResponse.status).toBe(501);
    expect(forgedOwnerResponse.status).toBe(501);
    expect(forgedOwnerResponse.body).toMatchObject({
      code: 'NOT_IMPLEMENTED_001',
      details: { operation_id: operationId },
    });
  });

  it('replays the same rejection and rejects an operation fingerprint collision', async () => {
    const operationId = 'analysis-rejection-idempotency';
    const body = analysisCommand(
      operationId,
      'analysis-rejection-idempotency-fingerprint',
    );

    const first = await submit(ownerToken, body);
    const replay = await submit(ownerToken, body);
    const collision = await submit(ownerToken, {
      ...body,
      request_fingerprint: 'analysis-rejection-collision',
    });

    expect(first.status).toBe(501);
    expect(replay.status).toBe(501);
    expect(replay.body).toEqual(first.body);
    expect(collision.status).toBe(409);
    expect(collision.body).toMatchObject({ code: 'IDEMPOTENCY_001' });
    expect(agentChat).not.toHaveBeenCalled();
    expect(providerCreateStream).not.toHaveBeenCalled();
  });

  function submit(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/inputs/text')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function sideEffects() {
    const sessionState = sessions as unknown as {
      sessions: Map<string, { messages: unknown[] }>;
    };
    const taskState = chatTasks as unknown as {
      tasks: Map<string, unknown>;
      inputs: Map<string, unknown>;
    };
    return {
      sessions: sessionState.sessions.size,
      messages: [...sessionState.sessions.values()].reduce(
        (sum, session) => sum + session.messages.length,
        0,
      ),
      tasks: taskState.tasks.size,
      inputsAndOriginalRecords: taskState.inputs.size,
    };
  }
});

function command(
  operationId: string,
  fingerprint: string,
  payload: Record<string, unknown>,
) {
  return {
    operation_id: operationId,
    client_source: 'web',
    request_fingerprint: fingerprint,
    payload,
  };
}

function analysisCommand(operationId: string, fingerprint: string) {
  return command(operationId, fingerprint, {
    text: '需要显式分析',
    input_id: `${operationId}-input`,
    request_analysis: true,
    analysis_types: ['content_extract'],
  });
}

function tokenFor(subject: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}
