import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, reportUnauthorized } from '@/api/access-token';
import { bootstrapAuth, logout, signInWithPassword, useAuthStore } from './auth-store';

const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: undefined as string | undefined }));
vi.mock('@/api/账户接口', () => ({ accountRequest: mocks.request, AccountApiError: class extends Error { constructor(message: string, readonly status: number) { super(message); } } }));
vi.mock('./刷新凭据', () => ({ refreshStorage: { get: async () => mocks.refresh, set: async (value: string) => { mocks.refresh = value; }, remove: async () => { mocks.refresh = undefined; } } }));
vi.mock('./token-storage', () => ({ tokenStorage: { get: async () => undefined, set: async () => {}, remove: async () => {} } }));

const tokens = (suffix = '1') => ({ access_token: `access-${suffix}`, refresh_token: `refresh-${suffix}`, expires_at: Date.now() + 900_000, refresh_expires_at: Date.now() + 604_800_000, user: { id: 'owner', username: 'test_user' } });

describe('account authentication lifecycle', () => {
  beforeEach(() => { mocks.request.mockReset(); mocks.refresh = undefined; useAuthStore.setState({ status: 'unauthenticated', isReady: true }, true); });

  it('registers and restores through a refresh credential without retaining the password', async () => {
    mocks.request.mockResolvedValueOnce(tokens());
    await signInWithPassword('test_user', 'a lengthy test password', true);
    expect(mocks.request).toHaveBeenCalledWith('register', { username: 'test_user', password: 'a lengthy test password' });
    expect(mocks.refresh).toBe('refresh-1');
    expect(JSON.stringify(useAuthStore.getState())).not.toContain('a lengthy test password');
    useAuthStore.setState({ status: 'bootstrapping', isReady: false }, true);
    mocks.request.mockResolvedValueOnce(tokens('2'));
    await bootstrapAuth();
    expect(await getAccessToken()).toBe('access-2');
  });
  it('deduplicates concurrent refresh requests from HTTP and WS clients', async () => {
    mocks.refresh = 'refresh-1';
    useAuthStore.setState({ status: 'authenticated', isReady: true, authMode: 'account', token: 'expired', expiresAt: 0 }, true);
    mocks.request.mockResolvedValue(tokens('2'));
    expect(await Promise.all([getAccessToken(), getAccessToken()])).toEqual(['access-2', 'access-2']);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('ignores a late 401 for an older token but signs out the rejected current session', async () => {
    mocks.request.mockResolvedValueOnce(tokens());
    await signInWithPassword('test_user', 'a lengthy test password');
    await reportUnauthorized('old-token');
    expect(useAuthStore.getState().status).toBe('authenticated');
    mocks.request.mockResolvedValueOnce(undefined);
    await reportUnauthorized('access-1');
    expect(useAuthStore.getState().status).toBe('expired');
    expect(await getAccessToken()).toBeUndefined();
  });
  it('logout during refresh cannot resurrect authentication and revokes rotated credentials', async () => {
    mocks.refresh = 'refresh-1';
    useAuthStore.setState({ status: 'authenticated', isReady: true, authMode: 'account', token: 'expired', expiresAt: 0 }, true);
    let resolve!: (value: ReturnType<typeof tokens>) => void;
    mocks.request.mockImplementation((action: string) => action === 'refresh' ? new Promise((done) => { resolve = done; }) : Promise.resolve());
    const refresh = getAccessToken();
    await vi.waitFor(() => expect(resolve).toBeDefined());
    const exiting = logout();
    resolve(tokens('2'));
    await Promise.all([refresh, exiting]);
    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(await getAccessToken()).toBeUndefined();
    expect(mocks.refresh).toBeUndefined();
    expect(mocks.request).toHaveBeenCalledWith('logout', { refresh_token: 'refresh-2' });
  });
});
