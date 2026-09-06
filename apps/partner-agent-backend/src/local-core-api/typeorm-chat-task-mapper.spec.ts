import { describe, expect, it } from 'vitest';
import { toStoredChatTask } from './typeorm-chat-task-mapper.js';

describe('toStoredChatTask', () => {
  it('preserves the authoritative persisted task revision', () => {
    const now = new Date('2026-09-06T00:00:00.000Z');
    const stored = toStoredChatTask(
      {
        id: 'task-1', ownerId: 'owner', sessionId: 'session-1',
        operationId: 'operation-1', inputId: 'input-1',
        modelConfigId: 'deepseek:model', reasoningLevel: 'medium',
        outputMode: 'chat', previewKind: null, originalRecordId: 'record-1',
        userMessageId: 'message-1', resultMessageId: null, state: 'running',
        revision: 7, errorCode: null, errorMessage: null, createdAt: now,
        updatedAt: now, startedAt: now, completedAt: null,
        leaseOwner: 'worker', leaseExpiresAt: new Date(now.getTime() + 30_000),
        attemptCount: 1, waitingToolConfirmationId: null,
      },
      'hello',
    );

    expect(stored.revision).toBe(7);
  });
});
