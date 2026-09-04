import { describe, expect, it } from 'vitest';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { ChatTaskConflictError } from './chat-task.store.js';
import { MemoryChatTaskStore } from './memory-chat-task.store.js';

const base = {
  ownerId: 'owner',
  operationId: 'operation-1',
  requestFingerprint: 'fingerprint-1',
  clientSource: 'web',
  text: '只保存一次',
  inputId: 'input-1',
};

describe('ChatTaskStore', () => {
  it('atomically registers one input, user message and queued task', async () => {
    const sessions = new MemorySessionStore();
    const store = new MemoryChatTaskStore(sessions);
    const accepted = await store.submitText(base);
    expect(accepted.result).toMatchObject({ status: 'accepted' });
    expect(accepted.task).toMatchObject({ state: 'queued', text: base.text });
    const session = await sessions.find(accepted.task!.sessionId, base.ownerId);
    expect(session?.messages).toHaveLength(1);
    expect(session?.messages[0]).toMatchObject({
      role: 'user',
      content: base.text,
    });
  });

  it('replays command and input idempotently without duplicate messages', async () => {
    const sessions = new MemorySessionStore();
    const store = new MemoryChatTaskStore(sessions);
    const first = await store.submitText(base);
    const commandReplay = await store.submitText(base);
    const inputReplay = await store.submitText({
      ...base,
      operationId: 'operation-2',
    });
    expect(commandReplay.result).toMatchObject({ status: 'duplicate' });
    expect(inputReplay.result).toMatchObject({ status: 'duplicate' });
    expect(
      (inputReplay.result.data as Record<string, any>).chat_task.task_id,
    ).toBe(first.task!.taskId);
    expect(
      (await sessions.find(first.task!.sessionId, base.ownerId))?.messages,
    ).toHaveLength(1);
  });

  it('rejects reused idempotency ids with a different fingerprint', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    await store.submitText(base);
    await expect(
      store.submitText({ ...base, requestFingerprint: 'different' }),
    ).rejects.toBeInstanceOf(ChatTaskConflictError);
    await expect(
      store.submitText({
        ...base,
        operationId: 'operation-2',
        requestFingerprint: 'different',
      }),
    ).rejects.toBeInstanceOf(ChatTaskConflictError);
  });

  it('rejects one operation id reused across different commands', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    const accepted = await store.submitText(base);
    await expect(
      store.cancelTask(base.ownerId, {
        operation_id: base.operationId,
        request_fingerprint: base.requestFingerprint,
        payload: { task_id: accepted.task!.taskId },
      }),
    ).rejects.toBeInstanceOf(ChatTaskConflictError);
  });

  it('persists cancellation and enforces task ownership', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    const accepted = await store.submitText(base);
    const taskId = accepted.task!.taskId;
    await expect(
      store.cancelTask('other', {
        operation_id: 'cancel-other',
        request_fingerprint: 'cancel-other-fingerprint',
        payload: { task_id: taskId },
      }),
    ).rejects.toThrow('AUTH_002');
    const cancelled = await store.cancelTask(base.ownerId, {
      operation_id: 'cancel-1',
      request_fingerprint: 'cancel-fingerprint',
      payload: { task_id: taskId },
    });
    expect(cancelled.result).toMatchObject({ data: { state: 'cancelled' } });
    expect(await store.ownsTask(base.ownerId, taskId)).toBe(true);
    expect(await store.ownsTask('other', taskId)).toBe(false);
    expect(await store.ownsOperation(base.ownerId, base.operationId)).toBe(
      true,
    );
  });

  it('claims a privacy resume exactly once and never through markRunning', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    const accepted = await store.submitText(base);
    const taskId = accepted.task!.taskId;
    await store.markRunning(taskId, base.ownerId);
    await store.markWaiting(taskId, base.ownerId);

    expect(await store.markRunning(taskId, base.ownerId)).toBe(false);
    expect(await store.claimPrivacyResume(taskId, 'other')).toBeUndefined();
    expect(await store.claimPrivacyResume(taskId, base.ownerId)).toMatchObject({
      taskId,
      state: 'running',
    });
    expect(
      await store.claimPrivacyResume(taskId, base.ownerId),
    ).toBeUndefined();
  });
});
