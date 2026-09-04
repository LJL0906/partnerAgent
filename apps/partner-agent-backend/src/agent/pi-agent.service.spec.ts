import {
  AssistantMessageEventStream,
  type Context,
} from '@earendil-works/pi-ai';
import { ConfigService } from '@nestjs/config';
import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';
import { PiAgentService } from './pi-agent.service.js';
import { SessionManager } from './session-manager.service.js';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { ToolRegistryService } from '../tools/tool-registry.service.js';
import { ToolExecutionService } from '../tools/tool-execution.service.js';
import { MemoryToolOperationStore } from '../tools/memory-tool-operation.store.js';
import { RedactionService } from '../tools/redaction.service.js';
import type { AgentRuntimePolicy } from './agent-runtime-policy.js';
import {
  AgentRunTrace,
  type AgentRunMetadata,
  type AgentRuntimeTelemetry,
} from './agent-runtime-telemetry.js';
import { trimCompleteTurns } from './pi-agent-context.js';

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
  onStreamMetadata?: (metadata: { runId: string }) => void;
}) {
  return {
    listModels: (provider: string) => legacy.getModels(provider),
    resolveModel: (provider: string, modelId?: string) =>
      modelId && legacy.getModel
        ? legacy.getModel(provider, modelId)
        : legacy.getModels(provider)[0],
    createStreamFunction: (metadata: { runId: string }) => {
      legacy.onStreamMetadata?.(metadata);
      return legacy.streamSimple!;
    },
  };
}

