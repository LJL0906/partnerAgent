import { describe, expect, it } from 'vitest';
import { isSessionToolView } from '@partner-agent/contracts';
import { MemoryToolOperationStore } from './memory-tool-operation.store.js';

describe('SessionToolView authoritative projection', () => {
  it('recomputes actions from authoritative status and expiry without leaking payloads', async () => {
    const store = new MemoryToolOperationStore();
    const now = new Date();
    await store.saveConfirmation({
      id: '00000000-0000-4000-8000-000000000201',
      ownerId: 'owner',
      sessionId: 'session',
      taskId: '00000000-0000-4000-8000-000000000202',
      operationId: '00000000-0000-4000-8000-000000000203',
      toolCallId: 'call-1',
      toolName: 'send_message',
      riskLevel: 'high',
      status: 'pending',
      arguments: { api_key: 'must-not-leak' },
      requestSummary: '发送安全摘要',
      result: { content: [{ type: 'text', text: 'secret result' }] },
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });

    const pending = (await store.listSessionToolViews('owner', 'session'))[0];
    expect(pending).toMatchObject({
      status: 'pending',
      version: 1,
      allowed_actions: ['confirm', 'dismiss'],
    });
    expect(isSessionToolView(pending)).toBe(true);
    expect(JSON.stringify(pending)).not.toContain('must-not-leak');
    expect(JSON.stringify(pending)).not.toContain('secret result');
    await expect(
      store.listSessionToolViews('other', 'session'),
    ).resolves.toEqual([]);

    await store.claimConfirmation('00000000-0000-4000-8000-000000000201');
    const executing = (await store.listSessionToolViews('owner', 'session'))[0];
    expect(executing).toMatchObject({
      status: 'executing',
      version: 2,
      allowed_actions: [],
    });
  });

  it('only grants undo from a current applied receipt and advances public versions', async () => {
    const store = new MemoryToolOperationStore();
    const now = new Date();
    const confirmationId = '00000000-0000-4000-8000-000000000211';
    await store.saveConfirmation({
      id: confirmationId,
      ownerId: 'owner',
      sessionId: 'session',
      toolCallId: 'call-2',
      toolName: 'write',
      riskLevel: 'medium',
      status: 'succeeded',
      arguments: {},
      requestSummary: '写入',
      resultSummary: '已写入',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await store.saveReceipt({
      id: '00000000-0000-4000-8000-000000000212',
      confirmationId,
      ownerId: 'owner',
      sessionId: 'session',
      toolName: 'write',
      undoPayload: { secret: true },
      status: 'applied',
      appliedAt: now,
      undoExpiresAt: new Date(now.getTime() + 60_000),
    });

    expect(
      (await store.listSessionToolViews('owner', 'session'))[0],
    ).toMatchObject({
      execution_id: '00000000-0000-4000-8000-000000000212',
      allowed_actions: ['undo'],
      version: 1,
    });
    await store.claimReceiptForUndo('00000000-0000-4000-8000-000000000212');
    expect(
      (await store.listSessionToolViews('owner', 'session'))[0],
    ).toMatchObject({
      allowed_actions: [],
      version: 2,
    });
  });
});
