import { describe, expect, it, vi } from 'vitest';

import {
  getScopedAccessTokenStorageKey,
  createMemoryTokenStorage,
  createSecureTokenStorage,
} from './token-storage-core';

describe('token storage adapters', () => {
  it('keeps the Web fallback in memory for only the current module lifecycle', async () => {
    const currentLifecycle = createMemoryTokenStorage();
    await currentLifecycle.set('jwt-value');

    expect(await currentLifecycle.get()).toBe('jwt-value');
    expect(await createMemoryTokenStorage().get()).toBeUndefined();

    await currentLifecycle.remove();
    expect(await currentLifecycle.get()).toBeUndefined();
  });

  it('delegates native persistence to SecureStore', async () => {
    const adapter = {
      getItemAsync: vi.fn(async () => 'stored-jwt'),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    };
    const storage = createSecureTokenStorage(adapter, getScopedAccessTokenStorageKey('https://one.example'));

    expect(await storage.get()).toBe('stored-jwt');
    await storage.set('next-jwt');
    await storage.remove();

    const key = getScopedAccessTokenStorageKey('https://one.example');
    expect(adapter.getItemAsync).toHaveBeenCalledWith(key);
    expect(adapter.setItemAsync).toHaveBeenCalledWith(key, 'next-jwt');
    expect(adapter.deleteItemAsync).toHaveBeenCalledWith(key);
    expect(getScopedAccessTokenStorageKey('https://two.example')).not.toBe(key);
  });

  it('normalizes equivalent server URLs into the same access-token scope', () => {
    expect(getScopedAccessTokenStorageKey('https://one.example/')).toBe(
      getScopedAccessTokenStorageKey('https://one.example'),
    );
  });
});