describe('PiAgentService', () => {
  it('applies request maxTokens and creates isolated metadata for consecutive runs', async () => {
    const sessions = new SessionManager(
      new ConfigService(),
      new MemorySessionStore(),
    );
    const tools = createToolServices();
    const requestMaxTokens: number[] = [];
    const runMetadata: AgentRunMetadata[] = [];
    const runIds: string[] = [];
    const modelRunIds: string[] = [];
    const telemetry = {
      start(metadata: AgentRunMetadata, policy: AgentRuntimePolicy) {
        runMetadata.push({ ...metadata });
        const trace = new AgentRunTrace(metadata, () => undefined);
        trace.attachBudget(policy);
        runIds.push(trace.runId);
        return trace;
      },
    } as AgentRuntimeTelemetry;
    const service = new PiAgentService(
      new ConfigService({
        DEFAULT_PROVIDER: 'deepseek',
        AGENT_RUN_MAX_OUTPUT_TOKENS: '100',
        AGENT_RUN_MAX_REQUEST_TOKENS: '33',
      }),
      mockGateway({
        getModels: () => [fakeModel],
        onStreamMetadata: ({ runId }) => modelRunIds.push(runId),
        streamSimple: (_model, _context, options) => {
          requestMaxTokens.push(options?.maxTokens ?? -1);
          const stream = new AssistantMessageEventStream();
          queueMicrotask(() => {
            stream.push({ type: 'start', partial: assistantMessage });
            stream.push({
              type: 'done',
              reason: 'stop',
              message: assistantMessage,
            });
            stream.end(assistantMessage);
          });
          return stream;
        },
      }) as never,
      sessions,
      tools.execution,
      tools.registry,
      telemetry,
    );

    for await (const _event of service.chat('session-a', '第一轮', 'user-a', {
      taskId: 'task-a',
      operationId: 'operation-a',
      source: 'source-a',
    })) {
      // Consume the first run.
    }
    for await (const _event of service.chat('session-b', '第二轮', 'user-a', {
      taskId: 'task-b',
      operationId: 'operation-b',
      source: 'source-b',
    })) {
      // Consume the second run.
    }

    expect(requestMaxTokens).toEqual([33, 33]);
    expect(runMetadata).toEqual([
      {
        ownerId: 'user-a',
        sessionId: 'session-a',
        taskId: 'task-a',
        operationId: 'operation-a',
        source: 'source-a',
      },
      {
        ownerId: 'user-a',
        sessionId: 'session-b',
        taskId: 'task-b',
        operationId: 'operation-b',
        source: 'source-b',
      },
    ]);
    expect(new Set(runIds).size).toBe(2);
    expect(modelRunIds).toEqual(runIds);
  });

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
    const sessions = new SessionManager(
      new ConfigService(),
      new MemorySessionStore(),
    );
    await sessions.getOrCreate('task-session', 'user-a');
    await sessions.saveMessage('task-session', 'user-a', 'user', '已受理输入');
    const tools = createToolServices();
    const gateway = mockGateway({
      getModels: () => [fakeModel],
      streamSimple: () => {
        const stream = new AssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: 'start', partial: assistantMessage });
          stream.push({
            type: 'done',
            reason: 'stop',
            message: assistantMessage,
          });
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

  it('blocks an entire mixed tool batch that contains an approval tool', async () => {
    const sessions = new SessionManager(
      new ConfigService(),
      new MemorySessionStore(),
    );
    const tools = createToolServices();
    const externalExecution = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: '不应执行' }],
      details: { changed: true },
    }));
    tools.registry.register({
      tool: {
        name: 'external-test-tool',
        label: '外部测试工具',
        description: '仅用于验证审批工具批次隔离',
        parameters: Type.Object({}),
        executionMode: 'sequential',
        execute: externalExecution,
      },
      riskLevel: 'high',
      effect: 'external_side_effect',
      capabilities: ['external_api'],
      requiredPermissions: [],
      requiresToolApproval: true,
    });
    let streamCalls = 0;
    let secondContext: Context | undefined;
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
            secondContext = streamCalls === 2 ? context : secondContext;
            const stream = new AssistantMessageEventStream();
            const message = {
              ...assistantMessage,
              content:
                streamCalls === 1
                  ? [
                      {
                        type: 'toolCall' as const,
                        id: 'mixed-read-call',
                        name: 'get_current_time',
                        arguments: {},
                      },
                      {
                        type: 'toolCall' as const,
                        id: 'mixed-approval-call',
                        name: 'external-test-tool',
                        arguments: {},
                      },
                    ]
                  : [{ type: 'text' as const, text: '请单独确认外部操作' }],
              stopReason:
                streamCalls === 1 ? ('toolUse' as const) : ('stop' as const),
            };
            queueMicrotask(() => {
              stream.push({ type: 'start', partial: message });
              if (streamCalls === 2) {
                stream.push({
                  type: 'text_delta',
                  contentIndex: 0,
                  delta: '请单独确认外部操作',
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

    for await (const _event of service.chat(
      'mixed-tool-session',
      '同时执行两个工具',
      'user-a',
    )) {
      // Consume the safely blocked turn.
    }

    expect(streamCalls).toBe(2);
    expect(externalExecution).not.toHaveBeenCalled();
    const blockedResults = secondContext?.messages.filter(
      (entry) => entry.role === 'toolResult',
    );
    expect(blockedResults).toHaveLength(2);
    expect(blockedResults?.every((entry) => entry.isError)).toBe(true);
    expect(JSON.stringify(blockedResults)).toContain(
      '必须在单独一次工具调用中发起',
    );
  });

  it('checkpoints a pending approval tool result before the task leaves the agent loop', async () => {
    const store = new MemorySessionStore();
    const sessions = new SessionManager(new ConfigService(), store);
    const tools = createToolServices();
    const externalExecution = vi.fn();
    tools.registry.register({
      tool: {
        name: 'checkpoint-external-tool',
        label: '审批快照测试工具',
        description: '验证审批等待上下文先于任务状态持久化',
        parameters: Type.Object({}),
        executionMode: 'sequential',
        execute: externalExecution,
      },
      riskLevel: 'high',
      effect: 'external_side_effect',
      capabilities: ['external_api'],
      requiredPermissions: [],
      requiresToolApproval: true,
    });
    const service = new PiAgentService(
      new ConfigService({ DEFAULT_PROVIDER: 'deepseek' }),
      {
        ...mockGateway({
          getModels: () => [fakeModel],
          streamSimple: () => {
            const stream = new AssistantMessageEventStream();
            const message = {
              ...assistantMessage,
              content: [
                {
                  type: 'toolCall' as const,
                  id: 'checkpoint-call',
                  name: 'checkpoint-external-tool',
                  arguments: {},
                },
              ],
              stopReason: 'toolUse' as const,
            };
            queueMicrotask(() => {
              stream.push({ type: 'start', partial: message });
              stream.push({ type: 'done', reason: 'toolUse', message });
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
      'checkpoint-session',
      '等待审批',
      'user-a',
      { taskId: 'task-a', operationId: 'operation-a' },
    )) {
      events.push(event);
    }

    expect(externalExecution).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool_confirmation_pending' }),
    );
    const restored = await new SessionManager(
      new ConfigService(),
      store,
    ).getOrCreate('checkpoint-session', 'user-a');
    const pendingResult = restored.contextMessages.find(
      (entry) =>
        entry.role === 'toolResult' && entry.toolCallId === 'checkpoint-call',
    );
    expect(pendingResult?.role).toBe('toolResult');
    if (pendingResult?.role === 'toolResult') {
      expect(pendingResult.details).toEqual(
        expect.objectContaining({ status: 'pending_tool_approval' }),
      );
    }
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

  it('replaces a persisted pending tool result and continues after approval', async () => {
    const store = new MemorySessionStore();
    const preparingManager = new SessionManager(new ConfigService(), store);
    await preparingManager.getOrCreate('approval-session', 'user-a');
    await preparingManager.saveMessage(
      'approval-session',
      'user-a',
      'user',
      '执行外部工具',
    );
    await preparingManager.completeAssistantTurn(
      'approval-session',
      'user-a',
      undefined,
      [
        { role: 'user', content: '执行外部工具', timestamp: 1 },
        {
          ...assistantMessage,
          content: [
            {
              type: 'toolCall',
              id: 'approval-call-1',
              name: 'external-test-tool',
              arguments: { value: 'safe' },
            },
          ],
          stopReason: 'toolUse',
        },
        {
          role: 'toolResult',
          toolCallId: 'approval-call-1',
          toolName: 'external-test-tool',
          content: [{ type: 'text', text: '外部工具调用等待用户审批。' }],
          details: { status: 'pending_tool_approval' },
          isError: false,
          timestamp: 2,
        },
      ],
    );
    let continuedContext: Context | undefined;
    let snapshotAtProviderStart:
      Promise<Awaited<ReturnType<MemorySessionStore['find']>>> | undefined;
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
            continuedContext = context;
            snapshotAtProviderStart = store.find('approval-session', 'user-a');
            const stream = new AssistantMessageEventStream();
            const message = {
              ...assistantMessage,
              content: [{ type: 'text' as const, text: '工具执行成功' }],
            };
            queueMicrotask(() => {
              stream.push({ type: 'start', partial: message });
              stream.push({
                type: 'text_delta',
                contentIndex: 0,
                delta: '工具执行成功',
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

    const events = [];
    for await (const event of service.continueAfterToolDecision(
      'approval-session',
      'user-a',
      {
        toolCallId: 'approval-call-1',
        toolName: 'external-test-tool',
        result: {
          content: [{ type: 'text', text: '已执行' }],
          details: { status: 'executed', receipt: 'safe-reference' },
        },
      },
      { taskId: 'task-a', operationId: 'operation-a' },
    )) {
      events.push(event);
    }

    const resumedResult = continuedContext?.messages.find(
      (entry) =>
        entry.role === 'toolResult' && entry.toolCallId === 'approval-call-1',
    );
    expect(resumedResult?.role).toBe('toolResult');
    if (resumedResult?.role === 'toolResult') {
      expect(resumedResult.content).toEqual([{ type: 'text', text: '已执行' }]);
      expect(resumedResult.details).toEqual({
        status: 'executed',
        receipt: 'safe-reference',
      });
    }
    expect(JSON.stringify(continuedContext)).not.toContain(
      'pending_tool_approval',
    );
    expect(
      JSON.stringify((await snapshotAtProviderStart)?.contextMessages),
    ).toContain('safe-reference');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'text_delta', data: '工具执行成功' }),
    );
    await expect(
      sessions.getHistory('approval-session', 'user-a'),
    ).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: '执行外部工具' }),
      expect.objectContaining({ role: 'assistant', content: '工具执行成功' }),
    ]);
  });

  it('resumes a task from a persisted approved tool result without replaying the prompt', async () => {
    const store = new MemorySessionStore();
    const preparingManager = new SessionManager(new ConfigService(), store);
    await preparingManager.getOrCreate('privacy-resume-session', 'user-a');
    await preparingManager.saveMessage(
      'privacy-resume-session',
      'user-a',
      'user',
      '原始任务输入',
    );
    await preparingManager.completeAssistantTurn(
      'privacy-resume-session',
      'user-a',
      undefined,
      [
        { role: 'user', content: '原始任务输入', timestamp: 1 },
        {
          ...assistantMessage,
          content: [
            {
              type: 'toolCall',
              id: 'persisted-approved-call',
              name: 'external-test-tool',
              arguments: {},
            },
          ],
          stopReason: 'toolUse',
        },
        {
          role: 'toolResult',
          toolCallId: 'persisted-approved-call',
          toolName: 'external-test-tool',
          content: [{ type: 'text', text: '外部操作已经完成' }],
          details: { receipt: 'safe-reference' },
          isError: false,
          timestamp: 2,
        },
      ],
    );
    await preparingManager.saveMessage(
      'privacy-resume-session',
      'user-a',
      'user',
      '后续排队输入',
    );

    let resumedContext: Context | undefined;
    const sessions = new SessionManager(new ConfigService(), store);
    const tools = createToolServices();
    const service = new PiAgentService(
      new ConfigService({ DEFAULT_PROVIDER: 'deepseek' }),
      {
        ...mockGateway({
          getModels: () => [fakeModel],
          streamSimple: (_model: unknown, context: Context) => {
            resumedContext = context;
            const stream = new AssistantMessageEventStream();
            const message = {
              ...assistantMessage,
              content: [{ type: 'text' as const, text: '从工具结果继续' }],
            };
            queueMicrotask(() => {
              stream.push({ type: 'start', partial: message });
              stream.push({
                type: 'text_delta',
                contentIndex: 0,
                delta: '从工具结果继续',
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

    for await (const _event of service.resumeTask(
      'privacy-resume-session',
      '原始任务输入',
      'user-a',
      { taskId: 'task-a', source: 'privacy_resume' },
    )) {
      // Consume the resumed continuation.
    }

    expect(resumedContext?.messages.at(-1)?.role).toBe('toolResult');
    expect(JSON.stringify(resumedContext)).not.toContain('后续排队输入');
    expect(
      resumedContext?.messages.filter(
        (entry) => entry.role === 'user' && entry.content === '原始任务输入',
      ),
    ).toHaveLength(1);
    await expect(
      sessions.getHistory('privacy-resume-session', 'user-a'),
    ).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: '原始任务输入' }),
      expect.objectContaining({ role: 'user', content: '后续排队输入' }),
      expect.objectContaining({ role: 'assistant', content: '从工具结果继续' }),
    ]);
  });

  it('trims context only at a complete user-turn boundary', () => {
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
    const trimmed = trimCompleteTurns([...firstToolTurn, ...laterTurns]);
    expect(trimmed[0]).toMatchObject({ role: 'user', content: '问题-0' });
    expect(trimmed.some((message) => message.role === 'toolResult')).toBe(
      false,
    );
  });
});
