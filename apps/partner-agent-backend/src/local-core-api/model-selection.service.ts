import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { ModelGatewayService } from '../model-gateway/model-gateway.service.js';
import { REASONING_LEVELS, type ReasoningLevel } from '@partner-agent/contracts';

@Injectable()
export class ModelSelectionService {
  constructor(private readonly gateway: ModelGatewayService) {}

  list() {
    const provider = process.env.DEFAULT_PROVIDER ?? 'deepseek';
    return this.gateway.listModels(provider).map((model: any) => ({
      id: `${model.provider}:${model.id}`,
      provider: model.provider,
      model_id: model.id,
      is_default: model.id === (process.env.DEFAULT_MODEL ?? ''),
      sort_order: 0,
      capabilities: ['chat', ...(model.reasoning ? ['reasoning'] : [])],
      reasoning_levels: model.reasoning ? getSupportedThinkingLevels(model).filter((level) => level !== 'off') : [],
    }));
  }

  resolve(modelConfigId: string | undefined, reasoningLevel: unknown) {
    const provider = process.env.DEFAULT_PROVIDER ?? 'deepseek';
    const modelId = modelConfigId?.split(':').slice(1).join(':') || process.env.DEFAULT_MODEL;
    const selectedProvider = modelConfigId?.split(':')[0] || provider;
    if (!modelId) throw new UnprocessableEntityException({ code: 'VALIDATION_001', message: '未配置默认模型', details: { field: 'model_config_id' } });
    const model = this.gateway.resolveModel(selectedProvider, modelId);
    if (!model) throw new UnprocessableEntityException({ code: 'VALIDATION_001', message: '模型配置不存在', details: { field: 'model_config_id' } });

    if (typeof reasoningLevel === 'string' && !REASONING_LEVELS.includes(reasoningLevel as ReasoningLevel)) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_001', message: '推理等级无效', details: { field: 'reasoning_level' } });
    }

    const supportedLevels = model.reasoning
      ? getSupportedThinkingLevels(model).filter((level) => level !== 'off')
      : ['medium'];
    const level = reasoningLevel === undefined ? supportedLevels[0] ?? 'medium' : reasoningLevel;
    if (typeof level !== 'string' || !supportedLevels.includes(level as never)) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_001', message: '所选模型不支持推理等级', details: { field: 'reasoning_level' } });
    }
    return { provider: selectedProvider, modelId, reasoningLevel: level as ReasoningLevel };
  }

}



