import {
  AssistantMessageEventStream,
  type Context,
} from '@earendil-works/pi-ai';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { PiAgentService } from './pi-agent.service.js';
import { SessionManager } from './session-manager.service.js';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { ToolRegistryService } from '../tools/tool-registry.service.js';
import { ToolExecutionService } from '../tools/tool-execution.service.js';
import { MemoryToolOperationStore } from '../tools/memory-tool-operation.store.js';
import { RedactionService } from '../tools/redaction.service.js';

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

function createToolServices() {
  const registry = new ToolRegistryService();
  const execution = new ToolExecutionService(
    registry,
    new MemoryToolOperationStore(),
    new RedactionService(),
    new ConfigService(),
  );
  return { registry, execution };
}

function mockGateway(legacy: {
  getModel?: (provider: string, modelId: string) => typeof fakeModel;
  getModels: (provider?: string) => (typeof fakeModel)[];
  streamSimple?: (...args: any[]) => AssistantMessageEventStream;
}) {
  return {
    listModels: (provider: string) => legacy.getModels(provider),
    resolveModel: (provider: string, modelId?: string) =>
      modelId && legacy.getModel
        ? legacy.getModel(provider, modelId)
        : legacy.getModels(provider)[0],
    createStreamFunction: () => legacy.streamSimple!,
  };
}

