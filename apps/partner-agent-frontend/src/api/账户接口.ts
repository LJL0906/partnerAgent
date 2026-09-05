import { Platform } from 'react-native';
import type { AccountLoginResult } from '@partner-agent/contracts';
import { apiConfig } from './config';

export type AccountTokens = AccountLoginResult;

export class AccountApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const safeMessages: Record<number, string> = {
  400: '用户名须为 3–32 位字母、数字或下划线，密码须为 12–128 个字符。',
  401: '用户名或密码不正确，或登录已过期。',
  409: '该用户名暂不可用，请更换。',
  429: '尝试过于频繁，请稍后再试。',
};

export async function accountRequest<T>(action: 'register' | 'login' | 'refresh' | 'logout', body: object): Promise<T> {
  let url: string;
  try { url = `${apiConfig.serverUrl.replace(/\/$/, '')}/api/v1/auth/${action}`; }
  catch { throw new AccountApiError('服务地址配置无效。', 0); }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: 'POST', credentials: Platform.OS === 'web' ? 'include' : 'omit',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Client': Platform.OS === 'web' ? 'web' : 'native' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) throw new AccountApiError(safeMessages[response.status] ?? '暂时无法完成请求，请稍后再试。', response.status);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } catch (error) {
    if (error instanceof AccountApiError) throw error;
    throw new AccountApiError('无法连接服务，请检查网络后重试。', 0);
  } finally { clearTimeout(timeout); }
}
