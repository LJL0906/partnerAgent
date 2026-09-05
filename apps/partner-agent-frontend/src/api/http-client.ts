import { ERRORS, type ApiError, type ErrorCode } from '@partner-agent/contracts';

import { reportUnauthorized, requireAccessToken } from './access-token';
import { ApiClientError } from './api-error';
import { apiConfig } from './config';

export interface RequestOptions {
  signal?: AbortSignal;
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  if (!contentType?.includes('application/json')) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function postJson<TRequest, TResponse>(
  path: string,
  body: TRequest,
  options: RequestOptions = {},
): Promise<TResponse> {
  return requestJson<TResponse>(path, {
    method: 'POST',
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

export async function getJson<TResponse>(
  path: string,
  options: RequestOptions = {},
): Promise<TResponse> {
  return requestJson<TResponse>(path, { method: 'GET', signal: options.signal });
}

async function requestJson<TResponse>(path: string, init: RequestInit): Promise<TResponse> {
  let response: Response;
  const serverUrl = getValidServerUrl();
  const accessToken = await requireAccessToken();

  try {
    response = await fetch(`${serverUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiClientError('请求已取消。', 0, undefined, 'aborted');
    }
    throw new ApiClientError(
      '无法连接服务，请检查网络后重试。',
      0,
      undefined,
      'network',
    );
  }

  const responseBody = await parseJson(response);
  if (!response.ok) {
    const apiError = toSafeApiError(responseBody, response.status);
    if (response.status === 401) {
      await reportUnauthorized(accessToken);
      throw new ApiClientError(
        '登录状态已失效，请重新登录。',
        response.status,
        apiError,
        'unauthenticated',
      );
    }
    if (response.status === 403) {
      throw new ApiClientError(
        '没有权限执行此操作。',
        response.status,
        apiError,
        'forbidden',
      );
    }
    throw new ApiClientError(
      '请求失败，请稍后重试。',
      response.status,
      apiError,
      'http',
    );
  }

  return responseBody as TResponse;
}

function getValidServerUrl(): string {
  if (apiConfig.serverUrlConfigError) {
    throw configurationError();
  }

  try {
    const serverUrl = apiConfig.serverUrl;
    if (typeof serverUrl !== 'string' || !serverUrl.trim()) {
      throw configurationError();
    }
    const parsed = new URL(serverUrl);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
      throw configurationError();
    }
    return serverUrl.replace(/\/$/, '');
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw configurationError();
  }
}

function configurationError(): ApiClientError {
  return new ApiClientError(
    '服务地址配置无效，请检查应用配置。',
    0,
    undefined,
    'configuration',
  );
}

const SAFE_ERROR_CODES = new Set<string>(Object.values(ERRORS));

function toSafeApiError(value: unknown, status: number): ApiError | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('code' in value) || typeof value.code !== 'string') return undefined;
  if (!SAFE_ERROR_CODES.has(value.code)) return undefined;
  return {
    code: value.code as ErrorCode,
    message: safeHttpMessage(status),
  };
}

function safeHttpMessage(status: number): string {
  if (status === 401) return '登录状态已失效，请重新登录。';
  if (status === 403) return '没有权限执行此操作。';
  return '请求失败，请稍后重试。';
}
