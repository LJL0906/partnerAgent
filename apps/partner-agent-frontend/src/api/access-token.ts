import { ApiClientError } from './api-error';

export type AccessTokenProvider = () => Promise<string | undefined> | string | undefined;

let accessTokenProvider: AccessTokenProvider = () => undefined;

/** 由登录层注入，HTTP 与 WebSocket 始终共用这一令牌来源。 */
export function setAccessTokenProvider(provider: AccessTokenProvider): void {
  accessTokenProvider = provider;
}

export async function getAccessToken(): Promise<string | undefined> {
  const token = (await accessTokenProvider())?.trim();
  return token || undefined;
}

export async function requireAccessToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) {
    throw new ApiClientError('尚未配置访问令牌，请先登录。', 401);
  }
  return token;
}
