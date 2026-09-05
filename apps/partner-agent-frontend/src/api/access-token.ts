import { ApiClientError } from './api-error';

export type AccessTokenProvider = () => Promise<string | undefined> | string | undefined;

let accessTokenProvider: AccessTokenProvider = () => undefined;
let unauthorizedHandler: (token: string) => Promise<void> | void = () => undefined;
export function setUnauthorizedHandler(handler: typeof unauthorizedHandler): void { unauthorizedHandler = handler; }
export async function reportUnauthorized(token: string): Promise<void> { await unauthorizedHandler(token); }

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
