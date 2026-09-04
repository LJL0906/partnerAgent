import { createMemoryTokenStorage } from './token-storage-core';

// Web 明确不落 localStorage/sessionStorage/AsyncStorage，刷新即失效。
export const tokenStorage = createMemoryTokenStorage();
