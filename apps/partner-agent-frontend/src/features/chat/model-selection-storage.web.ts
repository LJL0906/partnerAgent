import {
  parseModelSelectionPreference,
  type ModelSelectionPreferenceStorage,
} from './model-selection-storage.shared';

const key = (ownerId: string) => `chat.model-selection.v1.${ownerId}`;

export const modelSelectionPreferenceStorage: ModelSelectionPreferenceStorage = {
  get: async (ownerId) => parseModelSelectionPreference(globalThis.localStorage?.getItem(key(ownerId))),
  set: async (ownerId, preference) => {
    globalThis.localStorage?.setItem(key(ownerId), JSON.stringify(preference));
  },
};
