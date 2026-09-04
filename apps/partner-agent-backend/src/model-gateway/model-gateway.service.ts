import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createModels,
  type Context,
  type Model,
  type MutableModels,
  type ProviderResponse,
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
import {
  ModelGatewayCallError,
  ModelGatewayObserver,
  NoopModelGatewayObserver,
  classifyModelProviderFailure,
  resolveModelGatewayReliability,
  type ModelGatewayObservationMetadata,
} from './model-gateway-reliability.js';

@Injectable()
export class ModelGatewayService implements OnModuleInit {
  private readonly logger = new Logger(ModelGatewayService.name);
  private models?: MutableModels;
  private readonly reliability;

  constructor(
    private readonly configService: ConfigService,
    private readonly requestBuilder: ExternalRequestBuilder,
    private readonly egressPolicy: EgressPolicyGateway,
    private readonly observer: ModelGatewayObserver = new NoopModelGatewayObserver(),
  ) {
    this.reliability = resolveModelGatewayReliability(configService);
  }

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
      const startedAt = Date.now();
      const observation: ModelGatewayObservationMetadata = {
        requestId: randomUUID(),
        ownerId: metadata.ownerId,
        sessionId: metadata.sessionId,
        taskId: metadata.taskId,
        operationId: metadata.operationId,
        source: metadata.source,
        provider: model.provider,
        modelId: model.id,
      };
      this.observe({
        ...observation,
        type: 'request_started',
        ...this.reliability,
      });
      const reliableOptions: SimpleStreamOptions = {
        ...options,
        // 注册的 Provider 只在收到首个响应前应用这些有限重试；流开始后不重放。
        timeoutMs: this.reliability.timeoutMs,
        maxRetries: this.reliability.maxRetries,
        maxRetryDelayMs: this.reliability.maxRetryDelayMs,
      };
      const external = this.requestBuilder.build(
        { ...metadata, provider: model.provider },
        model,
        context,
        reliableOptions,
      );
      const result = await this.egressPolicy.evaluate(external);
      this.observe({
        ...observation,
        type: 'egress_decided',
        decision: result.decision,
        sensitiveCategoryCount: result.categories.length,
      });
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
      const callerOnResponse = result.request.options?.onResponse;
      const approvedRequest = {
        ...result.request,
        options: {
          ...result.request.options,
          onResponse: async (
            response: ProviderResponse,
            responseModel: Model<any>,
          ) => {
            await callerOnResponse?.(response, responseModel);
            this.observe({
              ...observation,
              type: 'provider_response',
              status: response.status,
              elapsedMs: Date.now() - startedAt,
            });
          },
        },
      };
      try {
        const stream = provider.stream(approvedRequest);
        void stream.result().then(
          (message) => {
            if (
              message.stopReason === 'error' ||
              message.stopReason === 'aborted'
            ) {
              this.observe({
                ...observation,
                type: 'stream_failed',
                elapsedMs: Date.now() - startedAt,
                failure: classifyModelProviderFailure(message),
              });
              return;
            }
            this.observe({
              ...observation,
              type: 'stream_completed',
              elapsedMs: Date.now() - startedAt,
              inputTokens: message.usage.input,
              outputTokens: message.usage.output,
              totalTokens: message.usage.totalTokens,
            });
          },
          (error: unknown) => {
            this.observe({
              ...observation,
              type: 'stream_failed',
              elapsedMs: Date.now() - startedAt,
              failure: classifyModelProviderFailure(error),
            });
          },
        );
        return stream;
      } catch (error) {
        const failure = classifyModelProviderFailure(error);
        this.observe({
          ...observation,
          type: 'stream_failed',
          elapsedMs: Date.now() - startedAt,
          failure,
        });
        throw new ModelGatewayCallError(failure, { cause: error });
      }
    };
  }

  private observe(event: Parameters<ModelGatewayObserver['record']>[0]): void {
    try {
      const pending = this.observer.record(event);
      if (pending !== undefined) {
        void Promise.resolve(pending).catch(() => {
          this.logger.warn('Model Gateway 指标观察器记录失败');
        });
      }
    } catch {
      this.logger.warn('Model Gateway 指标观察器记录失败');
    }
  }

  private requireModels(): MutableModels {
    if (!this.models) {
      throw new Error('Model Gateway 尚未初始化');
    }

    return this.models;
  }
}
