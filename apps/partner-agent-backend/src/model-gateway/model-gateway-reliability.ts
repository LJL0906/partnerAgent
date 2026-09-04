import { Injectable } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_MAX_RETRY_DELAY_MS = 2_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 60_000;

export interface ModelGatewayReliabilitySettings {
  timeoutMs: number;
  maxRetries: number;
  maxRetryDelayMs: number;
}

export type ModelProviderFailureCategory =
  | 'timeout'
  | 'cancelled'
  | 'rate_limited'
  | 'authentication'
  | 'invalid_request'
  | 'unavailable'
  | 'unknown';

export type ModelProviderFailureCode =
  | 'MODEL_TIMEOUT'
  | 'MODEL_CANCELLED'
  | 'MODEL_RATE_LIMITED'
  | 'MODEL_AUTHENTICATION'
  | 'MODEL_INVALID_REQUEST'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_PROVIDER_ERROR';

export interface ClassifiedModelProviderFailure {
  category: ModelProviderFailureCategory;
  code: ModelProviderFailureCode;
  transient: boolean;
}

export interface ModelGatewayObservationMetadata {
  runId: string;
  requestId: string;
  ownerId: string;
  sessionId: string;
  taskId?: string;
  operationId?: string;
  source: string;
  provider: string;
  modelId: string;
}

export type ModelGatewayObservation =
  | (ModelGatewayObservationMetadata & {
      type: 'request_started';
      timeoutMs: number;
      maxRetries: number;
      maxRetryDelayMs: number;
    })
  | (ModelGatewayObservationMetadata & {
      type: 'egress_decided';
      decision: 'allowed' | 'redacted' | 'pending_user_decision' | 'blocked';
      sensitiveCategoryCount: number;
    })
  | (ModelGatewayObservationMetadata & {
      type: 'provider_response';
      status: number;
      elapsedMs: number;
    })
  | (ModelGatewayObservationMetadata & {
      type: 'stream_completed';
      elapsedMs: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    })
  | (ModelGatewayObservationMetadata & {
      type: 'stream_failed';
      elapsedMs: number;
      failure: ClassifiedModelProviderFailure;
    });

/** 可替换的指标/追踪出口；事件仅包含调用元数据，不包含提示词或模型输出。 */
export abstract class ModelGatewayObserver {
  abstract record(event: ModelGatewayObservation): void | Promise<void>;
}

@Injectable()
export class NoopModelGatewayObserver extends ModelGatewayObserver {
  record(): void {}
}

export class ModelGatewayCallError extends Error {
  constructor(
    readonly failure: ClassifiedModelProviderFailure,
    options?: ErrorOptions,
  ) {
    super(publicFailureMessage(failure), options);
    this.name = 'ModelGatewayCallError';
  }

  get code(): ModelProviderFailureCode {
    return this.failure.code;
  }
}

export function resolveModelGatewayReliability(
  config: ConfigService,
): ModelGatewayReliabilitySettings {
  return {
    timeoutMs: integerConfig(
      config,
      'MODEL_GATEWAY_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
      1,
      MAX_TIMEOUT_MS,
    ),
    maxRetries: integerConfig(
      config,
      'MODEL_GATEWAY_MAX_RETRIES',
      DEFAULT_MAX_RETRIES,
      0,
      MAX_RETRIES,
    ),
    maxRetryDelayMs: integerConfig(
      config,
      'MODEL_GATEWAY_MAX_RETRY_DELAY_MS',
      DEFAULT_MAX_RETRY_DELAY_MS,
      1,
      MAX_RETRY_DELAY_MS,
    ),
  };
}

export function classifyModelProviderFailure(
  error: unknown,
): ClassifiedModelProviderFailure {
  const status = providerStatus(error);
  const message = providerMessage(error).toLowerCase();

  if (isAbort(error, message)) {
    return failure('cancelled', 'MODEL_CANCELLED', false);
  }
  if (
    status === 408 ||
    /\b(?:timeout|timed out|deadline exceeded|etimedout)\b/u.test(message)
  ) {
    return failure('timeout', 'MODEL_TIMEOUT', true);
  }
  if (status === 429 || /\b(?:rate limit|too many requests)\b/u.test(message)) {
    return failure('rate_limited', 'MODEL_RATE_LIMITED', true);
  }
  if (
    status === 401 ||
    status === 403 ||
    /\b(?:unauthorized|forbidden|invalid api key|authentication)\b/u.test(
      message,
    )
  ) {
    return failure('authentication', 'MODEL_AUTHENTICATION', false);
  }
  if (status === 400 || status === 404 || status === 413 || status === 422) {
    return failure('invalid_request', 'MODEL_INVALID_REQUEST', false);
  }
  if (
    status === 409 ||
    (status !== undefined && status >= 500) ||
    /\b(?:econnreset|econnrefused|enotfound|network|socket hang up|service unavailable)\b/u.test(
      message,
    )
  ) {
    return failure('unavailable', 'MODEL_UNAVAILABLE', true);
  }
  return failure('unknown', 'MODEL_PROVIDER_ERROR', false);
}

function integerConfig(
  config: ConfigService,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = config.get<string | number>(key);
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${key} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return parsed;
}

function providerStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error))
    return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

function providerMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'errorMessage' in error) {
    return typeof error.errorMessage === 'string' ? error.errorMessage : '';
  }
  return typeof error === 'string' ? error : '';
}

function isAbort(error: unknown, message: string): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    /\b(?:aborted|abort error|cancelled|canceled)\b/u.test(message)
  );
}

function failure(
  category: ModelProviderFailureCategory,
  code: ModelProviderFailureCode,
  transient: boolean,
): ClassifiedModelProviderFailure {
  return { category, code, transient };
}

function publicFailureMessage(failure: ClassifiedModelProviderFailure): string {
  switch (failure.category) {
    case 'timeout':
      return '模型调用超时';
    case 'cancelled':
      return '模型调用已取消';
    case 'rate_limited':
      return '模型服务请求过于频繁';
    case 'authentication':
      return '模型服务认证失败';
    case 'invalid_request':
      return '模型服务拒绝了当前请求';
    case 'unavailable':
      return '模型服务暂时不可用';
    default:
      return '模型调用失败';
  }
}
