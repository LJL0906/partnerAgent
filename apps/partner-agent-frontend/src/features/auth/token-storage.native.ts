import * as SecureStore from 'expo-secure-store';

import { createSecureTokenStorage } from './token-storage-core';

export const tokenStorage = createSecureTokenStorage(SecureStore);
