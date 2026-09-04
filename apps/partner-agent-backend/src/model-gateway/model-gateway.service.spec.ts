import { ConfigService } from '@nestjs/config';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import { ModelGatewayService } from './model-gateway.service.js';
import { EgressPolicyGateway } from './egress-policy.gateway.js';
import { MemoryEgressAuditStore } from '../database/egress-audit.store.js';
import { ExternalRequestBuilder } from './external-request.builder.js';
import { MemoryEgressDecisionStore } from './memory-egress-decision.store.js';
import { EgressDecisionError } from './egress.types.js';
import {
  ModelGatewayCallError,
  type ModelGatewayObservation,
  type ModelGatewayObserver,
} from './model-gateway-reliability.js';

function cleanContext() {
  return { messages: [{ role: 'user', content: '你好' }] } as never;
}

function testModel() {
  return { provider: 'deepseek', id: 'test' } as never;
}

function assistantMessage(
  stopReason: 'stop' | 'error' | 'aborted',
  errorMessage?: string,
) {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'test',
    usage: {
      input: 3,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 8,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    errorMessage,
    timestamp: Date.now(),
  } as never;
}

describe('ModelGatewayService', () => {
  it('registers the configured DeepSeek provider and exposes its models', () => {
    const config = new ConfigService({
      DEFAULT_PROVIDER: 'deepseek',
      DEFAULT_MODEL: 'deepseek-chat',
      DEEPSEEK_API_KEY: 'test-key',
    });
    const service = new ModelGatewayService(
      config,
      new ExternalRequestBuilder(),
      new EgressPolicyGateway(
        config,
        new MemoryEgressAuditStore(),
        new MemoryEgressDecisionStore(),
      ),
    );

    service.onModuleInit();

    const deepseekModels = service.listModels('deepseek');

    expect(deepseekModels.length).toBeGreaterThan(0);
    expect(deepseekModels.every((model) => model.provider === 'deepseek')).toBe(
      true,
    );
  });

  it('awaits durable ask handling and never invokes the provider', async () => {
    const config = new ConfigService({ EGRESS_SENSITIVE_ACTION: 'ask' });
    const streamSimple = vi.fn();
    const service = new ModelGatewayService(
      config,
      new ExternalRequestBuilder(),
      new EgressPolicyGateway(
        config,
        new MemoryEgressAuditStore(),
        new MemoryEgressDecisionStore(
          () => new Date('2026-09-04T00:00:00.000Z'),
          () => 'egress-id',
        ),
      ),
    );
    (
      service as unknown as { models: { streamSimple: typeof streamSimple } }
    ).models = {
      streamSimple,
    };
    const stream = service.createStreamFunction({
      ownerId: 'owner',
      sessionId: 'session',
      taskId: 'task',
      operationId: 'operation',
      source: 'test',
    });

    const call = stream({ provider: 'deepseek', id: 'test' } as never, {
      messages: [{ role: 'user', content: 'password=hunter2' }],
    });
    await expect(call).rejects.toMatchObject({
      code: 'EGRESS_002',
      egressId: 'egress-id',
      provider: 'deepseek',
      modelId: 'test',
      categories: ['password'],
    } satisfies Partial<EgressDecisionError>);
    expect(streamSimple).not.toHaveBeenCalled();
  });

  it('applies bounded gateway reliability settings and emits metadata-only observations', async () => {
    const config = new ConfigService({
      MODEL_GATEWAY_TIMEOUT_MS: 12_000,
      MODEL_GATEWAY_MAX_RETRIES: 2,
      MODEL_GATEWAY_MAX_RETRY_DELAY_MS: 750,
    });
    const source = createAssistantMessageEventStream();
    const streamSimple = vi.fn(() => source);
    const observations: ModelGatewayObservation[] = [];
    const observer: ModelGatewayObserver = {
      record: (event) => observations.push(event),
    };
    const service = new ModelGatewayService(
      config,
      new ExternalRequestBuilder(),
      new EgressPolicyGateway(
        config,
        new MemoryEgressAuditStore(),
        new MemoryEgressDecisionStore(),
      ),
      observer,
    );
    (
      service as unknown as { models: { streamSimple: typeof streamSimple } }
    ).models = { streamSimple };

    const stream = await service.createStreamFunction({
      ownerId: 'owner',
      sessionId: 'session',
      taskId: 'task',
      operationId: 'operation',
      source: 'test',
    })(testModel(), cleanContext(), {
      timeoutMs: 999_999,
      maxRetries: 99,
      maxRetryDelayMs: 99_999,
    });
    const forwardedOptions = streamSimple.mock.calls[0]?.[2];
    expect(forwardedOptions).toMatchObject({
      timeoutMs: 12_000,
      maxRetries: 2,
      maxRetryDelayMs: 750,
    });

    await forwardedOptions?.onResponse?.(
      { status: 200, headers: { 'x-request-id': 'provider-id' } },
      testModel(),
    );
    source.push({
      type: 'done',
      reason: 'stop',
      message: assistantMessage('stop'),
    });
    await stream.result();
    await vi.waitFor(() =>
      expect(observations.map((event) => event.type)).toEqual([
        'request_started',
        'egress_decided',
        'provider_response',
        'stream_completed',
      ]),
    );
    expect(observations).not.toContainEqual(
      expect.objectContaining({ messages: expect.anything() }),
    );
    expect(observations.at(-1)).toMatchObject({
      inputTokens: 3,
      outputTokens: 5,
      totalTokens: 8,
    });
  });

  it('classifies synchronous provider setup failures without retrying at the gateway layer', async () => {
    const config = new ConfigService();
    const providerError = Object.assign(new Error('Invalid API key'), {
      status: 401,
    });
    const streamSimple = vi.fn(() => {
      throw providerError;
    });
    const record = vi.fn();
    const service = new ModelGatewayService(
      config,
      new ExternalRequestBuilder(),
      new EgressPolicyGateway(
        config,
        new MemoryEgressAuditStore(),
        new MemoryEgressDecisionStore(),
      ),
      { record },
    );
    (
      service as unknown as { models: { streamSimple: typeof streamSimple } }
    ).models = { streamSimple };

    await expect(
      service.createStreamFunction({
        ownerId: 'owner',
        sessionId: 'session',
        source: 'test',
      })(testModel(), cleanContext()),
    ).rejects.toMatchObject({
      code: 'MODEL_AUTHENTICATION',
      failure: {
        category: 'authentication',
        transient: false,
      },
      cause: providerError,
    } satisfies Partial<ModelGatewayCallError>);
    expect(streamSimple).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'stream_failed',
        failure: {
          category: 'authentication',
          code: 'MODEL_AUTHENTICATION',
          transient: false,
        },
      }),
    );
  });

  it('classifies terminal stream errors for metrics without replaying the stream', async () => {
    const config = new ConfigService();
    const source = createAssistantMessageEventStream();
    const streamSimple = vi.fn(() => source);
    const record = vi.fn();
    const service = new ModelGatewayService(
      config,
      new ExternalRequestBuilder(),
      new EgressPolicyGateway(
        config,
        new MemoryEgressAuditStore(),
        new MemoryEgressDecisionStore(),
      ),
      { record },
    );
    (
      service as unknown as { models: { streamSimple: typeof streamSimple } }
    ).models = { streamSimple };
    const stream = await service.createStreamFunction({
      ownerId: 'owner',
      sessionId: 'session',
      source: 'test',
    })(testModel(), cleanContext());

    source.push({
      type: 'error',
      reason: 'error',
      error: assistantMessage('error', 'Request timed out'),
    });
    await stream.result();
    await vi.waitFor(() =>
      expect(record).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'stream_failed',
          failure: {
            category: 'timeout',
            code: 'MODEL_TIMEOUT',
            transient: true,
          },
        }),
      ),
    );
    expect(streamSimple).toHaveBeenCalledTimes(1);
  });

  it('fails fast for unsafe retry configuration', () => {
    expect(
      () =>
        new ModelGatewayService(
          new ConfigService({ MODEL_GATEWAY_MAX_RETRIES: 4 }),
          new ExternalRequestBuilder(),
          {} as EgressPolicyGateway,
        ),
    ).toThrow('MODEL_GATEWAY_MAX_RETRIES 必须是 0 到 3 之间的整数');
  });
});
