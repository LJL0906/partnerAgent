import { ConfigService } from '@nestjs/config';
import { AssistantMessageEventStream, type Context } from '@earendil-works/pi-ai';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { SessionManager } from './session-manager.service.js';
import { ToolRegistryService } from '../tools/tool-registry.service.js';
import { ToolExecutionService } from '../tools/tool-execution.service.js';
import { MemoryToolOperationStore } from '../tools/memory-tool-operation.store.js';
import { RedactionService } from '../tools/redaction.service.js';
import { ChatPreviewOutputCollector } from './chat-preview-output.js';
import { PiAgentService, type BackendAgentEvent } from './pi-agent.service.js';

interface ChatPreviewAgentFixture {
  request: {
    payload: {
      session_id: string;
      text: string;
    };
  };
  accepted_task_context: {
    task_id: string;
    operation_id: string;
    original_record_id: string;
    user_message_id: string;
    output_mode: 'structured_preview';
    preview_kind: 'action';
  };
  invalid_provider_tool_calls: Array<{
    case: string;
    expected_code: string;
    arguments: Record<string, unknown>;
  }>;
  missing_output: {
    assistant_text: string;
    expected_code: string;
  };
}

const fixture = JSON.parse(readFileSync(new URL(
  '../../test/fixtures/chat-preview-agent-cases.json',
  import.meta.url,
), 'utf8')) as ChatPreviewAgentFixture;
const require = createRequire(import.meta.url);
const sharedPreviewFixture = require(
  '@partner-agent/contracts/fixtures/chat-preview-v1.json',
) as { valid_proposal: Record<string, unknown> };

const model = {
  id: 'preview-model',
  name: 'Preview Model',
  api: 'openai-completions',
  provider: 'deepseek',
  baseUrl: 'https://example.test',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 1024,
};

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function response(content: Array<Record<string, unknown>>, stopReason: 'stop' | 'toolUse') {
  const message = {
    role: 'assistant' as const,
    content,
    api: 'openai-completions' as const,
    provider: 'deepseek',
    model: model.id,
    usage,
    stopReason,
    timestamp: Date.now(),
  };
  const stream = new AssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: 'start', partial: message });
    for (const [contentIndex, part] of content.entries()) {
      if (part.type === 'text') {
        stream.push({
          type: 'text_delta',
          contentIndex,
          delta: String(part.text),
          partial: message,
        });
      }
    }
    stream.push({ type: 'done', reason: stopReason, message });
    stream.end(message);
  });
  return stream;
}

function serviceWith(
  responder: (call: number, context: Context) => AssistantMessageEventStream,
  config: Record<string, string> = {},
) {
  const sessions = new SessionManager(new ConfigService(), new MemorySessionStore());
  const registry = new ToolRegistryService();
  const execution = new ToolExecutionService(
    registry,
    new MemoryToolOperationStore(),
    new RedactionService(),
    new ConfigService(),
  );
  let calls = 0;
  let exposedTools: string[][] = [];
  const service = new PiAgentService(
    new ConfigService({
      DEFAULT_PROVIDER: 'deepseek',
      DEFAULT_MODEL: model.id,
      ...config,
    }),
    {
      listModels: () => [model],
      resolveModel: () => model,
      createStreamFunction: () => (_model: unknown, context: Context) => {
        calls += 1;
        exposedTools.push(context.tools?.map((tool) => tool.name) ?? []);
        return responder(calls, context);
      },
    } as never,
    sessions,
    execution,
    registry,
  );
  return { service, calls: () => calls, exposedTools: () => exposedTools };
}

const previewContext = {
  taskId: fixture.accepted_task_context.task_id,
  operationId: fixture.accepted_task_context.operation_id,
  outputMode: fixture.accepted_task_context.output_mode,
  previewKind: fixture.accepted_task_context.preview_kind,
  originalRecordId: fixture.accepted_task_context.original_record_id,
  userMessageId: fixture.accepted_task_context.user_message_id,
};

async function consume(generator: AsyncGenerator<BackendAgentEvent>) {
  const values: BackendAgentEvent[] = [];
  for await (const value of generator) values.push(value);
  return values;
}

