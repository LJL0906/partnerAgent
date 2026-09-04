import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Type } from 'typebox';
import type {
  ServerPushEventV1,
  SubscriptionAckV1,
  ToolControlAckV1,
} from '@partner-agent/contracts';
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
import { AuthService } from '../src/auth/auth.service.js';
import { SessionStore } from '../src/database/session-store.js';
import { ChatTaskEventBus } from '../src/local-core-api/chat-task-event.bus.js';
import {
  ChatTaskScheduler,
  PiChatTaskScheduler,
} from '../src/local-core-api/chat-task-scheduler.js';
import { ChatTaskStore } from '../src/local-core-api/chat-task.store.js';
import { ToolExecutionService } from '../src/tools/tool-execution.service.js';
import { ToolRegistryService } from '../src/tools/tool-registry.service.js';
import { SecureIoAdapter } from '../src/websocket/secure-io.adapter.js';
import { WsV1Service } from '../src/ws-v1/ws-v1.service.js';

const secret = 'ws-v1-test-secret-that-is-at-least-32-bytes';
const allowedOrigin = 'https://ws-v1.example';

describe('WS v1 subscriptions (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let wsV1: WsV1Service;
  let taskEvents: ChatTaskEventBus;
  let ownedTaskId: string;
  let sessionStore: SessionStore;
  let chatTasks: ChatTaskStore;
  let toolExecution: ToolExecutionService;
  const externalToolHandler = vi.fn(async () => ({
    content: [{ type: 'text' as const, text: 'external result' }],
    details: { changed: true },
  }));
  const externalToolUndo = vi.fn(async () => undefined);
  const claimToolDecision = vi.fn(
    async (_task: unknown, confirmationId: string) => ({
      confirmationId,
      leaseToken: `tool-lease-${confirmationId}`,
    }),
  );
  const resumeClaimedToolDecision = vi.fn();
  const failClaimedToolDecision = vi.fn(async () => undefined);
  const expireToolDecision = vi.fn(async () => true);
  const ownedOperationId = 'ws-owned-operation';
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = secret;
    process.env.CORS_ALLOWED_ORIGINS = allowedOrigin;
    process.env.SESSION_STORE = 'memory';

    const { AppModule } = await import('../src/app.module.js');
    const schedulerStub = {
      claimToolDecision,
      resumeClaimedToolDecision,
      failClaimedToolDecision,
      expireToolDecision,
      schedule: vi.fn(),
      resumeAfterPrivacyDecision: vi.fn(),
      cancel: vi.fn(),
    };
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PiChatTaskScheduler)
      .useValue(schedulerStub)
      .overrideProvider(ChatTaskScheduler)
      .useValue(schedulerStub)
      .compile();
    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(
      new SecureIoAdapter(app, app.get(AuthService), app.get(ConfigService)),
    );
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}/ws/v1`;
    wsV1 = app.get(WsV1Service);
    sessionStore = app.get(SessionStore);
    await sessionStore.createIfAllowed('owned-session', 'owner', 10);
    taskEvents = app.get(ChatTaskEventBus);
    chatTasks = app.get(ChatTaskStore);
    toolExecution = app.get(ToolExecutionService);
    app.get(ToolRegistryService).register({
      tool: {
        name: 'ws_test_external_write',
        label: 'WS 测试外部写入',
        description: '仅用于测试正式 WS v1 工具控制闭环',
        parameters: Type.Object({ value: Type.String() }),
        execute: externalToolHandler,
      },
      riskLevel: 'high',
      effect: 'external_side_effect',
      capabilities: ['external_api'],
      requiredPermissions: [],
      requiresToolApproval: true,
      createUndoPayload: () => ({ resourceId: 'resource-1' }),
      undo: externalToolUndo,
    });
    const accepted = await chatTasks.submitText({
      ownerId: 'owner',
      operationId: ownedOperationId,
      requestFingerprint: 'ws-owned-fingerprint',
      clientSource: 'web',
      text: '用于 WS 授权测试',
      inputId: 'ws-owned-input',
      sessionId: 'owned-session',
    });
    ownedTaskId = accepted.task!.taskId;
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.disconnect();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.AUTH_JWT_SECRET;
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.SESSION_STORE;
  });

  it('authorizes user, session, task and operation channels from authoritative ownership', async () => {
    const owner = await connect('owner');
    const ack = await subscribe(owner, {
      request_id: 'subscribe-1',
      channels: [
        'user:self',
        'session:owned-session',
        `task:${ownedTaskId}`,
        `operation:${ownedOperationId}`,
        'task:unknown-task',
        'operation:unknown-operation',
        'user:someone-else',
      ],
    });

    expect(ack.accepted).toEqual([
      'user:self',
      'session:owned-session',
      `task:${ownedTaskId}`,
      `operation:${ownedOperationId}`,
    ]);
    expect(ack.rejected).toEqual([
      expect.objectContaining({
        channel: 'task:unknown-task',
        code: 'AUTH_002',
      }),
      expect.objectContaining({
        channel: 'operation:unknown-operation',
        code: 'AUTH_002',
      }),
      expect.objectContaining({
        channel: 'user:someone-else',
        code: 'VALIDATION_001',
      }),
    ]);

    const attacker = await connect('attacker');
    const attackerAck = await subscribe(attacker, {
      request_id: 'subscribe-2',
      channels: [
        'session:owned-session',
        `task:${ownedTaskId}`,
        `operation:${ownedOperationId}`,
      ],
    });
    expect(attackerAck.accepted).toEqual([]);
    expect(attackerAck.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'session:owned-session',
          code: 'AUTH_002',
        }),
        expect.objectContaining({
          channel: `task:${ownedTaskId}`,
          code: 'AUTH_002',
        }),
        expect.objectContaining({
          channel: `operation:${ownedOperationId}`,
          code: 'AUTH_002',
        }),
      ]),
    );
  });

  it('maps persisted task lifecycle events onto task subscriptions', async () => {
    const client = await connect('owner');
    await subscribe(client, {
      request_id: 'subscribe-task-state',
      channels: [`task:${ownedTaskId}`],
    });

    const runningPromise = nextAgentEvent(client);
    taskEvents.publish({
      ownerId: 'owner',
      taskId: ownedTaskId,
      operationId: ownedOperationId,
      sessionId: 'owned-session',
      state: 'running',
      type: 'state_changed',
    });
    await expect(runningPromise).resolves.toMatchObject({
      channel: `task:${ownedTaskId}`,
      task_id: ownedTaskId,
      operation_id: ownedOperationId,
      session_id: 'owned-session',
      event_type: 'task_state',
      data: { state: 'running' },
    });

    const deltaPromise = nextAgentEvent(client);
    taskEvents.publish({
      ownerId: 'owner',
      taskId: ownedTaskId,
      operationId: ownedOperationId,
      sessionId: 'owned-session',
      state: 'running',
      type: 'agent_event',
      eventType: 'tool_execution_start',
      data: { tool: 'get_current_time', toolCallId: 'call-1' },
    });
    await expect(deltaPromise).resolves.toMatchObject({
      event_type: 'tool_execution_start',
      data: { tool: 'get_current_time', tool_call_id: 'call-1' },
    });
  });

  it('publishes only the safe privacy decision recovery summary', async () => {
    const client = await connect('owner');
    await subscribe(client, {
      request_id: 'subscribe-privacy-decision',
      channels: [`task:${ownedTaskId}`],
    });

    const eventPromise = nextAgentEvent(client);
    taskEvents.publish({
      ownerId: 'owner',
      taskId: ownedTaskId,
      operationId: ownedOperationId,
      sessionId: 'owned-session',
      state: 'waiting_privacy_decision',
      type: 'state_changed',
      data: {
        privacyDecision: {
          egressId: 'egress-safe-id',
          categories: ['api_key'],
          provider: 'deepseek',
          modelId: 'deepseek-chat',
          expiresAt: '2026-09-04T12:15:00.000Z',
          matchedText: 'sk-sensitive-plaintext',
          request: { authorization: 'Bearer sensitive-token' },
        },
      },
    });

    const event = await eventPromise;
    expect(event).toMatchObject({
      event_type: 'task_state',
      data: {
        state: 'waiting_privacy_decision',
        privacy_decision: {
          egress_id: 'egress-safe-id',
          categories: ['api_key'],
          provider: 'deepseek',
          model_id: 'deepseek-chat',
          expires_at: '2026-09-04T12:15:00.000Z',
        },
      },
    });
    expect(event.data).toEqual({
      state: 'waiting_privacy_decision',
      privacy_decision: {
        egress_id: 'egress-safe-id',
        categories: ['api_key'],
        provider: 'deepseek',
        model_id: 'deepseek-chat',
        expires_at: '2026-09-04T12:15:00.000Z',
      },
    });
    expect(JSON.stringify(event)).not.toContain('sensitive-plaintext');
    expect(JSON.stringify(event)).not.toContain('sensitive-token');
  });

  it('orders live events and replays events after a known event id', async () => {
    const firstClient = await connect('owner');
    await subscribe(firstClient, {
      request_id: 'subscribe-live',
      channels: ['session:owned-session'],
    });

    const firstPromise = nextAgentEvent(firstClient);
    const firstPublished = await wsV1.publish({
      channel: 'session:owned-session',
      session_id: 'owned-session',
      event_type: 'text_delta',
      data: 'first',
    });
    const first = await firstPromise;
    expect(first).toEqual(firstPublished);
    expect(first.sequence).toBeGreaterThan(0);
    expect(first.event_id).toMatch(/^[0-9a-f-]{36}$/);

    firstClient.disconnect();
    const secondPublished = await wsV1.publish({
      channel: 'session:owned-session',
      session_id: 'owned-session',
      event_type: 'done',
      data: {},
    });

    const resumed = await connect('owner');
    const replayPromise = nextAgentEvent(resumed);
    await subscribe(resumed, {
      request_id: 'subscribe-replay',
      channels: ['session:owned-session'],
      after: { 'session:owned-session': first.event_id },
    });
    await expect(replayPromise).resolves.toEqual(secondPublished);
    expect(secondPublished.sequence).toBe(first.sequence + 1);
  });

  it('requests REST recovery for an unavailable replay cursor', async () => {
    const client = await connect('owner');
    const recoveryPromise = nextAgentEvent(client);
    await subscribe(client, {
      request_id: 'subscribe-recovery',
      channels: ['session:owned-session'],
      after: { 'session:owned-session': 'not-retained' },
    });

    await expect(recoveryPromise).resolves.toMatchObject({
      schema_version: 1,
      channel: 'session:owned-session',
      event_type: 'recovery_required',
      data: { reason: 'event_expired' },
    });
  });

  it('supports ping and stops delivery after unsubscribe', async () => {
    const client = await connect('owner');
    const otherUser = await connect('attacker');
    await subscribe(client, {
      request_id: 'subscribe-user',
      channels: ['user:self'],
    });
    await subscribe(otherUser, {
      request_id: 'subscribe-other-user',
      channels: ['user:self'],
    });

    const pongPromise = once<{
      request_id: string;
      timestamp: number;
    }>(client, 'pong');
    client.emit('ping', { request_id: 'ping-1', timestamp: 123 });
    await expect(pongPromise).resolves.toEqual({
      request_id: 'ping-1',
      timestamp: 123,
    });

    let leakedToOtherUser = false;
    otherUser.once('agent_event', () => {
      leakedToOtherUser = true;
    });
    const privateEventPromise = nextAgentEvent(client);
    await wsV1.publish({
      channel: 'user:self',
      recipient_user_id: 'owner',
      event_type: 'error',
      data: {
        code: 'SAFE_ERROR',
        message: 'Bearer abc.def.ghi C:\\Users\\owner\\secret.txt',
        stack: 'Error at C:\\Users\\owner\\app.ts',
      },
    });
    await expect(privateEventPromise).resolves.toMatchObject({
      data: {
        code: 'SAFE_ERROR',
        message: 'Bearer [已脱敏] [内部路径已脱敏]',
        stack: '[已移除]',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(leakedToOtherUser).toBe(false);

    const unsubscribeAck = await emitAndWaitAck(client, 'unsubscribe', {
      request_id: 'unsubscribe-1',
      channels: ['user:self'],
    });
    expect(unsubscribeAck.accepted).toEqual(['user:self']);

    let received = false;
    client.once('agent_event', () => {
      received = true;
    });
    await wsV1.publish({
      channel: 'user:self',
      recipient_user_id: 'owner',
      event_type: 'summary',
      data: { summary_id: 'summary-1', summary_kind: 'daily' },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toBe(false);
  });

  it('authorizes and completes formal tool confirmation, continuation and undo controls', async () => {
    const pending = await createPendingToolApproval('confirm');
    const client = await connect('owner');
    await subscribe(client, {
      request_id: 'subscribe-tool-confirm',
      channels: [`session:${pending.sessionId}`],
    });

    const lifecycle = collectAgentEvents(client, 4);
    const confirmAck = nextToolControlAck(client);
    client.emit('confirm_tool_execution', {
      request_id: 'confirm-control-1',
      session_id: pending.sessionId,
      confirmation_id: pending.confirmationId,
    });

    await expect(confirmAck).resolves.toEqual({
      request_id: 'confirm-control-1',
      action: 'confirm',
      status: 'completed',
    });
    const events = await lifecycle;
    expect(events.map((event) => event.event_type)).toEqual([
      'tool_confirmation_confirmed',
      'tool_execution_start',
      'tool_execution_end',
      'tool_undo_available',
    ]);
    const ended = events.find(
      (event) => event.event_type === 'tool_execution_end',
    );
    const executionId = (ended?.data as { execution_id?: string } | undefined)
      ?.execution_id;
    expect(executionId).toBeTruthy();
    expect(claimToolDecision).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: pending.taskId, ownerId: 'owner' }),
      pending.confirmationId,
      pending.toolCallId,
      'ws_test_external_write',
    );
    expect(resumeClaimedToolDecision).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: pending.taskId }),
      {
        confirmationId: pending.confirmationId,
        leaseToken: `tool-lease-${pending.confirmationId}`,
      },
      expect.objectContaining({
        toolName: 'ws_test_external_write',
        toolCallId: pending.toolCallId,
        isError: false,
      }),
    );

    const undoEvent = nextAgentEvent(client);
    const undoAck = nextToolControlAck(client);
    client.emit('undo_tool_execution', {
      request_id: 'undo-control-1',
      session_id: pending.sessionId,
      execution_id: executionId,
    });
    await expect(undoAck).resolves.toEqual({
      request_id: 'undo-control-1',
      action: 'undo',
      status: 'completed',
    });
    await expect(undoEvent).resolves.toMatchObject({
      event_type: 'tool_undo_completed',
      data: { execution_id: executionId, success: true },
    });
    expect(externalToolUndo).toHaveBeenCalledOnce();
  });

  it('rejects cross-owner tool control without executing or leaking events', async () => {
    const pending = await createPendingToolApproval('attacker');
    const attacker = await connect('attacker');
    const ack = nextToolControlAck(attacker);
    attacker.emit('confirm_tool_execution', {
      request_id: 'attacker-control-1',
      session_id: pending.sessionId,
      confirmation_id: pending.confirmationId,
    });

    await expect(ack).resolves.toMatchObject({
      request_id: 'attacker-control-1',
      action: 'confirm',
      status: 'rejected',
      error: { code: 'AUTH_002' },
    });
  });

  it('dismisses an owned tool request and resumes with a rejection result', async () => {
    const pending = await createPendingToolApproval('dismiss');
    const client = await connect('owner');
    await subscribe(client, {
      request_id: 'subscribe-tool-dismiss',
      channels: [`session:${pending.sessionId}`],
    });
    const dismissedEvent = nextAgentEvent(client);
    const ack = nextToolControlAck(client);
    client.emit('dismiss_tool_execution', {
      request_id: 'dismiss-control-1',
      session_id: pending.sessionId,
      confirmation_id: pending.confirmationId,
    });

    await expect(ack).resolves.toEqual({
      request_id: 'dismiss-control-1',
      action: 'dismiss',
      status: 'completed',
    });
    await expect(dismissedEvent).resolves.toMatchObject({
      event_type: 'tool_confirmation_dismissed',
      data: { reason: 'user_dismissed' },
    });
    expect(resumeClaimedToolDecision).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: pending.taskId }),
      {
        confirmationId: pending.confirmationId,
        leaseToken: `tool-lease-${pending.confirmationId}`,
      },
      expect.objectContaining({ isError: true }),
    );
  });

  async function createPendingToolApproval(suffix: string) {
    const operationId = `tool-operation-${suffix}`;
    const sessionId = `tool-session-${suffix}`;
    await sessionStore.createIfAllowed(sessionId, 'owner', 10);
    const accepted = await chatTasks.submitText({
      ownerId: 'owner',
      operationId,
      requestFingerprint: `tool-fingerprint-${suffix}`,
      clientSource: 'web',
      text: `工具控制测试 ${suffix}`,
      inputId: `tool-input-${suffix}`,
      sessionId,
    });
    const acceptedTask = accepted.task!;
    expect(await chatTasks.markRunning(acceptedTask.taskId, 'owner')).toBe(
      true,
    );
    const pending = await toolExecution
      .createAgentTools({
        ownerId: 'owner',
        sessionId: acceptedTask.sessionId,
        taskId: acceptedTask.taskId,
        operationId: acceptedTask.operationId,
      })
      .find((tool) => tool.name === 'ws_test_external_write')!
      .execute(`tool-call-${suffix}`, { value: suffix });
    const confirmationId = (pending.details as { confirmationId: string })
      .confirmationId;
    expect(
      await chatTasks.markWaitingToolApproval(
        acceptedTask.taskId,
        'owner',
        confirmationId,
      ),
    ).toBe(true);
    return {
      taskId: acceptedTask.taskId,
      sessionId: acceptedTask.sessionId,
      toolCallId: `tool-call-${suffix}`,
      confirmationId,
    };
  }

  async function connect(subject: string): Promise<ClientSocket> {
    const client = io(url, {
      auth: { token: await createToken(subject) },
      extraHeaders: { Origin: allowedOrigin },
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    clients.push(client);
    await once(client, 'connect');
    return client;
  }
});

function subscribe(
  client: ClientSocket,
  request: object,
): Promise<SubscriptionAckV1> {
  return emitAndWaitAck(client, 'subscribe', request);
}

function emitAndWaitAck(
  client: ClientSocket,
  eventName: string,
  request: object,
): Promise<SubscriptionAckV1> {
  const response = once<SubscriptionAckV1>(client, 'subscription_ack');
  client.emit(eventName, request);
  return response;
}

function nextAgentEvent(client: ClientSocket): Promise<ServerPushEventV1> {
  return once(client, 'agent_event');
}

function nextToolControlAck(client: ClientSocket): Promise<ToolControlAckV1> {
  return once(client, 'tool_control_ack');
}

function collectAgentEvents(
  client: ClientSocket,
  count: number,
): Promise<ServerPushEventV1[]> {
  return new Promise((resolve, reject) => {
    const events: ServerPushEventV1[] = [];
    const timer = setTimeout(() => {
      client.off('agent_event', onEvent);
      reject(new Error(`等待 ${count} 个 agent_event 超时`));
    }, 3000);
    const onEvent = (event: ServerPushEventV1) => {
      events.push(event);
      if (events.length === count) {
        clearTimeout(timer);
        client.off('agent_event', onEvent);
        resolve(events);
      }
    };
    client.on('agent_event', onEvent);
  });
}

function once<T>(client: ClientSocket, eventName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`等待 ${eventName} 超时`)),
      3000,
    );
    client.once(eventName, (value: T) => {
      clearTimeout(timer);
      resolve(value);
    });
    client.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function createToken(subject: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}
