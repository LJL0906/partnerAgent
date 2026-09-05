import { create } from 'zustand';

import { setAccessTokenProvider, setUnauthorizedHandler } from '@/api/access-token';

import { tokenStorage } from './token-storage';
import { refreshStorage } from './刷新凭据';
import type { AccountTokens } from '@/api/账户接口';

export type AuthStatus =
  | 'bootstrapping'
  | 'authenticated'
  | 'unauthenticated'
  | 'expired'
  | 'error';

export interface AuthState {
  status: AuthStatus;
  token?: string;
  expiresAt?: number;
  errorMessage?: string;
  isReady: boolean;
  authMode?: 'account';
  username?: string;
}

type AuthTeardown = () => Promise<void> | void;

const teardownCallbacks = new Set<AuthTeardown>();
let bootstrapPromise: Promise<void> | undefined;
let refreshPromise: Promise<string | undefined> | undefined;
let logoutPromise: Promise<void> | undefined;
let authGeneration = 0;
let storageQueue: Promise<void> = Promise.resolve();
function writeCredentials(action: () => Promise<void>): Promise<void> {
  const result = storageQueue.then(action, action);
  storageQueue = result.catch(() => undefined);
  return result;
}

const initialState: AuthState = {
  status: 'bootstrapping',
  isReady: false,
};

export const useAuthStore = create<AuthState>(() => initialState);

function setAuthState(state: AuthState): void {
  useAuthStore.setState(state, true);
}

function decodeJwtExpiry(token: string): number | undefined {
  const segments = token.split('.');
  if (segments.length !== 3 || !segments[1]) {
    throw new Error('invalid-jwt');
  }

  const normalized = segments[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const payload = JSON.parse(globalThis.atob(padded)) as { exp?: unknown };

  if (payload.exp === undefined) {
    return undefined;
  }
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new Error('invalid-exp');
  }
  return payload.exp * 1000;
}

function isExpired(expiresAt: number | undefined, now = Date.now()): boolean {
  return expiresAt !== undefined && expiresAt <= now;
}

function developmentRuntime(): boolean {
  return typeof __DEV__ === 'undefined' || __DEV__;
}

/** 在入口模块加载时注册，保证所有 HTTP/WS 请求读取同一份鉴权状态。 */
setAccessTokenProvider(async () => {
  const state = useAuthStore.getState();
  if (state.authMode === 'account' && (state.expiresAt ?? 0) <= Date.now() + 30_000) return refreshAccount();
  return state.token;
});
setUnauthorizedHandler(async (token) => {
  const current = useAuthStore.getState();
  if (current.authMode !== 'account' || current.token !== token) return;
  await logout();
  if (useAuthStore.getState().status === 'unauthenticated') setAuthState({ status: 'expired', isReady: true });
});

async function applyAccount(tokens: AccountTokens, generation: number): Promise<boolean> {
  if (generation !== authGeneration) return false;
  await writeCredentials(async () => {
    if (generation !== authGeneration) return;
    if (tokens.refresh_token) await refreshStorage.set(tokens.refresh_token);
    await tokenStorage.remove();
  });
  if (generation !== authGeneration) return false;
  setAuthState({ status: 'authenticated', isReady: true, authMode: 'account', token: tokens.access_token, expiresAt: tokens.expires_at, username: tokens.user.username });
  return true;
}

export async function signInWithPassword(username: string, password: string, register = false): Promise<void> {
  await logoutPromise;
  const generation = ++authGeneration;
  const { accountRequest } = await import('@/api/账户接口');
  const tokens = await accountRequest<AccountTokens>(register ? 'register' : 'login', { username, password });
  if (!await applyAccount(tokens, generation)) await accountRequest('logout', { refresh_token: tokens.refresh_token }).catch(() => undefined);
}

async function refreshAccount(): Promise<string | undefined> {
  if (refreshPromise) return refreshPromise;
  const generation = authGeneration;
  refreshPromise = (async () => {
    const refresh = await refreshStorage.get();
    if (!refresh) return undefined;
    const { accountRequest, AccountApiError } = await import('@/api/账户接口');
    try {
      const tokens = await accountRequest<AccountTokens>('refresh', refresh === '@cookie' ? {} : { refresh_token: refresh });
      if (await applyAccount(tokens, generation)) return tokens.access_token;
      await accountRequest('logout', { refresh_token: tokens.refresh_token }).catch(() => undefined);
      return undefined;
    } catch (error) {
      if (generation === authGeneration && error instanceof AccountApiError && error.status === 401) {
        await writeCredentials(() => refreshStorage.remove());
        setAuthState({ status: 'expired', isReady: true });
        await Promise.allSettled([...teardownCallbacks].map(async (callback) => callback()));
        return undefined;
      }
      throw error;
    }
  })().finally(() => { refreshPromise = undefined; });
  return refreshPromise;
}

