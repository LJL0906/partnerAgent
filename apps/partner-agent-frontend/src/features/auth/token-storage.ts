import { createMemoryTokenStorage } from './token-storage-core';

// Node/非平台构建回退；Expo 会优先解析 .native.ts 或 .web.ts。
export const tokenStorage = createMemoryTokenStorage();
