import { describe, expect, it, vi } from 'vitest';
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
  it('persists analysis rejection idempotently without chat side effects', async () => {
    const sessions = new MemorySessionStore();
    const store = new MemoryChatTaskStore(sessions);
    const command = {
      ownerId: base.ownerId,
      operationId: base.operationId,
      requestFingerprint: base.requestFingerprint,
      requestedTypes: ['idea_organize'],
    };

    const first = await store.rejectInputAnalysis(command);
    const replay = await store.rejectInputAnalysis(command);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      code: 'NOT_IMPLEMENTED_001',
      details: {
        feature: 'input_analysis',
        requested_types: ['idea_organize'],
        operation_id: base.operationId,
      },
    });
    expect(await store.ownsOperation(base.ownerId, base.operationId)).toBe(
      true,
    );
    expect(await sessions.find('anything', base.ownerId)).toBeUndefined();
  });

  it('rejects an analysis operation replay with a different fingerprint', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    await store.rejectInputAnalysis({
      ownerId: base.ownerId,
      operationId: base.operationId,
      requestFingerprint: base.requestFingerprint,
      requestedTypes: ['idea_organize'],
    });
    await expect(
      store.rejectInputAnalysis({
        ownerId: base.ownerId,
        operationId: base.operationId,
        requestFingerprint: 'different',
        requestedTypes: ['idea_organize'],
      }),
    ).rejects.toBeInstanceOf(ChatTaskConflictError);
  });

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
    await expect(store.countRunnable()).resolves.toBe(1);
    await store.claimNextRunnable('worker-a', 30_000);
    await expect(store.countRunnable()).resolves.toBe(0);
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
      state: 'queued',
    });
    expect(
      await store.claimPrivacyResume(taskId, base.ownerId),
    ).toBeUndefined();
  });

  it('leases at most one runnable task per session while other sessions proceed', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    const first = await store.submitText({
      ...base,
      sessionId: 'shared-session',
    });
    const second = await store.submitText({
      ...base,
      operationId: 'operation-2',
      inputId: 'input-2',
      requestFingerprint: 'fingerprint-2',
      sessionId: 'shared-session',
    });
    const claimed = await store.claimNextRunnable('worker-1', 30_000);
    expect([first.task!.taskId, second.task!.taskId]).toContain(
      claimed?.taskId,
    );

    const other = await store.submitText({
      ...base,
      operationId: 'operation-3',
      inputId: 'input-3',
      requestFingerprint: 'fingerprint-3',
      sessionId: 'other-session',
    });
    expect(await store.claimNextRunnable('worker-2', 30_000)).toMatchObject({
      taskId: other.task!.taskId,
    });

    await store.markCompleted(claimed!.taskId, claimed!.ownerId, 'worker-1');
    expect(await store.claimNextRunnable('worker-1', 30_000)).toMatchObject({
      sessionId: 'shared-session',
    });
  });

  it('recovers expired normal leases but leaves expired tool decisions waiting', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    const accepted = await store.submitText(base);
    const claimed = await store.claimNextRunnable('worker-1', 1_000);
    expect(claimed).toMatchObject({ attemptCount: 1, state: 'running' });
    await store.recoverExpiredLeases(new Date(Date.now() + 2_000));
    expect(
      await store.getTask(base.ownerId, accepted.task!.taskId),
    ).toMatchObject({
      state: 'queued',
    });

    const reclaimed = await store.claimNextRunnable('worker-2', 1_000);
    await store.markWaitingToolApproval(
      reclaimed!.taskId,
      reclaimed!.ownerId,
      '00000000-0000-4000-8000-000000000001',
      'worker-2',
    );
    const toolClaim = await store.claimToolResume(
      reclaimed!.taskId,
      reclaimed!.ownerId,
      '00000000-0000-4000-8000-000000000001',
      'tool-decision:worker-2:00000000-0000-4000-8000-000000000001',
      1_000,
    );
    expect(toolClaim).toMatchObject({ state: 'running', attemptCount: 3 });
    await store.recoverExpiredLeases(new Date(Date.now() + 2_000));
    expect(
      await store.getTask(base.ownerId, accepted.task!.taskId),
    ).toMatchObject({
      state: 'waiting_tool_approval',
      waitingToolConfirmationId: '00000000-0000-4000-8000-000000000001',
    });
    await expect(
      store.claimNextRunnable('worker-3', 1_000),
    ).resolves.toBeUndefined();
  });

  it('keeps cancellation terminal against stale worker completion and failure', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    const accepted = await store.submitText(base);
    await store.claimNextRunnable('worker-1', 30_000);
    await store.cancelTask(base.ownerId, {
      operation_id: 'cancel-terminal',
      request_fingerprint: 'cancel-terminal-fingerprint',
      payload: { task_id: accepted.task!.taskId },
    });

    await store.markCompleted(accepted.task!.taskId, base.ownerId, 'worker-1');
    await store.markFailed(
      accepted.task!.taskId,
      base.ownerId,
      'INTERNAL_000',
      'stale',
      'worker-1',
    );
    expect(
      await store.getTask(base.ownerId, accepted.task!.taskId),
    ).toMatchObject({
      state: 'cancelled',
    });
  });

  it('increments visible task revisions even when lifecycle changes share one millisecond', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T00:00:00.000Z'));
    try {
      const store = new MemoryChatTaskStore(new MemorySessionStore());
      const accepted = await store.submitText(base);

      expect(accepted.task?.revision).toBe(1);
      const running = await store.claimNextRunnable('worker-revision', 30_000);
      expect(running?.revision).toBe(2);

      await expect(
        store.renewLease(
          running!.taskId,
          running!.ownerId,
          'worker-revision',
          30_000,
        ),
      ).resolves.toBe(true);
      await expect(
        store.getTask(running!.ownerId, running!.taskId),
      ).resolves.toMatchObject({ revision: 2 });

      await expect(
        store.markWaiting(running!.taskId, running!.ownerId, 'worker-revision'),
      ).resolves.toBe(true);
      await expect(
        store.getTask(running!.ownerId, running!.taskId),
      ).resolves.toMatchObject({ revision: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists assistant progress with stable identity, revision and UTF-16 offsets', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    await store.submitText({ ...base, operationId: '00000000-0000-4000-8000-000000000010' });
    const task = await store.claimNextRunnable('worker-progress', 30_000);
    const identity = { ownerId: task!.ownerId, sessionId: task!.sessionId, taskId: task!.taskId, operationId: task!.operationId, leaseToken: 'worker-progress' };

    const first = await store.appendAssistantProgress({ ...identity, expectedRevision: 0, textOffset: 0, delta: '你🙂' });
    const second = await store.appendAssistantProgress({ ...identity, expectedRevision: 1, textOffset: 3, delta: '好' });

    expect(first).toMatchObject({ outcome: 'committed', textOffset: 0, message: { content: '你🙂', revision: 1, status: 'streaming' } });
    expect(second).toMatchObject({ outcome: 'committed', textOffset: 3, message: { content: '你🙂好', revision: 2 } });
    expect(second.outcome === 'committed' && first.outcome === 'committed' ? second.message.id : undefined)
      .toBe(first.outcome === 'committed' ? first.message.id : undefined);
    await expect(store.appendAssistantProgress({ ...identity, expectedRevision: 1, textOffset: 3, delta: '旧写入' }))
      .resolves.toEqual({ outcome: 'conflict' });
    expect((await store.listSessionMessages(task!.ownerId, task!.sessionId)).at(-1)).toMatchObject({
      session_id: task!.sessionId, sequence: 2, role: 'assistant', content: '你🙂好',
      status: 'streaming', revision: 2, task_id: task!.taskId, operation_id: task!.operationId,
    });
  });

  it('completes an attachment-only response once and rejects a cancelled worker', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    await store.submitText({
      ...base,
      operationId: '00000000-0000-4000-8000-000000000020',
      outputMode: 'structured_preview',
      previewKind: 'action',
    });
    const task = await store.claimNextRunnable('worker-complete', 30_000);
    const preview = {
      schema_version: 1 as const, preview_id: 'preview-1', kind: 'action' as const,
      confirmation_status: 'unconfirmed' as const, applied: false as const,
      source_refs: [{ kind: 'chat_message' as const, id: task!.userMessageId }],
      content: { title: '整理资料', confidence: 0.9 }, warnings: [],
    };
    const command = {
      ownerId: task!.ownerId, sessionId: task!.sessionId, taskId: task!.taskId,
      operationId: task!.operationId, leaseToken: 'worker-complete', expectedRevision: 0,
      content: '', chatPreviews: [preview], contextMessages: [{ role: 'assistant', content: [] }],
    };

    const completed = await store.completeAssistantOutput(command);
    const replayed = await store.completeAssistantOutput(command);
    expect(completed).toMatchObject({ outcome: 'committed', task: { state: 'completed' }, message: { content: '', status: 'complete', revision: 1 } });
    expect(replayed).toMatchObject({ outcome: 'already_completed' });
    expect((await store.listSessionMessages(task!.ownerId, task!.sessionId)).filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(await store.listSessionChatPreviews(task!.ownerId, task!.sessionId)).toEqual([
      expect.objectContaining({ task_id: task!.taskId, preview }),
    ]);

    const cancelled = await store.submitText({ ...base, operationId: '00000000-0000-4000-8000-000000000021', inputId: 'input-cancelled-output', requestFingerprint: 'cancelled-output', sessionId: 'cancelled-output-session' });
    await store.claimNextRunnable('worker-stale', 30_000);
    await store.cancelTask(base.ownerId, { operation_id: 'cancel-stale-output', request_fingerprint: 'cancel-stale-output', payload: { task_id: cancelled.task!.taskId } });
    await expect(store.completeAssistantOutput({ ...command, sessionId: cancelled.task!.sessionId, taskId: cancelled.task!.taskId, operationId: cancelled.task!.operationId, leaseToken: 'worker-stale', chatPreviews: [] }))
      .resolves.toEqual({ outcome: 'fence_rejected' });
  });

  it('keeps structured preview mode on the accepted and claimed task', async () => {
    const store = new MemoryChatTaskStore(new MemorySessionStore());
    const accepted = await store.submitText({
      ...base,
      operationId: '00000000-0000-4000-8000-000000000030',
      inputId: 'input-preview-mode',
      requestFingerprint: 'preview-mode',
      outputMode: 'structured_preview',
      previewKind: 'action',
    });

    expect(accepted.task).toMatchObject({
      outputMode: 'structured_preview',
      previewKind: 'action',
    });
    await expect(store.claimNextRunnable('worker-preview-mode', 30_000))
      .resolves.toMatchObject({
        outputMode: 'structured_preview',
        previewKind: 'action',
      });
  });
});
