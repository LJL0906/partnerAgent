import { Platform } from 'react-native';
import type { AccountLoginResult } from '@partner-agent/contracts';
import { apiConfig } from './config';

export type AccountTokens = AccountLoginResult;

export class AccountApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export const ACCOUNT_PASSWORD_MESSAGE = '密码须为 6–128 个字符，且至少包含一个英文字母和一个数字。';
export const LOGIN_PASSWORD_MESSAGE = '密码须为 6–128 个字符。';
export const ACCOUNT_USERNAME_MESSAGE = '用户名须为 3–32 位字母、数字或下划线。';

export function normalizeAccountUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isValidAccountUsername(username: string): boolean {
  const normalized = normalizeAccountUsername(username);
  return normalized.length >= 3 && normalized.length <= 32 && /^[a-z0-9_]+$/.test(normalized);
}

export function isValidAccountPassword(password: string, register = true): boolean {
  const length = [...password].length;
  return length >= 6 && length <= 128 && (!register || (/[A-Za-z]/.test(password) && /[0-9]/.test(password)));
}

const safeMessages: Record<number, string> = {
  400: `用户名须为 3–32 位字母、数字或下划线，${ACCOUNT_PASSWORD_MESSAGE}`,
  401: '用户名或密码不正确，或登录已过期。',
  409: '用户名已被占用，请更换一个用户名。',
  429: '尝试过于频繁，请稍后再试。',
};

export async function accountRequest<T>(action: 'register' | 'login' | 'refresh' | 'logout', body: object): Promise<T> {
  const username = (body as { username?: unknown }).username;
  if ((action === 'register' || action === 'login') && (typeof username !== 'string' || !isValidAccountUsername(username))) {
    throw new AccountApiError(ACCOUNT_USERNAME_MESSAGE, 400);
  }
  const password = (body as { password?: unknown }).password;
  if (action === 'register' && (typeof password !== 'string' || !isValidAccountPassword(password, true))) {
    throw new AccountApiError(ACCOUNT_PASSWORD_MESSAGE, 400);
  }
  if (action === 'login' && (typeof password !== 'string' || !isValidAccountPassword(password, false))) {
    throw new AccountApiError(LOGIN_PASSWORD_MESSAGE, 400);
  }
  let url: string;
  try { url = `${apiConfig.serverUrl.replace(/\/$/, '')}/api/v1/auth/${action}`; }
  catch { throw new AccountApiError('服务地址配置无效。', 0); }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: 'POST', credentials: Platform.OS === 'web' ? 'include' : 'omit',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Client': Platform.OS === 'web' ? 'web' : 'native' },
      body: JSON.stringify((action === 'register' || action === 'login') && typeof username === 'string'
        ? { ...body, username: normalizeAccountUsername(username) }
        : body), signal: controller.signal,
    });
    if (!response.ok) {
      const message = response.status === 400 && action === 'login'
        ? `用户名须为 3–32 位字母、数字或下划线，${LOGIN_PASSWORD_MESSAGE}`
        : safeMessages[response.status] ?? '暂时无法完成请求，请稍后再试。';
      throw new AccountApiError(message, response.status);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } catch (error) {
    if (error instanceof AccountApiError) throw error;
    throw new AccountApiError('无法连接服务，请检查网络后重试。', 0);
  } finally { clearTimeout(timeout); }
}
