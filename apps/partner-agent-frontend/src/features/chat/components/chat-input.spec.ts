import type { ModelConfig } from '@partner-agent/contracts';
import { describe, expect, it, vi } from 'vitest';

import { getReasoningOptions, isCurrentModelRequest, resolveModelSelection } from './chat-input';

vi.mock('react-native', () => ({
  Keyboard: { dismiss: vi.fn() }, Modal: vi.fn(), Pressable: vi.fn(), Text: vi.fn(),
  TextInput: vi.fn(), View: vi.fn(), useWindowDimensions: () => ({ width: 400 }),
}));
vi.mock('phosphor-react-native', () => ({
  Brain: vi.fn(), Check: vi.fn(), Cpu: vi.fn(), PaperPlaneTilt: vi.fn(), StopCircle: vi.fn(),
}));
vi.mock('@/components/ui/app-button', () => ({ AppButton: vi.fn() }));

const models: ModelConfig[] = [
  {
    id: 'plain', provider: 'openai', model_id: 'plain', capabilities: ['chat'],
    reasoning_levels: ['off'], default_reasoning_level: 'off', is_default: true,
  },
  {
    id: 'reasoning', provider: 'openai', model_id: 'reasoning', capabilities: ['chat', 'reasoning'],
    reasoning_levels: ['minimal', 'high'], default_reasoning_level: 'high',
  },
];

describe('server model capabilities', () => {
  it('uses the server default without inventing off or medium', () => {
    expect(resolveModelSelection(models, 'reasoning', undefined)).toEqual({
      modelConfigId: 'reasoning', reasoningLevel: 'high',
    });
    expect(getReasoningOptions(models[1])).toEqual(['minimal', 'high']);
  });

  it('repairs a removed model and unsupported reasoning to the server default', () => {
    expect(resolveModelSelection(models, 'removed', 'medium')).toEqual({
      modelConfigId: 'plain', reasoningLevel: 'off',
    });
    expect(resolveModelSelection(models, 'reasoning', 'medium')).toEqual({
      modelConfigId: 'reasoning', reasoningLevel: 'high',
    });
  });

  it('returns no fabricated selection when the service has no models', () => {
    expect(resolveModelSelection([], 'removed', 'medium')).toEqual({
      modelConfigId: '', reasoningLevel: undefined,
    });
  });

  it('accepts callbacks only for the current request, account, and session revision', () => {
    const expected = { requestId: 3, ownerId: 'account-a', sessionRevision: 8 };
    expect(isCurrentModelRequest(expected, expected)).toBe(true);
    expect(isCurrentModelRequest(expected, { ...expected, requestId: 4 })).toBe(false);
    expect(isCurrentModelRequest(expected, { ...expected, ownerId: 'account-b' })).toBe(false);
    expect(isCurrentModelRequest(expected, { ...expected, sessionRevision: 9 })).toBe(false);
  });
});
