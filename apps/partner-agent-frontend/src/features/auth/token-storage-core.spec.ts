import { describe, expect, it, vi } from 'vitest';

import {
  ACCESS_TOKEN_STORAGE_KEY,
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
    const storage = createSecureTokenStorage(adapter);

    expect(await storage.get()).toBe('stored-jwt');
    await storage.set('next-jwt');
    await storage.remove();

    expect(adapter.getItemAsync).toHaveBeenCalledWith(ACCESS_TOKEN_STORAGE_KEY);
    expect(adapter.setItemAsync).toHaveBeenCalledWith(ACCESS_TOKEN_STORAGE_KEY, 'next-jwt');
    expect(adapter.deleteItemAsync).toHaveBeenCalledWith(ACCESS_TOKEN_STORAGE_KEY);
  });
});