describe('PiAgentService structured output protocol', () => {
  it('replays the shared provider fixture into the expected committed preview', async () => {
    const runtime = serviceWith((call) =>
      call === 1
        ? response([{
            type: 'toolCall',
            id: 'fixture-preview-call',
            name: 'emit_chat_preview',
            arguments: {
              ...sharedPreviewFixture.valid_proposal,
              source_refs: [
                { kind: 'original_record', id: previewContext.originalRecordId },
                { kind: 'chat_message', id: previewContext.userMessageId },
              ],
            },
          }], 'toolUse')
        : response([{ type: 'text', text: '已生成待确认预览。' }], 'stop'),
    );

    const events = await consume(runtime.service.resumeTask(
      fixture.request.payload.session_id,
      fixture.request.payload.text,
      'owner',
      previewContext,
    ));

    expect(events).toContainEqual(expect.objectContaining({
      type: 'assistant_output_complete',
      data: expect.objectContaining({
        chatPreviews: [expect.objectContaining({
          content: sharedPreviewFixture.valid_proposal.content,
        })],
      }),
    }));
  });

  it.each(fixture.invalid_provider_tool_calls)(
    'rejects fixture provider output: $case',
    ({ expected_code: expectedCode, arguments: argumentsValue }) => {
      const collector = new ChatPreviewOutputCollector({
        taskId: previewContext.taskId,
        allowedSourceRefs: [
          { kind: 'original_record', id: previewContext.originalRecordId },
          { kind: 'chat_message', id: previewContext.userMessageId },
        ],
      });

      expect(() => collector.collect(argumentsValue)).toThrowError(
        expect.objectContaining({ code: expectedCode }),
      );
      expect(collector.snapshot()).toEqual([]);
    },
  );

  it('offers the preview tool to ordinary chat without parsing正文 JSON as a preview', async () => {
    const runtime = serviceWith(() =>
      response([{ type: 'text', text: '{"kind":"action"}' }], 'stop'),
    );

    const events = await consume(runtime.service.resumeTask(
      'plain-task-session',
      '普通聊天',
      'owner',
      { ...previewContext, outputMode: 'chat', previewKind: undefined },
    ));

    expect(runtime.exposedTools()[0]).toContain('emit_chat_preview');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'assistant_output_complete',
      data: expect.objectContaining({ chatPreviews: [] }),
    }));
  });

  it('accepts an action preview chosen by the model during ordinary chat', async () => {
    const runtime = serviceWith((call) =>
      call === 1
        ? response([{
            type: 'toolCall',
            id: 'auto-preview-call',
            name: 'emit_chat_preview',
            arguments: {
              ...sharedPreviewFixture.valid_proposal,
              source_refs: [
                { kind: 'original_record', id: previewContext.originalRecordId },
                { kind: 'chat_message', id: previewContext.userMessageId },
              ],
            },
          }], 'toolUse')
        : response([{ type: 'text', text: '这是待确认的行动预览。' }], 'stop'),
    );

    const events = await consume(runtime.service.resumeTask(
      'auto-preview-session',
      '请帮我安排明天提交周报',
      'owner',
      { ...previewContext, outputMode: 'chat', previewKind: undefined },
    ));

    expect(events).toContainEqual(expect.objectContaining({
      type: 'assistant_output_complete',
      data: expect.objectContaining({
        chatPreviews: [expect.objectContaining({ kind: 'action' })],
      }),
    }));
  });

  it('gives missing output exactly one budgeted correction and then fails', async () => {
    const runtime = serviceWith(() =>
      response([{ type: 'text', text: fixture.missing_output.assistant_text }], 'stop'),
    );

    await expect(consume(runtime.service.resumeTask(
      'missing-preview-session', '生成行动', 'owner', previewContext,
    ))).rejects.toMatchObject({ code: fixture.missing_output.expected_code });
    expect(runtime.calls()).toBe(2);
  });

  it('does not start the correction when the existing model-turn budget is exhausted', async () => {
    const runtime = serviceWith(
      () => response([{ type: 'text', text: '没有工具输出' }], 'stop'),
      { AGENT_RUN_MAX_MODEL_TURNS: '1' },
    );

    const events = await consume(runtime.service.resumeTask(
      'budget-preview-session', '生成行动', 'owner', previewContext,
    ));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({ code: 'AGENT_BUDGET_002' }),
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'assistant_output_complete',
    }));
    expect(runtime.calls()).toBe(1);
  });

  it('accepts one corrected tool output after an invalid source', async () => {
    const runtime = serviceWith((call) => {
      if (call <= 2) {
        return response([{
          type: 'toolCall',
          id: `preview-call-${call}`,
          name: 'emit_chat_preview',
          arguments: {
            schema_version: 1,
            kind: 'action',
            ...(call === 1
              ? { source_refs: [{ kind: 'original_record', id: 'other-record' }] }
              : {}),
            content: { title: '提交报销', confidence: 0.9 },
          },
        }], 'toolUse');
      }
      return response([{ type: 'text', text: '已生成待确认预览。' }], 'stop');
    });

    const events = await consume(runtime.service.resumeTask(
      'corrected-preview-session', '生成行动', 'owner', previewContext,
    ));

    expect(runtime.calls()).toBe(3);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'assistant_output_complete',
      data: expect.objectContaining({
        chatPreviews: [expect.objectContaining({
          confirmation_status: 'unconfirmed',
          applied: false,
        })],
      }),
    }));
  });

  it('counts multiple invalid preview calls in one model turn as one correction attempt', async () => {
    const invalidCall = (id: string) => ({
      type: 'toolCall',
      id,
      name: 'emit_chat_preview',
      arguments: {
        schema_version: 1,
        kind: 'action',
        source_refs: [{ kind: 'original_record', id: 'other-record' }],
        content: { title: '提交周报', confidence: 0.9 },
      },
    });
    const runtime = serviceWith((call) => {
      if (call === 1) {
        return response([
          invalidCall('invalid-preview-a'),
          invalidCall('invalid-preview-b'),
        ], 'toolUse');
      }
      if (call === 2) {
        return response([{
          type: 'toolCall',
          id: 'corrected-preview',
          name: 'emit_chat_preview',
          arguments: {
            ...sharedPreviewFixture.valid_proposal,
            source_refs: [
              { kind: 'original_record', id: previewContext.originalRecordId },
              { kind: 'chat_message', id: previewContext.userMessageId },
            ],
          },
        }], 'toolUse');
      }
      return response([{ type: 'text', text: '已生成待确认预览。' }], 'stop');
    });

    const events = await consume(runtime.service.resumeTask(
      'same-turn-invalid-preview-session',
      '明天下午三点提醒我提交周报',
      'owner',
      previewContext,
    ));

    expect(runtime.calls()).toBe(3);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'assistant_output_complete',
      data: expect.objectContaining({
        chatPreviews: [expect.objectContaining({ kind: 'action' })],
      }),
    }));
  });

  it('stops after the second invalid output and exposes no raw arguments', async () => {
    const secretTitle = '不应出现在错误事件中的秘密标题';
    const runtime = serviceWith((call) =>
      response([{
        type: 'toolCall',
        id: `invalid-preview-${call}`,
        name: 'emit_chat_preview',
        arguments: {
          schema_version: 1,
          kind: 'action',
          source_refs: [{ kind: 'original_record', id: 'other-record' }],
          content: { title: secretTitle, confidence: 0.8 },
        },
      }], 'toolUse'),
    );

    let error: unknown;
    try {
      await consume(runtime.service.resumeTask(
        'invalid-preview-session', '生成行动', 'owner', previewContext,
      ));
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: 'STRUCTURED_PREVIEW_INVALID' });
    expect(String(error)).not.toContain(secretTitle);
    expect(runtime.calls()).toBe(2);
  });

  it('does not grant a second correction when invalid output is followed by missing output', async () => {
    const runtime = serviceWith((call) =>
      call === 1
        ? response([{
            type: 'toolCall',
            id: 'invalid-then-missing',
            name: 'emit_chat_preview',
            arguments: {
              schema_version: 1,
              kind: 'action',
              source_refs: [{ kind: 'chat_message', id: 'other-message' }],
              content: { title: '非法来源', confidence: 0.7 },
            },
          }], 'toolUse')
        : response([{ type: 'text', text: '仍未调用工具' }], 'stop'),
    );

    await expect(consume(runtime.service.resumeTask(
      'invalid-missing-session', '生成行动', 'owner', previewContext,
    ))).rejects.toMatchObject({ code: 'STRUCTURED_PREVIEW_INVALID' });
    expect(runtime.calls()).toBe(2);
  });
});
