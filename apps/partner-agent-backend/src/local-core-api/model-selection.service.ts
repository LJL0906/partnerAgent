import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { getSupportedThinkingLevels, type Model } from '@earendil-works/pi-ai';
import type {
  ModelConfig,
  ProviderId,
  ReasoningLevel,
} from '@partner-agent/contracts';
import { REASONING_LEVELS } from '@partner-agent/contracts';
import { ModelGatewayService } from '../model-gateway/model-gateway.service.js';

interface CatalogEntry {
  model: Model<any>;
  config: ModelConfig;
}

@Injectable()
export class ModelSelectionService {
  constructor(private readonly gateway: ModelGatewayService) {}

  list(): ModelConfig[] {
    return this.catalog().map(({ config }) => config);
  }

  resolve(modelConfigId: string | undefined, reasoningLevel: unknown) {
    if (
      reasoningLevel !== undefined &&
      (typeof reasoningLevel !== 'string' ||
        !REASONING_LEVELS.includes(reasoningLevel as ReasoningLevel))
    ) {
      throw this.validation('推理等级无效', 'reasoning_level');
    }

    const catalog = this.catalog();
    const selected = modelConfigId
      ? catalog.find(({ config }) => config.id === modelConfigId)
      : catalog.find(({ config }) => config.is_default) ?? catalog[0];
    if (!selected) {
      throw this.validation(
        modelConfigId ? '模型配置不存在' : '没有可用模型配置',
        'model_config_id',
      );
    }
    const level = (reasoningLevel ??
      selected.config.default_reasoning_level) as ReasoningLevel;
    if (!selected.config.reasoning_levels.includes(level)) {
      throw this.validation('所选模型不支持推理等级', 'reasoning_level');
    }
    return {
      provider: selected.config.provider,
      modelId: selected.config.model_id,
      reasoningLevel: level,
    };
  }

  private catalog(): CatalogEntry[] {
    const provider = (process.env.DEFAULT_PROVIDER || 'deepseek') as ProviderId;
    const available = this.gateway.listModels(provider).filter(
      (model): model is Model<any> =>
        typeof model?.provider === 'string' && typeof model?.id === 'string',
    );
    const configuredDefault = process.env.DEFAULT_MODEL?.trim();
    const defaultModelId =
      configuredDefault && available.some((model) => model.id === configuredDefault)
        ? configuredDefault
        : available[0]?.id;
    return available.map((model, index) => {
      const reasoningLevels = this.reasoningLevels(model);
      return {
        model,
        config: {
          id: `${model.provider}:${model.id}`,
          provider: model.provider as ProviderId,
          model_id: model.id,
          is_default: model.id === defaultModelId,
          sort_order: index,
          capabilities: model.reasoning ? ['chat', 'reasoning'] : ['chat'],
          reasoning_levels: reasoningLevels,
          default_reasoning_level: reasoningLevels[0],
        },
      };
    });
  }

  private reasoningLevels(model: Model<any>): ReasoningLevel[] {
    if (!model.reasoning) return ['off'];
    const supported = getSupportedThinkingLevels(model).filter(
      (level): level is ReasoningLevel =>
        REASONING_LEVELS.includes(level as ReasoningLevel) && level !== 'off',
    );
    return supported.length > 0 ? supported : ['off'];
  }

  private validation(message: string, field: string) {
    return new UnprocessableEntityException({
      code: 'VALIDATION_001',
      message,
      details: { field },
    });
  }
}
