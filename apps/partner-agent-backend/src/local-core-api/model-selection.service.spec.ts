import { describe, expect, it, vi } from 'vitest';
import { ModelSelectionService } from './model-selection.service.js';

const models = [
  {
    provider: 'deepseek', id: 'deepseek-v4-flash', reasoning: true,
    thinkingLevelMap: { minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: null },
  },
  { provider: 'deepseek', id: 'deepseek-chat', reasoning: false },
];

describe('ModelSelectionService', () => {
  it('uses the first available model when DEFAULT_MODEL is empty', () => {
    vi.stubEnv('DEFAULT_PROVIDER', 'deepseek');
    vi.stubEnv('DEFAULT_MODEL', '');
    const service = createService();

    expect(service.list()).toEqual([
      expect.objectContaining({
        id: 'deepseek:deepseek-v4-flash', is_default: true,
        capabilities: ['chat', 'reasoning'], reasoning_levels: ['low', 'high'],
        default_reasoning_level: 'low',
      }),
      expect.objectContaining({
        id: 'deepseek:deepseek-chat', is_default: false,
        capabilities: ['chat'], reasoning_levels: ['off'],
        default_reasoning_level: 'off',
      }),
    ]);
    expect(service.resolve(undefined, undefined)).toEqual({
      provider: 'deepseek', modelId: 'deepseek-v4-flash', reasoningLevel: 'low',
    });
    vi.unstubAllEnvs();
  });

  it('resolves configured defaults and validates the real reasoning set', () => {
    vi.stubEnv('DEFAULT_PROVIDER', 'deepseek');
    vi.stubEnv('DEFAULT_MODEL', 'deepseek-chat');
    const service = createService();

    expect(service.resolve(undefined, undefined)).toEqual({
      provider: 'deepseek', modelId: 'deepseek-chat', reasoningLevel: 'off',
    });
    expect(() => service.resolve('deepseek:deepseek-v4-flash', 'medium')).toThrow(
      '所选模型不支持推理等级',
    );
    expect(() => service.resolve('deepseek:missing', 'off')).toThrow('模型配置不存在');
    vi.unstubAllEnvs();
  });

  it('resolves ModelGatewayService through Nest dependency injection', async () => {
    const gateway = { listModels: vi.fn().mockReturnValue([]), resolveModel: vi.fn() } as never;
    const { Test } = await import('@nestjs/testing');
    const { ModelGatewayService } = await import('../model-gateway/model-gateway.service.js');
    const module = await Test.createTestingModule({
      providers: [ModelSelectionService, { provide: ModelGatewayService, useValue: gateway }],
    }).compile();

    expect(module.get(ModelSelectionService).list()).toEqual([]);
    expect(gateway.listModels).toHaveBeenCalledWith('deepseek');
  });
});

function createService() {
  const gateway = {
    listModels: vi.fn().mockReturnValue(models),
    resolveModel: vi.fn((provider: string, id?: string) =>
      models.find((model) => model.provider === provider && model.id === id)),
  } as never;
  return new ModelSelectionService(gateway);
}
