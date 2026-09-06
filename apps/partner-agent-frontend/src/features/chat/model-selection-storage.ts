import {
  parseModelSelectionPreference,
  type ModelSelectionPreferenceStorage,
} from './model-selection-storage.shared';

export {
  parseModelSelectionPreference,
  type ModelSelectionPreference,
  type ModelSelectionPreferenceStorage,
} from './model-selection-storage.shared';

const preferences = new Map<string, string>();

export const modelSelectionPreferenceStorage: ModelSelectionPreferenceStorage = {
  get: async (ownerId) => parseModelSelectionPreference(preferences.get(ownerId)),
  set: async (ownerId, preference) => {
    preferences.set(ownerId, JSON.stringify(preference));
  },
};
