import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from './api-error';
import { getJson, postJson } from './http-client';

const mocks = vi.hoisted(() => ({
  config: {
    serverUrl: 'https://api.example.test' as string | undefined,
    serverUrlConfigError: undefined as string | undefined,
    throwOnServerUrl: false,
  },
  requireAccessToken: vi.fn(async () => 'header.payload.signature'),
}));

vi.mock('./access-token', () => ({ requireAccessToken: mocks.requireAccessToken }));
vi.mock('./config', () => ({
  apiConfig: {
    get serverUrl() {
      if (mocks.config.throwOnServerUrl) throw new Error('raw config error with secret-token');
      return mocks.config.serverUrl;
    },
    get serverUrlConfigError() {
      return mocks.config.serverUrlConfigError;
    },
  },
}));

describe('HTTP client error normalization', () => {
  beforeEach(() => {
    mocks.config.serverUrl = 'https://api.example.test';
    mocks.config.serverUrlConfigError = undefined;
    mocks.config.throwOnServerUrl = false;
    mocks.requireAccessToken.mockClear();
    mocks.requireAccessToken.mockResolvedValue('header.payload.signature');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([undefined, '', 'not a url', 'ftp://api.example.test'])(
    'rejects an invalid or missing server URL before authentication and fetch: %s',
    async (serverUrl) => {
      mocks.config.serverUrl = serverUrl;
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);

      await expect(getJson('/api/v1/tasks/task-1')).rejects.toMatchObject({
        name: 'ApiClientError',
        kind: 'configuration',
        message: '服务地址配置无效，请检查应用配置。',
      });
      expect(mocks.requireAccessToken).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('honors apiConfig configError without exposing its potentially sensitive detail', async () => {
    mocks.config.serverUrlConfigError = 'invalid URL containing secret-token';
    vi.stubGlobal('fetch', vi.fn());

    const error = await captureError(getJson('/api/v1/tasks/task-1'));

    expect(error).toMatchObject({ kind: 'configuration' });
    expect(error.message).not.toContain('secret-token');
  });

  it('wraps a throwing serverUrl getter as a safe configuration error', async () => {
    mocks.config.throwOnServerUrl = true;
    vi.stubGlobal('fetch', vi.fn());

    const error = await captureError(getJson('/api/v1/tasks/task-1'));

    expect(error).toMatchObject({
      kind: 'configuration',
      message: '服务地址配置无效，请检查应用配置。',
    });
    expect(error.message).not.toContain('secret-token');
    expect(mocks.requireAccessToken).not.toHaveBeenCalled();
  });

  it('maps network failures without exposing the URL, token, or native error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect https://secret.example?token=header.payload.signature');
      }),
    );

    const error = await captureError(getJson('/api/v1/tasks/task-1'));

    expect(error).toMatchObject({
      status: 0,
      kind: 'network',
      message: '无法连接服务，请检查网络后重试。',
    });
    expect(error.message).not.toMatch(/secret|header\.payload|Authorization/i);
  });

  it('maps 401 to a fixed unauthenticated error and preserves only a safe code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(401, {
          code: 'AUTH_001',
          message: 'expired Bearer header.payload.signature',
          details: { authorization: 'Bearer header.payload.signature' },
        }),
      ),
    );

    const error = await captureError(getJson('/api/v1/tasks/task-1'));

    expect(error).toMatchObject({
      status: 401,
      kind: 'unauthenticated',
      message: '登录状态已失效，请重新登录。',
      body: { code: 'AUTH_001', message: '登录状态已失效，请重新登录。' },
    });
    expect(JSON.stringify(error)).not.toMatch(/header\.payload|authorization|Bearer/i);
  });

  it('maps 403 to a fixed forbidden error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(403, { code: 'AUTH_002', message: 'owner=user-secret' })),
    );

    await expect(getJson('/api/v1/tasks/task-1')).rejects.toMatchObject({
      status: 403,
      kind: 'forbidden',
      message: '没有权限执行此操作。',
      body: { code: 'AUTH_002', message: '没有权限执行此操作。' },
    });
  });

  it('does not expose malicious server text for other HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(500, {
          code: 'INTERNAL_000',
          message: 'api_key=raw-secret; Authorization=Bearer token-value',
          details: { identity_document: '110101199001011234' },
        }),
      ),
    );

    const error = await captureError(postJson('/api/v1/test', { ok: true }));

    expect(error).toMatchObject({
      status: 500,
      kind: 'http',
      message: '请求失败，请稍后重试。',
      body: { code: 'INTERNAL_000', message: '请求失败，请稍后重试。' },
    });
    expect(JSON.stringify(error)).not.toMatch(/raw-secret|token-value|110101|api_key/i);
  });

  it('keeps an aborted request separate from network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }),
    );

    await expect(getJson('/api/v1/tasks/task-1')).rejects.toMatchObject({
      status: 0,
      kind: 'aborted',
      message: '请求已取消。',
    });
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function captureError(promise: Promise<unknown>): Promise<ApiClientError> {
  try {
    await promise;
    throw new Error('expected request to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiClientError);
    return error as ApiClientError;
  }
}
