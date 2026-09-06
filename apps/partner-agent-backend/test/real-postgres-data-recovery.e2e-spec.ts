import { describe, expect, it } from 'vitest';
import { isSessionMessageDto } from '@partner-agent/contracts';
import { createDatabaseDataSource } from '../src/database/database-definition.js';
import { ChatTaskEntity } from '../src/database/entities/chat-task.entity.js';
import { ChatTaskLifecycleOutboxEntity } from '../src/database/entities/chat-task-outbox.entity.js';
import { SessionMessageEntity } from '../src/database/entities/session-message.entity.js';
import { TypeOrmChatTaskStore } from '../src/local-core-api/typeorm-chat-task.store.js';

const databaseUrl = process.env.REAL_POSTGRES_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;

run('real PostgreSQL data recovery', () => {
  it('commits stable progress, attachment-only completion and one terminal notification', async () => {
    const ownerId = `t03-recovery-${Date.now()}`;
    const source = createDatabaseDataSource(databaseUrl!);
    await source.initialize();
    try {
      const store = new TypeOrmChatTaskStore(source);
      const accepted = await store.submitText({
        ownerId,
        operationId: '00000000-0000-4000-8000-000000000301',
        requestFingerprint: 'real-postgres-t03',
        clientSource: 'web',
        text: '生成预览',
        inputId: 'real-postgres-t03-input',
        modelConfigId: 'test:model',
        reasoningLevel: 'low',
        outputMode: 'structured_preview',
        previewKind: 'action',
      });
      const task = accepted.task!;
      await source
        .getRepository(ChatTaskEntity)
        .update(
          { id: task.taskId },
          {
            state: 'running',
            leaseOwner: 'real-worker',
            leaseExpiresAt: new Date(Date.now() + 30_000),
          },
        );
      const progress = await store.appendAssistantProgress({
        ownerId,
        sessionId: task.sessionId,
        taskId: task.taskId,
        operationId: task.operationId,
        leaseToken: 'real-worker',
        expectedRevision: 0,
        textOffset: 0,
        delta: '🙂',
      });
      expect(progress).toMatchObject({
        outcome: 'committed',
        message: { revision: 1, content: '🙂' },
      });
      const preview = {
        schema_version: 1 as const,
        preview_id: 'real-preview',
        kind: 'action' as const,
        confirmation_status: 'unconfirmed' as const,
        applied: false as const,
        source_refs: [
          { kind: 'chat_message' as const, id: task.userMessageId },
        ],
        content: { title: '附件结果', confidence: 1 },
        warnings: [],
      };
      const completed = await store.completeAssistantOutput({
        ownerId,
        sessionId: task.sessionId,
        taskId: task.taskId,
        operationId: task.operationId,
        leaseToken: 'real-worker',
        expectedRevision: 1,
        content: '',
        chatPreviews: [preview],
        contextMessages: [],
      });
      expect(completed).toMatchObject({
        outcome: 'committed',
        message: { content: '', revision: 2 },
      });
      await source.destroy();

      const restarted = createDatabaseDataSource(databaseUrl!);
      await restarted.initialize();
      try {
        const restoredStore = new TypeOrmChatTaskStore(restarted);
        const messages = await restoredStore.listSessionMessages(
          ownerId,
          task.sessionId,
        );
        expect(messages.every(isSessionMessageDto)).toBe(true);
        expect(
          messages.filter((message) => message.role === 'assistant'),
        ).toEqual([
          expect.objectContaining({
            id: completed.outcome === 'committed' ? completed.message.id : '',
            content: '',
            status: 'complete',
            revision: 2,
            task_id: task.taskId,
          }),
        ]);
        expect(
          await restoredStore.listSessionChatPreviews(ownerId, task.sessionId),
        ).toEqual([expect.objectContaining({ message_revision: 2, preview })]);
        expect(
          await restarted.getRepository(ChatTaskLifecycleOutboxEntity).count({
            where: { ownerId, taskId: task.taskId, state: 'completed' },
          }),
        ).toBe(1);
        await restarted.getRepository(SessionMessageEntity).update(
          { id: completed.outcome === 'committed' ? completed.message.id : '' },
          {
            metadataJson: {
              chat_previews: [
                preview,
                { schema_version: 1, preview_id: 'damaged-real-preview' },
              ],
            },
          },
        );
        await expect(
          restoredStore.listSessionChatPreviews(ownerId, task.sessionId),
        ).resolves.toEqual([
          expect.objectContaining({
            message_revision: 2,
            preview,
          }),
        ]);
      } finally {
        await restarted.query(
          'delete from chat_task_lifecycle_outbox where owner_id = $1',
          [ownerId],
        );
        await restarted.query(
          'update session_messages set task_id = null where owner_id = $1',
          [ownerId],
        );
        await restarted.query('delete from chat_tasks where owner_id = $1', [
          ownerId,
        ]);
        await restarted.query(
          'delete from session_messages where owner_id = $1',
          [ownerId],
        );
        await restarted.query(
          'delete from original_records where owner_id = $1',
          [ownerId],
        );
        await restarted.query(
          'delete from local_core_operations where owner_id = $1',
          [ownerId],
        );
        await restarted.query('delete from chat_sessions where owner_id = $1', [
          ownerId,
        ]);
        await restarted.query('delete from users where id = $1', [ownerId]);
        await restarted.destroy();
      }
    } finally {
      if (source.isInitialized) await source.destroy();
    }
  });
});
