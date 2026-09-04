import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAccessToken } from '@/api/access-token';

import {
  bootstrapAuth,
  logout,
  registerAuthTeardown,
  signInWithDevelopmentToken,
  useAuthStore,
} from './auth-store';

const storage = vi.hoisted(() => ({
  get: vi.fn<() => Promise<string | undefined>>(),
  set: vi.fn<(token: string) => Promise<void>>(),
  remove: vi.fn<() => Promise<void>>(),
}));

vi.mock('./token-storage', () => ({ tokenStorage: storage }));

function jwt(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${encoded}.signature`;
}

describe('auth store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.get.mockResolvedValue(undefined);
    storage.set.mockResolvedValue(undefined);
    storage.remove.mockResolvedValue(undefined);
    useAuthStore.setState({ status: 'bootstrapping', isReady: false }, true);
  });

  it('registers the shared access-token provider before any network client reads it', async () => {
    const token = jwt({ exp: Math.floor(Date.now() / 1000) + 600 });
    useAuthStore.setState({ status: 'authenticated', isReady: true, token }, true);

    await expect(getAccessToken()).resolves.toBe(token);
  });

  it('restores a valid token before marking auth ready', async () => {
    const token = jwt({ exp: Math.floor(Date.now() / 1000) + 600 });
    storage.get.mockResolvedValue(token);

    await bootstrapAuth();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      isReady: true,
      token,
    });
  });

  it('removes an expired restored token and exposes the expired state', async () => {
    storage.get.mockResolvedValue(jwt({ exp: Math.floor(Date.now() / 1000) - 1 }));

    await bootstrapAuth();

    expect(storage.remove).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({ status: 'expired', isReady: true });
    expect(useAuthStore.getState().token).toBeUndefined();
  });

  it('clears the provider, registered session resources, and persisted token on logout', async () => {
    const teardown = vi.fn(async () => undefined);
    const unregister = registerAuthTeardown(teardown);
    useAuthStore.setState({
      status: 'authenticated',
      isReady: true,
      token: jwt({ exp: Math.floor(Date.now() / 1000) + 600 }),
    });

    await logout();

    expect(teardown).toHaveBeenCalledOnce();
    expect(storage.remove).toHaveBeenCalledOnce();
    await expect(getAccessToken()).resolves.toBeUndefined();
    expect(useAuthStore.getState()).toMatchObject({ status: 'unauthenticated', isReady: true });
    unregister();
  });

  it('never leaks a submitted token through persistence errors', async () => {
    const token = jwt({ exp: Math.floor(Date.now() / 1000) + 600 });
    storage.set.mockRejectedValue(new Error(`failed to save ${token}`));

    await signInWithDevelopmentToken(token);

    const state = useAuthStore.getState();
    expect(state.status).toBe('error');
    expect(state.token).toBeUndefined();
    expect(state.errorMessage).not.toContain(token);
  });
});
