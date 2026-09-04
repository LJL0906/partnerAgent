import { beforeEach, describe, expect, it, vi } from 'vitest';

import { submitTextInput } from './chat-api';

const mocks = vi.hoisted(() => ({
  createCommandEnvelope: vi.fn(),
  createOperationId: vi.fn(),
  postJson: vi.fn(),
}));

vi.mock('./command-envelope', () => ({
  createCommandEnvelope: mocks.createCommandEnvelope,
  createOperationId: mocks.createOperationId,
}));
vi.mock('./http-client', () => ({ postJson: mocks.postJson }));
vi.mock('expo-constants', () => ({ default: { expoConfig: undefined, expoGoConfig: undefined } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

describe('submitTextInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOperationId.mockReturnValueOnce('generated-input').mockReturnValueOnce('generated-operation');
    mocks.createCommandEnvelope.mockImplementation(async (payload, options) => ({
      operation_id: options.operationId,
      client_source: 'web',
      request_fingerprint: 'fingerprint',
      payload,
    }));
    mocks.postJson.mockResolvedValue({ status: 'accepted', operation_id: 'operation-1' });
  });

  it('uses caller-provided ids so an explicit retry can replay the same command', async () => {
    await submitTextInput({
      text: '重试这条消息',
      sessionId: 'session-1',
      inputId: 'stable-input',
      operationId: 'stable-operation',
    });

    expect(mocks.createOperationId).not.toHaveBeenCalled();
    expect(mocks.createCommandEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ input_id: 'stable-input' }),
      { operationId: 'stable-operation' },
    );
  });

  it('generates ids when the caller starts a new command', async () => {
    await submitTextInput({ text: '新消息', sessionId: 'session-1' });

    expect(mocks.createCommandEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ input_id: 'generated-input' }),
      { operationId: 'generated-operation' },
    );
  });
});
