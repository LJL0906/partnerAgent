import * as SecureStore from 'expo-secure-store';
import type { SessionReferenceStorage } from './会话存储';
export const sessionReferenceStorage: SessionReferenceStorage = {
  get: async (scope) => (await SecureStore.getItemAsync(`chat.session.v1.${scope}`)) ?? undefined,
  set: (scope, id) => SecureStore.setItemAsync(`chat.session.v1.${scope}`, id),
  remove: (scope) => SecureStore.deleteItemAsync(`chat.session.v1.${scope}`),
};
