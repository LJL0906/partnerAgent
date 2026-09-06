import { describe, expect, it, vi } from 'vitest';
import { ModelSelectionService } from './model-selection.service.js';

describe('ModelSelectionService', () => {
  it('lists configured models with stable ids', () => {
    const gateway = { listModels: vi.fn().mockReturnValue([
      { provider: 'deepseek', id: 'deepseek-v4-flash', reasoning: true },
      { provider: 'deepseek', id: 'deepseek-chat', reasoning: false },
    ]) } as any;
    const service = new ModelSelectionService(gateway);
    expect(service.list()).toEqual([
      expect.objectContaining({ id: 'deepseek:deepseek-v4-flash', provider: 'deepseek', model_id: 'deepseek-v4-flash', capabilities: expect.arrayContaining(['chat', 'reasoning']) }),
      expect.objectContaining({ id: 'deepseek:deepseek-chat', model_id: 'deepseek-chat', capabilities: ['chat'] }),
    ]);
  });

  it('resolves and validates a reasoning level', () => {
    const gateway = { listModels: vi.fn().mockReturnValue([{ provider: 'deepseek', id: 'thinker', reasoning: true }]), resolveModel: vi.fn().mockReturnValue({ provider: 'deepseek', id: 'thinker', reasoning: true }) } as any;
    const service = new ModelSelectionService(gateway);
    expect(service.resolve('deepseek:thinker', 'high')).toEqual({ provider: 'deepseek', modelId: 'thinker', reasoningLevel: 'high' });
    expect(() => service.resolve('deepseek:thinker', 'invalid' as any)).toThrow('推理等级无效');
  });

  it('rejects levels that are not supported by the selected pi-ai model', () => {
    const gateway = {
      resolveModel: vi.fn().mockReturnValue({
        provider: 'deepseek',
        id: 'deepseek-v4-pro',
        reasoning: true,
        thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', max: 'max' },
      }),
    } as any;
    const service = new ModelSelectionService(gateway);

    expect(() => service.resolve('deepseek:deepseek-v4-pro', 'medium')).toThrow('所选模型不支持推理等级');
  });

  it('uses the first supported pi-ai level when no level is supplied', () => {
    const gateway = {
      resolveModel: vi.fn().mockReturnValue({
        provider: 'deepseek',
        id: 'deepseek-v4-pro',
        reasoning: true,
        thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', max: 'max' },
      }),
    } as any;
    const service = new ModelSelectionService(gateway);

    expect(service.resolve('deepseek:deepseek-v4-pro', undefined)).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-v4-pro',
      reasoningLevel: 'high',
    });
  });
  it('resolves ModelGatewayService through Nest dependency injection', async () => {
    const gateway = { listModels: vi.fn().mockReturnValue([]) } as any;
    const { Test } = await import('@nestjs/testing');
    const { ModelGatewayService } = await import('../model-gateway/model-gateway.service.js');
    const module = await Test.createTestingModule({
      providers: [
        ModelSelectionService,
        { provide: ModelGatewayService, useValue: gateway },
      ],
    }).compile();

    const service = module.get(ModelSelectionService);
    expect(service).toBeInstanceOf(ModelSelectionService);
    expect(service.list()).toEqual([]);
    expect(gateway.listModels).toHaveBeenCalledWith('deepseek');
  });
});



