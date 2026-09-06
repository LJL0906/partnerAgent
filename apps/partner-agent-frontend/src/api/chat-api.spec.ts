import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getChatSession, listModelConfigs, submitTextInput } from './chat-api';

const mocks = vi.hoisted(() => ({
  createCommandEnvelope: vi.fn(),
  createOperationId: vi.fn(),
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

vi.mock('./command-envelope', () => ({
  createCommandEnvelope: mocks.createCommandEnvelope,
  createOperationId: mocks.createOperationId,
}));
vi.mock('./http-client', () => ({ getJson: mocks.getJson, postJson: mocks.postJson }));
vi.mock('expo-constants', () => ({ default: { expoConfig: undefined, expoGoConfig: undefined } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

describe('submitTextInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOperationId
      .mockReturnValueOnce('10000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('10000000-0000-4000-8000-000000000002');
    mocks.createCommandEnvelope.mockImplementation(async (payload, options) => ({
      operation_id: options.operationId,
      client_source: 'web',
      request_fingerprint: 'fingerprint',
      payload,
    }));
    mocks.postJson.mockImplementation(async (_path, envelope) => acceptedResult(envelope.operation_id));
  });

  it('uses caller-provided ids so an explicit retry can replay the same command', async () => {
    await submitTextInput({
      text: '重试这条消息',
      sessionId: 'session-1',
      modelConfigId: 'deepseek:deepseek-v4-flash',
      reasoningLevel: 'medium',
      inputId: '10000000-0000-4000-8000-000000000003',
      operationId: '10000000-0000-4000-8000-000000000004',
    });

    expect(mocks.createOperationId).not.toHaveBeenCalled();
    expect(mocks.createCommandEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        input_id: '10000000-0000-4000-8000-000000000003',
        output_mode: 'chat',
      }),
      { operationId: '10000000-0000-4000-8000-000000000004' },
    );
  });

  it('generates ids when the caller starts a new command', async () => {
    await submitTextInput({ text: '新消息', sessionId: 'session-1', modelConfigId: 'deepseek:deepseek-v4-flash', reasoningLevel: 'medium' });

    expect(mocks.createCommandEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        input_id: '10000000-0000-4000-8000-000000000001',
        output_mode: 'chat',
      }),
      { operationId: '10000000-0000-4000-8000-000000000002' },
    );
  });

  it('omits session_id when the first submit creates the session', async () => {
    await submitTextInput({ text: '新会话', modelConfigId: 'deepseek:deepseek-v4-flash', reasoningLevel: 'medium' });

    const payload = mocks.createCommandEnvelope.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty('session_id');
  });

  it('submits action preview mode without enabling the separate analysis pipeline', async () => {
    await submitTextInput({
      text: '预览明天下午三点整理测试报告',
      sessionId: 'session-1',
      modelConfigId: 'deepseek:deepseek-v4-flash',
      reasoningLevel: 'medium',
      outputMode: 'structured_preview',
    });

    expect(mocks.createCommandEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        output_mode: 'structured_preview',
        preview_kind: 'action',
        request_analysis: false,
      }),
      expect.any(Object),
    );
  });

  it('rejects a submit response that does not satisfy the shared command result', async () => {
    mocks.postJson.mockResolvedValueOnce({ status: 'accepted', operation_id: 'bad' });

    await expect(submitTextInput({
      text: '消息',
      sessionId: 'session-1',
      modelConfigId: 'model-1',
      reasoningLevel: 'off',
      inputId: '10000000-0000-4000-8000-000000000003',
      operationId: '10000000-0000-4000-8000-000000000004',
    })).rejects.toThrow('消息提交响应格式无效');
  });
});

describe('getChatSession', () => {
  const legacy = () => ({
    id: 'session-1',
    title: '旧会话',
    created_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:01:00.000Z',
    message_count: 1,
    messages: [{
      id: 'message-1', session_id: 'session-1', sequence: 1, role: 'user', content: '你好',
      status: 'complete', revision: 1, created_at: '2026-09-06T00:00:00.000Z',
    }],
  });

  it('rejects the legacy messages-only envelope', async () => {
    mocks.getJson.mockResolvedValueOnce(legacy());
    await expect(getChatSession('session-1')).rejects.toThrow('会话快照响应格式无效');
  });

  it('rejects arbitrary legacy envelopes', async () => {
    mocks.getJson.mockResolvedValueOnce({ ...legacy(), arbitrary: true });
    await expect(getChatSession('session-1')).rejects.toThrow('会话快照响应格式无效');
  });
});

describe('listModelConfigs', () => {
  it('accepts only model capabilities that pass the shared runtime validator', async () => {
    mocks.getJson.mockResolvedValueOnce({ items: [{
      id: 'model-1', provider: 'openai', model_id: 'gpt', capabilities: ['chat'],
      reasoning_levels: ['off'], default_reasoning_level: 'off',
    }] });

    await expect(listModelConfigs()).resolves.toEqual({ items: [expect.objectContaining({ id: 'model-1' })] });
  });

  it('rejects leaked credentials and inconsistent reasoning capabilities', async () => {
    mocks.getJson.mockResolvedValueOnce({ items: [{
      id: 'model-1', provider: 'openai', model_id: 'gpt', capabilities: ['chat'],
      reasoning_levels: ['off'], default_reasoning_level: 'off', api_key_ref: 'secret',
    }] });
    await expect(listModelConfigs()).rejects.toThrow('模型配置响应格式无效');
  });
});

function acceptedResult(operationId: string) {
  return {
    operation_id: operationId,
    status: 'accepted',
    resource_refs: [
      { kind: 'session', id: 'session-1' },
      { kind: 'chat_message', id: 'message-1' },
    ],
    task_refs: [{ kind: 'chat_response', task_id: 'task-1' }],
    data: {
      session_id: 'session-1',
      message_ref: { kind: 'chat_message', id: 'message-1' },
      chat_task: { kind: 'chat_response', task_id: 'task-1' },
      resolved_model: { model_config_id: 'model-1', reasoning_level: 'off' },
    },
  };
}
