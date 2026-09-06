import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createAssistantMessageEventStream,
  createModels,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
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
  createStreamFunction(
    metadata: Omit<EgressRequestMetadata, 'provider'> & { runId: string },
    hooks: {
      onEgressDecisionError?: (error: EgressDecisionError) => void;
    } = {},
  ) {
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
        runId: metadata.runId,
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
        // Provider 内部重试无法逐次外发检查，因此重试由 Gateway 统一控制。
        timeoutMs: this.reliability.timeoutMs,
        maxRetries: 0,
        maxRetryDelayMs: this.reliability.maxRetryDelayMs,
      };
      const startAttempt = async () => {
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
        return provider.stream({
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
        });
      };
      try {
        const started = await this.startWithRetries(
          startAttempt,
          reliableOptions.signal,
          observation,
          startedAt,
        );
        const output = createAssistantMessageEventStream();
        void this.relayWithRetries(
          started.stream,
          output,
          startAttempt,
          reliableOptions.signal,
          observation,
          startedAt,
          hooks,
          started.retriesRemaining,
          model,
        ).catch((error: unknown) => {
          this.finishRelayFailure(output, model, error, observation, startedAt);
        });
        return output;
      } catch (error) {
        if (error instanceof EgressDecisionError) throw error;
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

  private async startWithRetries(
    startAttempt: () => Promise<AssistantMessageEventStream>,
    signal: AbortSignal | undefined,
    observation: ModelGatewayObservationMetadata,
    startedAt: number,
  ): Promise<{
    stream: AssistantMessageEventStream;
    retriesRemaining: number;
  }> {
    let retriesRemaining = this.reliability.maxRetries;
    for (;;) {
      try {
        return { stream: await startAttempt(), retriesRemaining };
      } catch (error) {
        if (error instanceof EgressDecisionError) throw error;
        const failure = classifyModelProviderFailure(error);
        if (!failure.transient || retriesRemaining <= 0) throw error;
        const retryIndex = this.reliability.maxRetries - retriesRemaining;
        retriesRemaining -= 1;
        await this.waitForRetry(retryIndex, signal);
        this.observe({
          ...observation,
          type: 'stream_failed',
          elapsedMs: Date.now() - startedAt,
          failure,
        });
      }
    }
  }

  private async relayWithRetries(
    first: AssistantMessageEventStream,
    output: AssistantMessageEventStream,
    startAttempt: () => Promise<AssistantMessageEventStream>,
    signal: AbortSignal | undefined,
    observation: ModelGatewayObservationMetadata,
    startedAt: number,
    hooks: { onEgressDecisionError?: (error: EgressDecisionError) => void },
    initialRetriesRemaining: number,
    model: Model<any>,
  ): Promise<void> {
    let source = first;
    let retriesRemaining = initialRetriesRemaining;
    for (;;) {
      let retryEvent:
        Extract<AssistantMessageEvent, { type: 'error' }> | undefined;
      let responseStarted = false;
      for await (const event of source) {
        if (event.type === 'error' && !responseStarted) {
          const failure = classifyModelProviderFailure(event.error);
          if (failure.transient && retriesRemaining > 0) {
            retryEvent = event;
            break;
          }
        }
        responseStarted = true;
        output.push(event);
        if (event.type === 'done') {
          this.observe({
            ...observation,
            type: 'stream_completed',
            elapsedMs: Date.now() - startedAt,
            inputTokens: event.message.usage.input,
            outputTokens: event.message.usage.output,
            totalTokens: event.message.usage.totalTokens,
          });
          return;
        }
        if (event.type === 'error') {
          this.observe({
            ...observation,
            type: 'stream_failed',
            elapsedMs: Date.now() - startedAt,
            failure: classifyModelProviderFailure(event.error),
          });
          return;
        }
      }
      if (!retryEvent) {
        this.finishRelayFailure(
          output,
          model,
          new Error('Provider stream ended without a terminal event'),
          observation,
          startedAt,
        );
        return;
      }

      const retryIndex = this.reliability.maxRetries - retriesRemaining;
      let nextRetryIndex = retryIndex;
      for (;;) {
        retriesRemaining -= 1;
        try {
          await this.waitForRetry(nextRetryIndex, signal);
          source = await startAttempt();
          break;
        } catch (error) {
          if (error instanceof EgressDecisionError) {
            hooks.onEgressDecisionError?.(error);
          }
          const failure = classifyModelProviderFailure(error);
          if (
            !(error instanceof EgressDecisionError) &&
            failure.transient &&
            retriesRemaining > 0
          ) {
            nextRetryIndex += 1;
            continue;
          }
          output.push(
            failure.category === 'cancelled'
              ? {
                  type: 'error',
                  reason: 'aborted',
                  error: {
                    ...retryEvent.error,
                    stopReason: 'aborted',
                    errorMessage: 'Request aborted',
                  },
                }
              : retryEvent,
          );
          this.observe({
            ...observation,
            type: 'stream_failed',
            elapsedMs: Date.now() - startedAt,
            failure,
          });
          return;
        }
      }
    }
  }

  private finishRelayFailure(
    output: AssistantMessageEventStream,
    model: Model<any>,
    error: unknown,
    observation: ModelGatewayObservationMetadata,
    startedAt: number,
  ): void {
    const failure = classifyModelProviderFailure(error);
    const stopReason = failure.category === 'cancelled' ? 'aborted' : 'error';
    const message: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason,
      errorMessage: new ModelGatewayCallError(failure).message,
      timestamp: Date.now(),
    };
    output.push({ type: 'error', reason: stopReason, error: message });
    this.observe({
      ...observation,
      type: 'stream_failed',
      elapsedMs: Date.now() - startedAt,
      failure,
    });
  }

  private async waitForRetry(
    retryIndex: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const delayMs = Math.min(
      500 * 2 ** retryIndex,
      this.reliability.maxRetryDelayMs,
    );
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      timer.unref?.();
      signal?.addEventListener('abort', onAbort, { once: true });
    });
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
