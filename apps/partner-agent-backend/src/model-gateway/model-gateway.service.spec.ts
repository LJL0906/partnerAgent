import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { ModelGatewayService } from './model-gateway.service.js';
import { EgressPolicyGateway } from './egress-policy.gateway.js';
import { MemoryEgressAuditStore } from '../database/egress-audit.store.js';
import { ExternalRequestBuilder } from './external-request.builder.js';
import { MemoryEgressDecisionStore } from './memory-egress-decision.store.js';
import { EgressDecisionError } from './egress.types.js';

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
});
