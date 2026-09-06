import * as SecureStore from 'expo-secure-store';
import {
  parseModelSelectionPreference,
  type ModelSelectionPreferenceStorage,
} from './model-selection-storage.shared';

const key = (ownerId: string) => `chat.model-selection.v1.${ownerId}`;

export const modelSelectionPreferenceStorage: ModelSelectionPreferenceStorage = {
  get: async (ownerId) => parseModelSelectionPreference(await SecureStore.getItemAsync(key(ownerId))),
  set: (ownerId, preference) => SecureStore.setItemAsync(key(ownerId), JSON.stringify(preference)),
};
