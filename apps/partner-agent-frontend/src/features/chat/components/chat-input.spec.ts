import type { ModelConfig } from '@partner-agent/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  CHAT_MORE_ACTIONS,
  CLEAR_ACTION_WIDTH,
  getChatMorePlaceholder,
  getReasoningOptions,
  isChatInputClearable,
  isCurrentModelRequest,
  MODEL_TRIGGER_MAX_WIDTH,
  getVoiceModePresentation,
  resolveModelSelection,
  submitChatInput,
} from './chat-input';

vi.mock('react-native', () => ({
  Keyboard: { dismiss: vi.fn() }, Modal: vi.fn(), Pressable: vi.fn(), Text: vi.fn(),
  TextInput: vi.fn(), View: vi.fn(), useWindowDimensions: () => ({ width: 400 }),
}));
vi.mock('phosphor-react-native', () => ({
  Brain: vi.fn(), Camera: vi.fn(), Check: vi.fn(), Cpu: vi.fn(), File: vi.fn(),
  ImageSquare: vi.fn(), Keyboard: vi.fn(), MicrophoneStage: vi.fn(), PaperPlaneTilt: vi.fn(),
  PhoneCall: vi.fn(), Plus: vi.fn(), StopCircle: vi.fn(), Waveform: vi.fn(), X: vi.fn(),
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
  it('describes a full-duplex voice call instead of speech-to-text input', () => {
    expect(getVoiceModePresentation(false)).toEqual({
      toggleLabel: '进入实时语音通话', placeholder: undefined,
    });
    expect(getVoiceModePresentation(true)).toEqual({
      toggleLabel: '返回文字聊天', placeholder: '实时语音通话 · 即将开放',
    });
  });

  it('provides WeChat-style placeholder actions for the more panel', () => {
    expect(CHAT_MORE_ACTIONS.map((action) => action.label)).toEqual(['图片', '拍摄', '文件']);
    expect(getChatMorePlaceholder('file')).toBe('文件功能开发中');
  });

  it('offers clearing whenever the input contains any draft text', () => {
    expect(isChatInputClearable('')).toBe(false);
    expect(isChatInputClearable('草稿')).toBe(true);
    expect(isChatInputClearable('   ')).toBe(true);
  });

  it('keeps the clear action compact beside the send action', () => {
    expect(CLEAR_ACTION_WIDTH).toBeLessThan(44);
  });

  it('clears the submitted draft immediately and restores it when submission is rejected', async () => {
    let accept!: (accepted: boolean) => void;
    const onSend = vi.fn(() => new Promise<boolean>((resolve) => { accept = resolve; }));
    const dismissKeyboard = vi.fn();
    const onSubmitted = vi.fn();
    const onRejected = vi.fn();

    const pending = submitChatInput({ onSend, dismissKeyboard, onSubmitted, onRejected });
    expect(dismissKeyboard).toHaveBeenCalledOnce();
    expect(onSubmitted).toHaveBeenCalledOnce();
    expect(onRejected).not.toHaveBeenCalled();
    accept(false);
    await expect(pending).resolves.toBe(false);
    expect(onRejected).toHaveBeenCalledOnce();
  });

  it('reserves header space for reasoning and connection status', () => {
    expect(MODEL_TRIGGER_MAX_WIDTH).toBe('48%');
  });

  it('uses the server default without inventing off or medium', () => {
    expect(resolveModelSelection(models, 'reasoning', undefined)).toEqual({
      modelConfigId: 'reasoning', reasoningLevel: 'high',
    });
    expect(getReasoningOptions(models[1])).toEqual(['minimal', 'high']);
  });

  it('keeps the current reasoning level when the next model supports it', () => {
    expect(resolveModelSelection(models, 'reasoning', 'minimal')).toEqual({
      modelConfigId: 'reasoning', reasoningLevel: 'minimal',
    });
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
