import { create } from 'zustand';

import { setAccessTokenProvider } from '@/api/access-token';

import { tokenStorage } from './token-storage';

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
}

type AuthTeardown = () => Promise<void> | void;

const teardownCallbacks = new Set<AuthTeardown>();
let bootstrapPromise: Promise<void> | undefined;

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
setAccessTokenProvider(() => useAuthStore.getState().token);

export function registerAuthTeardown(callback: AuthTeardown): () => void {
  teardownCallbacks.add(callback);
  return () => teardownCallbacks.delete(callback);
}

export function bootstrapAuth(): Promise<void> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    try {
      const storedToken = (await tokenStorage.get())?.trim();
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

export async function logout(): Promise<void> {
  // 先撤销内存令牌，阻止退出期间产生新的受保护请求。
  setAuthState({ status: 'unauthenticated', isReady: true });

  const teardownResults = await Promise.allSettled(
    [...teardownCallbacks].map(async (callback) => callback()),
  );

  try {
    await tokenStorage.remove();
  } catch {
    setAuthState({
      status: 'error',
      isReady: true,
      errorMessage: '退出登录时未能清除设备凭据，请重试。',
    });
    return;
  }

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
