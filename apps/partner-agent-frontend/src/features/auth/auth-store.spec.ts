import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAccessToken } from '@/api/access-token';
import { AccountApiError } from '@/api/account-api';

import {
  bootstrapAuth,
  logout,
  registerAuthTeardown,
  signInWithPassword,
  signInWithDevelopmentToken,
  useAuthStore,
} from './auth-store';

const storage = vi.hoisted(() => ({
  get: vi.fn<() => Promise<string | undefined>>(),
  set: vi.fn<(token: string) => Promise<void>>(),
  remove: vi.fn<() => Promise<void>>(),
}));

const refreshStorage = vi.hoisted(() => ({
  get: vi.fn<() => Promise<string | undefined>>(),
  set: vi.fn<(token: string) => Promise<void>>(),
  remove: vi.fn<() => Promise<void>>(),
}));

const accountApi = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('./token-storage', () => ({ tokenStorage: storage }));
vi.mock('./refresh-credential', () => ({ refreshStorage }));
vi.mock('@/api/account-api', () => ({
  accountRequest: accountApi.request,
  AccountApiError: class AccountApiError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
  },
}));

function jwt(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${encoded}.signature`;
}

function accountTokens(userId: string, suffix = '1') {
  return {
    access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 600, sub: userId }),
    refresh_token: `refresh-${suffix}`,
    expires_at: Date.now() + 600_000,
    refresh_expires_at: Date.now() + 86_400_000,
    user: { id: userId, username: `user_${userId}` },
  };
}

describe('auth store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.get.mockResolvedValue(undefined);
    storage.set.mockResolvedValue(undefined);
    storage.remove.mockResolvedValue(undefined);
    refreshStorage.get.mockResolvedValue(undefined);
    refreshStorage.set.mockResolvedValue(undefined);
    refreshStorage.remove.mockResolvedValue(undefined);
    accountApi.request.mockReset();
    useAuthStore.setState({ status: 'bootstrapping', isReady: false }, true);
  });

  it('registers the shared access-token provider before any network client reads it', async () => {
    const token = jwt({ exp: Math.floor(Date.now() / 1000) + 600 });
    useAuthStore.setState({ status: 'authenticated', isReady: true, token }, true);

    await expect(getAccessToken()).resolves.toBe(token);
  });

  it('does not restore a persisted access token without a refresh credential', async () => {
    const token = jwt({ exp: Math.floor(Date.now() / 1000) + 600 });
    storage.get.mockResolvedValue(token);

    await bootstrapAuth();

    expect(useAuthStore.getState()).toMatchObject({ status: 'unauthenticated', isReady: true });
    expect(useAuthStore.getState().token).toBeUndefined();
  });

  it('does not inspect or remove an expired access token during bootstrap', async () => {
    storage.get.mockResolvedValue(jwt({ exp: Math.floor(Date.now() / 1000) - 1 }));

    await bootstrapAuth();

    expect(storage.remove).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ status: 'unauthenticated', isReady: true });
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

  it('finishes old-owner teardown before publishing a refreshed account', async () => {
    const order: string[] = [];
    let finishTeardown!: () => void;
    const unregister = registerAuthTeardown(() => new Promise<void>((resolve) => {
      order.push('teardown-start');
      finishTeardown = () => { order.push('teardown-end'); resolve(); };
    }));
    refreshStorage.get.mockResolvedValue('refresh-a');
    const next = accountTokens('b', 'b');
    accountApi.request.mockResolvedValue(next);
    useAuthStore.setState({
      status: 'authenticated', isReady: true, authMode: 'account',
      token: 'expired-a', expiresAt: 0,
      user: { id: 'a', username: 'user_a' }, username: 'user_a',
    }, true);

    const refreshing = getAccessToken().then((token) => { order.push('published'); return token; });
    await vi.waitFor(() => expect(order).toEqual(['teardown-start']));
    expect(useAuthStore.getState().user?.id).not.toBe('b');
    finishTeardown();

    await expect(refreshing).resolves.toBe(next.access_token);
    expect(order).toEqual(['teardown-start', 'teardown-end', 'published']);
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', user: next.user });
    unregister();
  });

  it('does not teardown runtime for a same-owner refresh', async () => {
    const teardown = vi.fn();
    const unregister = registerAuthTeardown(teardown);
    refreshStorage.get.mockResolvedValue('refresh-a');
    const next = accountTokens('a', 'next');
    accountApi.request.mockResolvedValue(next);
    useAuthStore.setState({
      status: 'authenticated', isReady: true, authMode: 'account',
      token: 'expired-a', expiresAt: 0,
      user: { id: 'a', username: 'old_name' }, username: 'old_name',
    }, true);

    await expect(getAccessToken()).resolves.toBe(next.access_token);
    expect(teardown).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toEqual(next.user);
    unregister();
  });

  it('tears down an authenticated old owner before a password login publishes another owner', async () => {
    const order: string[] = [];
    const unregister = registerAuthTeardown(async () => { order.push('teardown'); });
    const next = accountTokens('b', 'login');
    accountApi.request.mockResolvedValue(next);
    useAuthStore.setState({
      status: 'authenticated', isReady: true, authMode: 'account',
      token: accountTokens('a').access_token, expiresAt: Date.now() + 600_000,
      user: { id: 'a', username: 'user_a' }, username: 'user_a',
    }, true);

    await signInWithPassword('user_b', 'abc123');
    order.push(`owner:${useAuthStore.getState().user?.id}`);

    expect(order).toEqual(['teardown', 'owner:b']);
    unregister();
  });

  it('rejects an account response whose JWT subject differs from user.id', async () => {
    const inconsistent = { ...accountTokens('a'), user: { id: 'b', username: 'user_b' } };
    accountApi.request.mockResolvedValue(inconsistent);

    await expect(signInWithPassword('user_b', 'abc123')).rejects.toThrow('账户身份');
    expect(refreshStorage.set).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('bootstrapping');
  });

  it('does not let an old refresh 401 teardown a newer same-owner login', async () => {
    let rejectRefresh!: (error: Error) => void;
    let finishRemove!: () => void;
    const refreshFailure = new Promise((_, reject) => { rejectRefresh = reject; });
    refreshStorage.get.mockResolvedValue('refresh-a');
    refreshStorage.remove.mockImplementationOnce(() => new Promise<void>((resolve) => { finishRemove = resolve; }));
    accountApi.request.mockImplementation((action: string) => action === 'refresh'
      ? refreshFailure
      : Promise.resolve(accountTokens('a', 'login')));
    const teardown = vi.fn();
    const unregister = registerAuthTeardown(teardown);
    useAuthStore.setState({
      status: 'authenticated', isReady: true, authMode: 'account',
      token: 'expired-a', expiresAt: 0,
      user: { id: 'a', username: 'user_a' }, username: 'user_a',
    }, true);

    const staleRefresh = getAccessToken().catch(() => undefined);
    rejectRefresh(new AccountApiError('expired', 401));
    await vi.waitFor(() => expect(finishRemove).toBeDefined());
    const login = signInWithPassword('user_a', 'abc123');
    finishRemove();
    await Promise.all([staleRefresh, login]);

    expect(teardown).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', user: { id: 'a' } });
    unregister();
  });

  it('does not send a cookie logout for a stale Web refresh response', async () => {
    type TestAccountTokens = Omit<ReturnType<typeof accountTokens>, 'refresh_token'> & { refresh_token?: string };
    let resolveRefresh!: (value: TestAccountTokens) => void;
    const staleWebTokens = { ...accountTokens('b', 'stale'), refresh_token: undefined };
    const refreshResult = new Promise<TestAccountTokens>((resolve) => { resolveRefresh = resolve; });
    refreshStorage.get.mockResolvedValue('@cookie');
    accountApi.request.mockImplementation((action: string) => {
      if (action === 'refresh') return refreshResult;
      if (action === 'login') return Promise.resolve(accountTokens('c', 'login'));
      return Promise.resolve(undefined);
    });
    useAuthStore.setState({
      status: 'authenticated', isReady: true, authMode: 'account',
      token: 'expired-a', expiresAt: 0,
      user: { id: 'a', username: 'user_a' }, username: 'user_a',
    }, true);

    const staleRefresh = getAccessToken();
    await vi.waitFor(() => expect(accountApi.request).toHaveBeenCalledWith('refresh', {}));
    await signInWithPassword('user_c', 'abc123');
    resolveRefresh(staleWebTokens);
    await expect(staleRefresh).resolves.toBeUndefined();

    expect(useAuthStore.getState().user?.id).toBe('c');
    expect(accountApi.request).not.toHaveBeenCalledWith('logout', expect.anything());
  });
});
