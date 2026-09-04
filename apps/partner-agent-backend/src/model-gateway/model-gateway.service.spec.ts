import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { ModelGatewayService } from './model-gateway.service.js';
import { EgressPolicyGateway } from './egress-policy.gateway.js';
import { MemoryEgressAuditStore } from '../database/egress-audit.store.js';
import { ExternalRequestBuilder } from './external-request.builder.js';

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
      new EgressPolicyGateway(config, new MemoryEgressAuditStore()),
    );

    service.onModuleInit();

    const deepseekModels = service.listModels('deepseek');

    expect(deepseekModels.length).toBeGreaterThan(0);
    expect(deepseekModels.every((model) => model.provider === 'deepseek')).toBe(true);
  });
});
