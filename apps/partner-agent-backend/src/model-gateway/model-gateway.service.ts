import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createModels,
  type Context,
  type Model,
  type MutableModels,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { EgressPolicyGateway } from './egress-policy.gateway.js';
import {
  EgressDecisionError,
  type EgressRequestMetadata,
} from './egress.types.js';
import { ExternalRequestBuilder } from './external-request.builder.js';
import { ModelProviderAdapter } from './model-provider.adapter.js';

@Injectable()
export class ModelGatewayService implements OnModuleInit {
  private readonly logger = new Logger(ModelGatewayService.name);
  private models?: MutableModels;

  constructor(
    private readonly configService: ConfigService,
    private readonly requestBuilder: ExternalRequestBuilder,
    private readonly egressPolicy: EgressPolicyGateway,
  ) {}

  onModuleInit(): void {
    const models = createModels();

    models.setProvider(deepseekProvider());

    if (this.configService.get<string>('ANTHROPIC_API_KEY')) {
      models.setProvider(anthropicProvider());
    }

    if (this.configService.get<string>('OPENAI_API_KEY')) {
      models.setProvider(openaiProvider());
    }

    this.models = models;

    const provider =
      this.configService.get<string>('DEFAULT_PROVIDER') ?? 'deepseek';
    const modelCount = models.getModels(provider).length;
    this.logger.log(
      `Model Gateway 初始化完成: ${provider} (${modelCount} 个模型)`,
    );
  }

  listModels(provider: string): readonly Model<any>[] {
    return this.requireModels().getModels(provider);
  }

  resolveModel(provider: string, modelId?: string): Model<any> | undefined {
    const models = this.requireModels();
    return modelId
      ? models.getModel(provider, modelId)
      : models.getModels(provider)[0];
  }

  /** 工具续轮、重试和模型切换均重新组装和审批实际载荷。 */
  createStreamFunction(metadata: Omit<EgressRequestMetadata, 'provider'>) {
    const models = this.requireModels();
    const provider = new ModelProviderAdapter((request) =>
      models.streamSimple(request.model, request.context, request.options),
    );
    return async (
      model: Model<any>,
      context: Context,
      options?: SimpleStreamOptions,
    ) => {
      const external = this.requestBuilder.build(
        { ...metadata, provider: model.provider },
        model,
        context,
        options,
      );
      const result = await this.egressPolicy.evaluate(external);
      if (!result.request) {
        throw new EgressDecisionError(
          result.decision as 'blocked' | 'pending_user_decision',
          result.categories,
          {
            egressId: result.egressId,
            expiresAt: result.expiresAt,
            provider: model.provider,
            modelId: model.id,
            requestFingerprint: result.requestFingerprint,
          },
        );
      }
      return provider.stream(result.request);
    };
  }

  private requireModels(): MutableModels {
    if (!this.models) {
      throw new Error('Model Gateway 尚未初始化');
    }

    return this.models;
  }
}
