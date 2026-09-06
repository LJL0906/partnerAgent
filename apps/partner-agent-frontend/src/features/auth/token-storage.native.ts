import * as SecureStore from 'expo-secure-store';

import { createSecureTokenStorage, getScopedAccessTokenStorageKey } from './token-storage-core';
import { apiConfig } from '@/api/config';

export const tokenStorage = createSecureTokenStorage(SecureStore, getScopedAccessTokenStorageKey(apiConfig.serverUrl));
