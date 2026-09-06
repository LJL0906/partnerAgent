import * as SecureStore from 'expo-secure-store';
import type { SessionReferenceStorage } from './session-store';
export const sessionReferenceStorage: SessionReferenceStorage = {
  get: async (scope) => (await SecureStore.getItemAsync(`chat.session.v1.${scope}`)) ?? undefined,
  set: (scope, id) => SecureStore.setItemAsync(`chat.session.v1.${scope}`, id),
  remove: (scope) => SecureStore.deleteItemAsync(`chat.session.v1.${scope}`),
};
