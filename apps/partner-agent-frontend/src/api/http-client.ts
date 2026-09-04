import type { ApiError } from '@partner-agent/contracts';

import { requireAccessToken } from './access-token';
import { ApiClientError } from './api-error';
import { apiConfig } from './config';

export interface RequestOptions {
  signal?: AbortSignal;
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  return contentType?.includes('application/json') ? response.json() : undefined;
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
  const accessToken = await requireAccessToken();

  try {
    response = await fetch(`${apiConfig.serverUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiClientError('请求已取消。', 0);
    }
    throw new ApiClientError('无法连接服务，请检查服务地址和网络。', 0);
  }

  const responseBody = await parseJson(response);
  if (!response.ok) {
    const apiError = isApiError(responseBody) ? responseBody : undefined;
    throw new ApiClientError(
      apiError?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      apiError,
    );
  }

  return responseBody as TResponse;
}

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}
