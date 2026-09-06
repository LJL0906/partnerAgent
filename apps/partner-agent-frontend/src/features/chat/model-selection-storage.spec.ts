import { beforeEach, describe, expect, it } from 'vitest';
import {
  modelSelectionPreferenceStorage,
  parseModelSelectionPreference,
} from './model-selection-storage';

describe('model selection preference storage', () => {
  beforeEach(async () => {
    await modelSelectionPreferenceStorage.set('owner-reset', {
      modelConfigId: 'reset', reasoningLevel: 'off',
    });
  });

  it('keeps model and reasoning preferences isolated by owner', async () => {
    await modelSelectionPreferenceStorage.set('owner-a', {
      modelConfigId: 'model-a', reasoningLevel: 'high',
    });
    expect(await modelSelectionPreferenceStorage.get('owner-a')).toEqual({
      modelConfigId: 'model-a', reasoningLevel: 'high',
    });
    expect(await modelSelectionPreferenceStorage.get('owner-b')).toBeUndefined();
  });

  it('ignores damaged or unsupported persisted values', () => {
    expect(parseModelSelectionPreference('{bad json')).toBeUndefined();
    expect(parseModelSelectionPreference(JSON.stringify({
      modelConfigId: 'model-a', reasoningLevel: 'unsupported',
    }))).toBeUndefined();
  });
});
