import { describe, expect, it } from 'vitest';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { MemoryChatTaskStore } from './memory-chat-task.store.js';

describe('ChatTask structured output mode', () => {
  it('survives acceptance, claim and task reload', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    const accepted = await store.submitText({
      ownerId: 'owner-preview',
      operationId: 'operation-preview',
      requestFingerprint: 'fingerprint-preview',
      clientSource: 'web',
      text: '帮我安排周五提交报销',
      inputId: 'input-preview',
      outputMode: 'structured_preview',
      previewKind: 'action',
    });

    expect(accepted.task).toMatchObject({
      outputMode: 'structured_preview',
      previewKind: 'action',
    });
    const claimed = await store.claimNextRunnable('worker-preview', 30_000);
    expect(claimed).toMatchObject({
      outputMode: 'structured_preview',
      previewKind: 'action',
      originalRecordId: expect.any(String),
      userMessageId: expect.any(String),
    });
    await expect(
      store.getTask('owner-preview', accepted.task!.taskId),
    ).resolves.toMatchObject({
      outputMode: 'structured_preview',
      previewKind: 'action',
    });
  });

  it('uses chat mode without a preview kind by default', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    const accepted = await store.submitText({
      ownerId: 'owner-chat',
      operationId: 'operation-chat',
      requestFingerprint: 'fingerprint-chat',
      clientSource: 'web',
      text: '你好',
      inputId: 'input-chat',
    });

    expect(accepted.task).toMatchObject({ outputMode: 'chat' });
    expect(accepted.task).not.toHaveProperty('previewKind');
  });
});
