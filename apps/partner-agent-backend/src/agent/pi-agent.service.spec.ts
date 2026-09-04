import {
  AssistantMessageEventStream,
  type Context,
} from '@earendil-works/pi-ai';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { PiAgentService } from './pi-agent.service.js';
import { SessionManager } from './session-manager.service.js';

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
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: Date.now(),
};

describe('PiAgentService', () => {
  it('uses the configured model and maps Agent text deltas into backend events', async () => {
    let getModelCalls = 0;
    const sessions = new SessionManager();
    const service = new PiAgentService(
      new ConfigService({
        DEFAULT_PROVIDER: 'deepseek',
        DEFAULT_MODEL: 'fake-model',
      }),
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
              stream.push({
                type: 'text_delta',
                contentIndex: 0,
                delta: '你好',
                partial: assistantMessage,
              });
              stream.push({
                type: 'done',
                reason: 'stop',
                message: assistantMessage,
              });
              stream.end(assistantMessage);
            });
            return stream;
          },
        }),
      } as never,
      sessions,
    );

    const events = [];
    for await (const event of service.chat('session-a', '你好'))
      events.push(event);

    expect(getModelCalls).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'text_delta', data: '你好' }),
    );
    expect(events.at(-1)?.type).toBe('done');
    expect(sessions.getHistory('session-a')).toEqual([
      expect.objectContaining({ role: 'user', content: '你好' }),
      expect.objectContaining({ role: 'assistant', content: '你好' }),
    ]);
  });

  it('executes the current-time tool and returns its result to the model', async () => {
    let streamCalls = 0;
    let toolResultText = '';
    const sessions = new SessionManager();
    const service = new PiAgentService(
      new ConfigService({
        DEFAULT_PROVIDER: 'deepseek',
        DEFAULT_MODEL: 'fake-model',
      }),
      {
        getModels: () => ({
          getModel: () => fakeModel,
          getModels: () => [fakeModel],
          streamSimple: (_model: unknown, context: Context) => {
            streamCalls += 1;
            const stream = new AssistantMessageEventStream();
            const isToolCall = streamCalls === 1;
            const message = {
              ...assistantMessage,
              content: isToolCall
                ? [
                    {
                      type: 'toolCall' as const,
                      id: 'time-call-1',
                      name: 'get_current_time',
                      arguments: {},
                    },
                  ]
                : [{ type: 'text' as const, text: '现在是测试时间' }],
              stopReason: isToolCall ? ('toolUse' as const) : ('stop' as const),
            };

            if (!isToolCall) {
              const toolResult = context.messages.find(
                (entry) => entry.role === 'toolResult',
              );
              const content = toolResult?.content[0];
              if (content?.type === 'text') toolResultText = content.text;
            }

            queueMicrotask(() => {
              stream.push({ type: 'start', partial: message });
              if (!isToolCall) {
                stream.push({
                  type: 'text_delta',
                  contentIndex: 0,
                  delta: '现在是测试时间',
                  partial: message,
                });
              }
              stream.push({
                type: 'done',
                reason: message.stopReason,
                message,
              });
              stream.end(message);
            });
            return stream;
          },
        }),
      } as never,
      sessions,
    );

    const events = [];
    for await (const event of service.chat('time-session', '现在几点？')) {
      events.push(event);
    }

    expect(streamCalls).toBe(2);
    expect(JSON.parse(toolResultText)).toEqual({
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool_execution_start',
        data: expect.objectContaining({ tool: 'get_current_time' }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool_execution_end',
        data: expect.objectContaining({
          tool: 'get_current_time',
          success: true,
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'text_delta',
        data: '现在是测试时间',
      }),
    );
  });
});