describe('PiAgentService', () => {
  it('uses the configured model and maps Agent text deltas into backend events', async () => {
    let getModelCalls = 0;
    const sessions = new SessionManager(
      new ConfigService(),
      new MemorySessionStore(),
    );
    const tools = createToolServices();
    const service = new PiAgentService(
      new ConfigService({
        DEFAULT_PROVIDER: 'deepseek',
        DEFAULT_MODEL: 'fake-model',
      }),
      {
        ...mockGateway({
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
      tools.execution,
      tools.registry,
    );

    const events = [];
    for await (const event of service.chat('session-a', '你好', 'user-a'))
      events.push(event);

    expect(getModelCalls).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'text_delta', data: '你好' }),
    );
    expect(events.at(-1)?.type).toBe('done');
    await expect(sessions.getHistory('session-a', 'user-a')).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: '你好' }),
      expect.objectContaining({ role: 'assistant', content: '你好' }),
    ]);
  });

  it('does not persist an accepted task prompt twice', async () => {
    const sessions = new SessionManager(new ConfigService(), new MemorySessionStore());
    await sessions.getOrCreate('task-session', 'user-a');
    await sessions.saveMessage('task-session', 'user-a', 'user', '已受理输入');
    const tools = createToolServices();
    const gateway = mockGateway({
      getModels: () => [fakeModel],
      streamSimple: () => {
        const stream = new AssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: 'start', partial: assistantMessage });
          stream.push({ type: 'done', reason: 'stop', message: assistantMessage });
          stream.end(assistantMessage);
        });
        return stream;
      },
    });
    const service = new PiAgentService(
      new ConfigService({ DEFAULT_PROVIDER: 'deepseek' }),
      gateway as never,
      sessions,
      tools.execution,
      tools.registry,
    );

    for await (const _event of service.chat(
      'task-session',
      '已受理输入',
      'user-a',
      { taskId: 'task-a' },
    )) {
      // Consume the task turn.
    }

    const history = await sessions.getHistory('task-session', 'user-a');
    expect(history.filter((item) => item.role === 'user')).toHaveLength(1);
  });

  it('executes the current-time tool and returns its result to the model', async () => {
    let streamCalls = 0;
    let toolResultText = '';
    const sessions = new SessionManager(
      new ConfigService(),
      new MemorySessionStore(),
    );
    const tools = createToolServices();
    const service = new PiAgentService(
      new ConfigService({
        DEFAULT_PROVIDER: 'deepseek',
        DEFAULT_MODEL: 'fake-model',
      }),
      {
        ...mockGateway({
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
      tools.execution,
      tools.registry,
    );

    const events = [];
    for await (const event of service.chat(
      'time-session',
      '现在几点？',
      'user-a',
    )) {
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

  it('rebuilds a new Agent from persisted context after a manager restart', async () => {
    const store = new MemorySessionStore();
    const contexts: Context[] = [];
    const createService = (reply: string) => {
      const sessions = new SessionManager(new ConfigService(), store);
      const tools = createToolServices();
      return new PiAgentService(
        new ConfigService({
          DEFAULT_PROVIDER: 'deepseek',
          DEFAULT_MODEL: 'fake-model',
        }),
        {
          ...mockGateway({
            getModel: () => fakeModel,
            getModels: () => [fakeModel],
            streamSimple: (_model: unknown, context: Context) => {
              contexts.push(context);
              const stream = new AssistantMessageEventStream();
              const message = {
                ...assistantMessage,
                content: [{ type: 'text' as const, text: reply }],
              };
              queueMicrotask(() => {
                stream.push({ type: 'start', partial: message });
                stream.push({
                  type: 'text_delta',
                  contentIndex: 0,
                  delta: reply,
                  partial: message,
                });
                stream.push({
                  type: 'done',
                  reason: 'stop',
                  message,
                });
                stream.end(message);
              });
              return stream;
            },
          }),
        } as never,
        sessions,
        tools.execution,
        tools.registry,
      );
    };

    for await (const _event of createService('第一轮回答').chat(
      'persistent-session',
      '第一轮问题',
      'user-a',
    )) {
      // Consume the full turn so its context snapshot is committed.
    }
    for await (const _event of createService('第二轮回答').chat(
      'persistent-session',
      '第二轮问题',
      'user-a',
    )) {
      // A new manager has no live Agent and must rebuild it from the store.
    }

    const rebuiltContext = JSON.stringify(contexts.at(-1)?.messages);
    expect(rebuiltContext).toContain('第一轮问题');
    expect(rebuiltContext).toContain('第一轮回答');
    expect(rebuiltContext).toContain('第二轮问题');
    expect(rebuiltContext.match(/第一轮问题/g)).toHaveLength(1);
  });

  it('replays only persisted messages after the snapshot watermark', async () => {
    const store = new MemorySessionStore();
    const managerA = new SessionManager(new ConfigService(), store);
    await managerA.getOrCreate('watermark-session', 'user-a');
    await managerA.saveMessage(
      'watermark-session',
      'user-a',
      'user',
      '已入快照的问题',
    );
    await managerA.completeAssistantTurn(
      'watermark-session',
      'user-a',
      '已入快照的回答',
      [
        { role: 'user', content: '已入快照的问题', timestamp: 1 },
        {
          ...assistantMessage,
          content: [{ type: 'text', text: '已入快照的回答' }],
        },
      ],
    );
    await managerA.saveMessage(
      'watermark-session',
      'user-a',
      'user',
      '崩溃水位后的问题',
    );

    let rebuiltMessages: Context['messages'] = [];
    const sessions = new SessionManager(new ConfigService(), store);
    const tools = createToolServices();
    const service = new PiAgentService(
      new ConfigService({
        DEFAULT_PROVIDER: 'deepseek',
        DEFAULT_MODEL: 'fake-model',
      }),
      {
        ...mockGateway({
          getModel: () => fakeModel,
          getModels: () => [fakeModel],
          streamSimple: (_model: unknown, context: Context) => {
            rebuiltMessages = context.messages;
            const stream = new AssistantMessageEventStream();
            const message = {
              ...assistantMessage,
              content: [{ type: 'text' as const, text: '继续回答' }],
            };
            queueMicrotask(() => {
              stream.push({ type: 'start', partial: message });
              stream.push({
                type: 'text_delta',
                contentIndex: 0,
                delta: '继续回答',
                partial: message,
              });
              stream.push({ type: 'done', reason: 'stop', message });
              stream.end(message);
            });
            return stream;
          },
        }),
      } as never,
      sessions,
      tools.execution,
      tools.registry,
    );

    for await (const _event of service.chat(
      'watermark-session',
      '重启后的新问题',
      'user-a',
    )) {
      // Consume the turn so the rebuilt context can be inspected.
    }

    const rebuilt = JSON.stringify(rebuiltMessages);
    expect(rebuilt.match(/已入快照的问题/g)).toHaveLength(1);
    expect(rebuilt.match(/崩溃水位后的问题/g)).toHaveLength(1);
    expect(rebuilt.match(/重启后的新问题/g)).toHaveLength(1);
  });

  it('persists a complete tool chain even when the successful turn has no text', async () => {
    const store = new MemorySessionStore();
    const sessions = new SessionManager(new ConfigService(), store);
    const tools = createToolServices();
    let streamCalls = 0;
    const service = new PiAgentService(
      new ConfigService({
        DEFAULT_PROVIDER: 'deepseek',
        DEFAULT_MODEL: 'fake-model',
      }),
      {
        ...mockGateway({
          getModel: () => fakeModel,
          getModels: () => [fakeModel],
          streamSimple: () => {
            streamCalls += 1;
            const stream = new AssistantMessageEventStream();
            const message = {
              ...assistantMessage,
              content:
                streamCalls === 1
                  ? [
                      {
                        type: 'toolCall' as const,
                        id: 'tool-only-call',
                        name: 'get_current_time',
                        arguments: {},
                      },
                    ]
                  : [],
              stopReason:
                streamCalls === 1 ? ('toolUse' as const) : ('stop' as const),
            };
            queueMicrotask(() => {
              stream.push({ type: 'start', partial: message });
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
      tools.execution,
      tools.registry,
    );

    for await (const _event of service.chat(
      'tool-only-session',
      '只调用工具',
      'user-a',
    )) {
      // Consume the full tool-only turn.
    }

    const restored = await new SessionManager(
      new ConfigService(),
      store,
    ).getOrCreate('tool-only-session', 'user-a');
    expect(restored.contextRevision).toBe(1);
    expect(restored.messages).toHaveLength(1);
    expect(
      restored.contextMessages.some((message) => message.role === 'toolResult'),
    ).toBe(true);
    expect(
      restored.contextMessages.some(
        (message) =>
          message.role === 'assistant' &&
          message.content.some(
            (content) =>
              content.type === 'toolCall' && content.id === 'tool-only-call',
          ),
      ),
    ).toBe(true);
  });

  it('trims context only at a complete user-turn boundary', () => {
    const sessions = new SessionManager(
      new ConfigService(),
      new MemorySessionStore(),
    );
    const tools = createToolServices();
    const service = new PiAgentService(
      new ConfigService(),
      mockGateway({ getModels: () => [fakeModel] }) as never,
      sessions,
      tools.execution,
      tools.registry,
    );
    const firstToolTurn = [
      { role: 'user', content: '旧回合', timestamp: 1 },
      {
        ...assistantMessage,
        content: [
          {
            type: 'toolCall' as const,
            id: 'old-call',
            name: 'get_current_time',
            arguments: {},
          },
        ],
        stopReason: 'toolUse' as const,
      },
      {
        role: 'toolResult' as const,
        toolCallId: 'old-call',
        toolName: 'get_current_time',
        content: [{ type: 'text' as const, text: '旧结果' }],
        isError: false,
        timestamp: 2,
      },
    ];
    const laterTurns = Array.from({ length: 49 }, (_, index) => [
      { role: 'user' as const, content: `问题-${index}`, timestamp: index + 3 },
      {
        ...assistantMessage,
        content: [{ type: 'text' as const, text: `回答-${index}` }],
      },
    ]).flat();
    const trim = (
      service as unknown as {
        trimCompleteTurns: (
          messages: Context['messages'],
        ) => Context['messages'];
      }
    ).trimCompleteTurns.bind(service);

    const trimmed = trim([...firstToolTurn, ...laterTurns]);
    expect(trimmed[0]).toMatchObject({ role: 'user', content: '问题-0' });
    expect(trimmed.some((message) => message.role === 'toolResult')).toBe(
      false,
    );
  });
});
