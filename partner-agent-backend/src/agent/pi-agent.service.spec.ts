import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { PiAgentService } from './pi-agent.service.js';

const fakeModel = {
  id: 'fake-model',
  name: 'Fake Model',
  api: 'openai-completions',
  provider: 'deepseek',
  baseUrl: 'https://example.test',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 1024,
};

const assistantMessage = {
  role: 'assistant',
  content: [],
  api: 'openai-completions',
  provider: 'deepseek',
  model: 'fake-model',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'stop',
  timestamp: Date.now(),
};

describe('PiAgentService', () => {
  it('uses the configured model and maps Agent text deltas into backend events', async () => {
    let getModelCalls = 0;
    const service = new PiAgentService(
      new ConfigService({ DEFAULT_PROVIDER: 'deepseek', DEFAULT_MODEL: 'fake-model' }),
      {
        getModels: () => ({
          getModel: (provider: string, modelId: string) => {
            getModelCalls += 1;
            expect(provider).toBe('deepseek');
            expect(modelId).toBe('fake-model');
            return fakeModel;
          },
          getModels: () => [fakeModel],
          streamSimple: () => {
            const stream = new AssistantMessageEventStream();
            queueMicrotask(() => {
              stream.push({ type: 'start', partial: assistantMessage });
              stream.push({ type: 'text_delta', contentIndex: 0, delta: '你好', partial: assistantMessage });
              stream.push({ type: 'done', reason: 'stop', message: assistantMessage });
              stream.end(assistantMessage);
            });
            return stream;
          },
        }),
      } as never,
    );

    const events = [];
    for await (const event of service.chat('你好')) events.push(event);

    expect(getModelCalls).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'text_delta', data: '你好' }));
    expect(events.at(-1)?.type).toBe('done');
  });
});