export const ACCESS_TOKEN_STORAGE_KEY = 'partner-agent.access-token';

export interface TokenStorage {
  get(): Promise<string | undefined>;
  set(token: string): Promise<void>;
  remove(): Promise<void>;
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, '');
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function getScopedAccessTokenStorageKey(serverUrl: string): string {
  return `${ACCESS_TOKEN_STORAGE_KEY}.${stableHash(normalizeServerUrl(serverUrl))}`;
}

export interface SecureTokenStorageAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** Web 与测试环境只保留当前 JavaScript 生命周期内的令牌。 */
export function createMemoryTokenStorage(): TokenStorage {
  let token: string | undefined;

  return {
    async get() {
      return token;
    },
    async set(nextToken) {
      token = nextToken;
    },
    async remove() {
      token = undefined;
    },
  };
}

export function createSecureTokenStorage(adapter: SecureTokenStorageAdapter, storageKey = ACCESS_TOKEN_STORAGE_KEY): TokenStorage {
  return {
    async get() {
      return (await adapter.getItemAsync(storageKey)) ?? undefined;
    },
    async set(token) {
      await adapter.setItemAsync(storageKey, token);
    },
    async remove() {
      await adapter.deleteItemAsync(storageKey);
    },
  };
}