export function registerAuthTeardown(callback: AuthTeardown): () => void {
  teardownCallbacks.add(callback);
  return () => teardownCallbacks.delete(callback);
}

export function bootstrapAuth(): Promise<void> {
  if (logoutPromise) return logoutPromise;
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    const generation = authGeneration;
    try {
      if (await refreshStorage.get()) {
        await refreshAccount();
        return;
      }
      const storedToken = (await tokenStorage.get())?.trim();
      if (generation !== authGeneration) return;
      if (!storedToken) {
        setAuthState({ status: 'unauthenticated', isReady: true });
        return;
      }

      let expiresAt: number | undefined;
      try {
        expiresAt = decodeJwtExpiry(storedToken);
      } catch {
        await tokenStorage.remove();
        setAuthState({
          status: 'error',
          isReady: true,
          errorMessage: '保存的登录凭据格式无效，请重新登录。',
        });
        return;
      }

      if (isExpired(expiresAt)) {
        await tokenStorage.remove();
        setAuthState({ status: 'expired', isReady: true, expiresAt });
        return;
      }

      setAuthState({ status: 'authenticated', isReady: true, token: storedToken, expiresAt });
    } catch {
      if (generation !== authGeneration) return;
      setAuthState({
        status: 'error',
        isReady: true,
        errorMessage: '暂时无法读取登录凭据，请重试。',
      });
    }
  })().finally(() => {
    bootstrapPromise = undefined;
  });

  return bootstrapPromise;
}

export async function signInWithDevelopmentToken(rawToken: string): Promise<void> {
  if (!developmentRuntime()) {
    throw new Error('开发令牌入口仅在开发构建中可用。');
  }

  const token = rawToken.trim();
  if (!token) {
    setAuthState({
      status: 'unauthenticated',
      isReady: true,
      errorMessage: '请粘贴开发用 JWT。',
    });
    return;
  }

  let expiresAt: number | undefined;
  try {
    ++authGeneration;
    await writeCredentials(() => refreshStorage.remove());
    expiresAt = decodeJwtExpiry(token);
  } catch {
    setAuthState({
      status: 'unauthenticated',
      isReady: true,
      errorMessage: 'JWT 格式无法识别。',
    });
    return;
  }

  if (isExpired(expiresAt)) {
    await tokenStorage.remove();
    setAuthState({ status: 'expired', isReady: true, expiresAt });
    return;
  }

  try {
    await tokenStorage.set(token);
    setAuthState({ status: 'authenticated', isReady: true, token, expiresAt });
  } catch {
    setAuthState({
      status: 'error',
      isReady: true,
      errorMessage: '暂时无法安全保存登录凭据，请重试。',
    });
  }
}

export function logout(): Promise<void> {
  if (!logoutPromise) logoutPromise = performLogout().finally(() => { logoutPromise = undefined; });
  return logoutPromise;
}

async function performLogout(): Promise<void> {
  const account = useAuthStore.getState().authMode === 'account';
  ++authGeneration;
  // 先撤销内存令牌，阻止退出期间产生新的受保护请求。
  setAuthState({ status: 'bootstrapping', isReady: false });

  const teardownResults = await Promise.allSettled(
    [...teardownCallbacks].map(async (callback) => callback()),
  );

  try {
    // Finish any refresh first, so logout revokes the latest rotated credential.
    await refreshPromise?.catch(() => undefined);
    if (account) {
      const { accountRequest } = await import('@/api/账户接口');
      const refresh = await refreshStorage.get();
      await accountRequest('logout', refresh === '@cookie' ? {} : { refresh_token: refresh });
    }
    await writeCredentials(() => refreshStorage.remove());
    await tokenStorage.remove();
  } catch {
    setAuthState({
      status: 'error',
      isReady: true,
        authMode: account ? 'account' : undefined,
        errorMessage: '退出登录尚未完成，请联网后重试退出。',
    });
    return;
  }

  setAuthState({ status: 'unauthenticated', isReady: true });

  if (teardownResults.some((result) => result.status === 'rejected')) {
    setAuthState({
      status: 'unauthenticated',
      isReady: true,
      errorMessage: '已退出登录，部分会话清理未完成。',
    });
  }
}

export const authInternals = {
  decodeJwtExpiry,
  isExpired,
};
