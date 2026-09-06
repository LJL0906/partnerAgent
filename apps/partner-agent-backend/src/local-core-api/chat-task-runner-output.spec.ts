import { describe, expect, it, vi } from 'vitest';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { MemoryEgressDecisionStore } from '../model-gateway/memory-egress-decision.store.js';
import type { PiAgentService } from '../agent/pi-agent.service.js';
import { ChatPreviewOutputCollector, StructuredPreviewOutputError } from '../agent/chat-preview-output.js';
import { ChatTaskEventBus, type ChatTaskEvent } from './chat-task-event.bus.js';
import { ChatTaskRunner, type ChatTaskAgentEvent } from './chat-task-runner.js';
import { MemoryChatTaskStore } from './memory-chat-task.store.js';

async function claimedTask(outputMode: 'chat' | 'structured_preview' = 'chat') {
  const sessions = new MemorySessionStore();
  const store = new MemoryChatTaskStore(sessions);
  const accepted = await store.submitText({
    ownerId: 'owner-runner',
    operationId: `operation-${outputMode}`,
    requestFingerprint: `fingerprint-${outputMode}`,
    clientSource: 'web',
    text: '安排任务',
    inputId: `input-${outputMode}`,
    outputMode,
    ...(outputMode === 'structured_preview' ? { previewKind: 'action' as const } : {}),
  });
  const task = await store.claimNextRunnable('worker-runner', 30_000);
  return { sessions, store, task: task ?? accepted.task! };
}

async function* events(values: ChatTaskAgentEvent[]) {
  for (const value of values) yield value;
}

describe('ChatTaskRunner assistant output', () => {
  it('persists text before publishing it and commits preview before completion', async () => {
    const { store, task } = await claimedTask('structured_preview');
    const bus = new ChatTaskEventBus();
    const published: ChatTaskEvent[] = [];
    bus.subscribe((event) => published.push(event));
    const preview = new ChatPreviewOutputCollector({
      taskId: task.taskId,
      allowedSourceRefs: [{ kind: 'original_record', id: task.originalRecordId }],
    }).collect({
      schema_version: 1,
      kind: 'action',
      content: { title: '提交报销', confidence: 0.9 },
    });
    const runner = new ChatTaskRunner(
      { cancel: vi.fn() } as unknown as PiAgentService,
      store,
      bus,
      new MemoryEgressDecisionStore(),
      30_000,
      () => false,
      () => false,
      () => undefined,
    );

    await runner.run(
      task,
      events([
        { type: 'text_delta', data: '已生成', timestamp: 1 },
        {
          type: 'assistant_output_complete',
          data: { content: '已生成', chatPreviews: [preview], contextMessages: [] },
          timestamp: 2,
        },
        { type: 'done', timestamp: 3 },
      ]),
      'worker-runner',
    );

    const textEventIndex = published.findIndex((event) => event.eventType === 'text_delta');
    const completeIndex = published.findIndex((event) => event.state === 'completed');
    expect(textEventIndex).toBeGreaterThanOrEqual(0);
    expect(completeIndex).toBeGreaterThan(textEventIndex);
    await expect(store.getTask(task.ownerId, task.taskId)).resolves.toMatchObject({
      state: 'completed',
      resultMessageId: expect.any(String),
    });
    await expect(store.listSessionChatPreviews(task.ownerId, task.sessionId)).resolves.toMatchObject([
      { task_id: task.taskId, preview },
    ]);
  });

  it('fails a structured task that ends without a tool output', async () => {
    const { store, task } = await claimedTask('structured_preview');
    const runner = new ChatTaskRunner(
      { cancel: vi.fn() } as unknown as PiAgentService,
      store,
      new ChatTaskEventBus(),
      new MemoryEgressDecisionStore(),
      30_000,
      () => false,
      () => false,
      () => undefined,
    );

    await runner.run(task, events([{ type: 'done', timestamp: 1 }]), 'worker-runner');

    await expect(store.getTask(task.ownerId, task.taskId)).resolves.toMatchObject({
      state: 'failed',
      errorCode: 'STRUCTURED_PREVIEW_MISSING',
    });
  });

  it('preserves safe structured output error codes', async () => {
    const { store, task } = await claimedTask('structured_preview');
    async function* invalid(): AsyncGenerator<ChatTaskAgentEvent> {
      yield* [];
      throw new StructuredPreviewOutputError(
        'STRUCTURED_PREVIEW_SOURCE_INVALID',
        '结构化预览来源不属于当前任务输入。',
      );
    }
    const runner = new ChatTaskRunner(
      { cancel: vi.fn() } as unknown as PiAgentService,
      store,
      new ChatTaskEventBus(),
      new MemoryEgressDecisionStore(),
      30_000,
      () => false,
      () => false,
      () => undefined,
    );

    await runner.run(task, invalid(), 'worker-runner');

    await expect(store.getTask(task.ownerId, task.taskId)).resolves.toMatchObject({
      state: 'failed',
      errorCode: 'STRUCTURED_PREVIEW_SOURCE_INVALID',
    });
  });

  it('does not commit a late output after cancellation', async () => {
    const { store, task } = await claimedTask('chat');
    await store.cancelTask(task.ownerId, {
      operation_id: 'cancel-operation',
      request_fingerprint: 'cancel-fingerprint',
      client_source: 'web',
      payload: { task_id: task.taskId },
    });
    const runner = new ChatTaskRunner(
      { cancel: vi.fn() } as unknown as PiAgentService,
      store,
      new ChatTaskEventBus(),
      new MemoryEgressDecisionStore(),
      30_000,
      () => false,
      () => false,
      () => undefined,
    );

    await runner.run(
      task,
      events([{
        type: 'assistant_output_complete',
        data: { content: '迟到正文', chatPreviews: [], contextMessages: [] },
        timestamp: 1,
      }]),
      'worker-runner',
    );

    await expect(store.getTask(task.ownerId, task.taskId)).resolves.toMatchObject({ state: 'cancelled' });
    await expect(store.listSessionChatPreviews(task.ownerId, task.sessionId)).resolves.toEqual([]);
  });

  it('resumes from a persisted text prefix without duplicating it', async () => {
    const { store, task } = await claimedTask('chat');
    await store.appendAssistantProgress({
      ownerId: task.ownerId,
      sessionId: task.sessionId,
      taskId: task.taskId,
      operationId: task.operationId,
      leaseToken: 'worker-runner',
      expectedRevision: 0,
      textOffset: 0,
      delta: '已生成',
    });
    const runner = new ChatTaskRunner(
      { cancel: vi.fn() } as unknown as PiAgentService,
      store,
      new ChatTaskEventBus(),
      new MemoryEgressDecisionStore(),
      30_000,
      () => false,
      () => false,
      () => undefined,
    );

    await runner.run(
      task,
      events([
        { type: 'text_delta', data: '已', timestamp: 1 },
        { type: 'text_delta', data: '生成新结果', timestamp: 2 },
        {
          type: 'assistant_output_complete',
          data: { content: '已生成新结果', chatPreviews: [], contextMessages: [] },
          timestamp: 3,
        },
      ]),
      'worker-runner',
    );

    const messages = await store.listSessionMessages(task.ownerId, task.sessionId);
    expect(messages.filter((message) => message.task_id === task.taskId)).toEqual([
      expect.objectContaining({ content: '已生成新结果', status: 'complete' }),
    ]);
  });
});
