export const ACCESS_TOKEN_STORAGE_KEY = 'partner-agent.access-token';

export interface TokenStorage {
  get(): Promise<string | undefined>;
  set(token: string): Promise<void>;
  remove(): Promise<void>;
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

export function createSecureTokenStorage(adapter: SecureTokenStorageAdapter): TokenStorage {
  return {
    async get() {
      return (await adapter.getItemAsync(ACCESS_TOKEN_STORAGE_KEY)) ?? undefined;
    },
    async set(token) {
      await adapter.setItemAsync(ACCESS_TOKEN_STORAGE_KEY, token);
    },
    async remove() {
      await adapter.deleteItemAsync(ACCESS_TOKEN_STORAGE_KEY);
    },
  };
}
