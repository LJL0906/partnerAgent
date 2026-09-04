import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { ModelGatewayService } from './model-gateway.service.js';

describe('ModelGatewayService', () => {
  it('registers the configured DeepSeek provider and exposes its models', () => {
    const service = new ModelGatewayService(
      new ConfigService({
        DEFAULT_PROVIDER: 'deepseek',
        DEFAULT_MODEL: 'deepseek-chat',
        DEEPSEEK_API_KEY: 'test-key',
      }),
    );

    service.onModuleInit();

    const models = service.getModels();
    const deepseekModels = models.getModels('deepseek');

    expect(deepseekModels.length).toBeGreaterThan(0);
    expect(deepseekModels.every((model) => model.provider === 'deepseek')).toBe(true);
  });
});