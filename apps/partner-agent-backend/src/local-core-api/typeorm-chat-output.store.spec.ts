import { DataType, newDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';
import { ChatSessionEntity } from '../database/entities/chat-session.entity.js';
import {
  ChatTaskEntity,
  LocalCoreOperationEntity,
  OriginalRecordEntity,
} from '../database/entities/chat-task.entity.js';
import { ChatTaskLifecycleOutboxEntity } from '../database/entities/chat-task-outbox.entity.js';
import { SessionMessageEntity } from '../database/entities/session-message.entity.js';
import { UserEntity } from '../database/entities/core/user.entity.js';
import { TypeOrmChatTaskStore } from './typeorm-chat-task.store.js';

function dataSource() {
  const database = newDb();
  database.public.registerFunction({
    name: 'version',
    returns: DataType.text,
    implementation: () => 'PostgreSQL 16.0',
  });
  database.public.registerFunction({
    name: 'current_database',
    returns: DataType.text,
    implementation: () => 'partner_agent_test',
  });
  database.public.registerFunction({
    name: 'quote_ident',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value) => `"${value}"`,
  });
  database.public.registerFunction({
    name: 'obj_description',
    args: [DataType.regclass, DataType.text],
    returns: DataType.text,
    implementation: () => null,
  });
  database.public.registerFunction({
    name: 'hashtext',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: () => 1,
  });
  database.public.registerFunction({
    name: 'pg_advisory_xact_lock',
    args: [DataType.integer],
    returns: DataType.integer,
    implementation: () => 1,
  });
  return database.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: [
      UserEntity,
      ChatSessionEntity,
      SessionMessageEntity,
      OriginalRecordEntity,
      LocalCoreOperationEntity,
      ChatTaskEntity,
      ChatTaskLifecycleOutboxEntity,
    ],
    synchronize: true,
  });
}

describe('TypeOrmChatTaskStore assistant output transaction', () => {
  it('restores one stable progressive message and commits preview/task/outbox together', async () => {
    const source = dataSource();
    await source.initialize();
    const store = new TypeOrmChatTaskStore(source);
    const accepted = await store.submitText({
      ownerId: 'owner',
      operationId: '00000000-0000-4000-8000-000000000101',
      requestFingerprint: 'fingerprint',
      clientSource: 'web',
      text: '生成行动',
      inputId: 'input',
      modelConfigId: 'test:model',
      reasoningLevel: 'low',
      outputMode: 'structured_preview',
      previewKind: 'action',
    });
    const task = accepted.task!;
    expect(await store.getTask(task.ownerId, task.taskId)).toMatchObject({
      outputMode: 'structured_preview',
      previewKind: 'action',
    });
    await source
      .getRepository(ChatTaskEntity)
      .update(
        { id: task.taskId },
        {
          state: 'running',
          leaseOwner: 'worker',
          leaseExpiresAt: new Date(Date.now() + 30_000),
        },
      );
    const identity = {
      ownerId: task.ownerId,
      sessionId: task.sessionId,
      taskId: task.taskId,
      operationId: task.operationId,
      leaseToken: 'worker',
    };
    const progress = await store.appendAssistantProgress({
      ...identity,
      expectedRevision: 0,
      textOffset: 0,
      delta: '正在整理',
    });
    expect(progress).toMatchObject({
      outcome: 'committed',
      message: { revision: 1, content: '正在整理' },
    });
    const messageId =
      progress.outcome === 'committed' ? progress.message.id : '';
    const preview = {
      schema_version: 1 as const,
      preview_id: 'preview-pg',
      kind: 'action' as const,
      confirmation_status: 'unconfirmed' as const,
      applied: false as const,
      source_refs: [{ kind: 'chat_message' as const, id: task.userMessageId }],
      content: { title: '整理资料', confidence: 0.8 },
      warnings: [],
    };
    const completed = await store.completeAssistantOutput({
      ...identity,
      expectedRevision: 1,
      content: '正在整理',
      chatPreviews: [preview],
      contextMessages: [
        { role: 'assistant', content: [{ type: 'text', text: '正在整理' }] },
      ],
    });
    const replayed = await store.completeAssistantOutput({
      ...identity,
      expectedRevision: 1,
      content: '正在整理',
      chatPreviews: [preview],
      contextMessages: [],
    });

    expect(completed).toMatchObject({
      outcome: 'committed',
      task: { state: 'completed' },
      message: { id: messageId, revision: 2 },
    });
    expect(replayed).toMatchObject({
      outcome: 'already_completed',
      message: { id: messageId },
    });
    expect(
      (await store.listSessionMessages(task.ownerId, task.sessionId)).filter(
        (message) => message.role === 'assistant',
      ),
    ).toEqual([
      expect.objectContaining({
        id: messageId,
        status: 'complete',
        revision: 2,
        task_id: task.taskId,
      }),
    ]);
    expect(
      await store.listSessionChatPreviews(task.ownerId, task.sessionId),
    ).toEqual([
      expect.objectContaining({
        message_id: messageId,
        message_revision: 2,
        preview,
      }),
    ]);
    expect(
      await source
        .getRepository(ChatTaskLifecycleOutboxEntity)
        .count({ where: { taskId: task.taskId, state: 'completed' } }),
    ).toBe(1);
    await source.destroy();
  });

  it('rolls back an invalid final preview and rejects completion after cancellation', async () => {
    const source = dataSource();
    await source.initialize();
    const store = new TypeOrmChatTaskStore(source);
    const accepted = await store.submitText({
      ownerId: 'owner',
      operationId: '00000000-0000-4000-8000-000000000102',
      requestFingerprint: 'fingerprint-2',
      clientSource: 'web',
      text: '生成行动',
      inputId: 'input-2',
      modelConfigId: 'test:model',
      reasoningLevel: 'low',
    });
    const task = accepted.task!;
    await source
      .getRepository(ChatTaskEntity)
      .update(
        { id: task.taskId },
        {
          state: 'running',
          leaseOwner: 'worker',
          leaseExpiresAt: new Date(Date.now() + 30_000),
        },
      );
    const command = {
      ownerId: task.ownerId,
      sessionId: task.sessionId,
      taskId: task.taskId,
      operationId: task.operationId,
      leaseToken: 'worker',
      expectedRevision: 0,
      content: '',
      contextMessages: [],
    };
    await expect(
      store.completeAssistantOutput({
        ...command,
        chatPreviews: [{} as never],
      }),
    ).rejects.toThrow();
    expect(
      await source
        .getRepository(SessionMessageEntity)
        .count({ where: { taskId: task.taskId, role: 'assistant' } }),
    ).toBe(0);
    expect(
      await source
        .getRepository(ChatTaskEntity)
        .findOneByOrFail({ id: task.taskId }),
    ).toMatchObject({ state: 'running' });
    await source
      .getRepository(ChatTaskEntity)
      .update(
        { id: task.taskId },
        { state: 'cancelled', leaseOwner: null, leaseExpiresAt: null },
      );
    await expect(
      store.completeAssistantOutput({ ...command, chatPreviews: [] }),
    ).resolves.toEqual({ outcome: 'fence_rejected' });
    expect(
      await source
        .getRepository(SessionMessageEntity)
        .count({ where: { taskId: task.taskId, role: 'assistant' } }),
    ).toBe(0);
    await source.destroy();
  });
});
