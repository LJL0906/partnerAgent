import { DataType, newDb } from 'pg-mem';
import { ConfigService } from '@nestjs/config';
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
import { TypeOrmSessionStore } from '../database/typeorm-session.store.js';
import { TypeOrmChatTaskStore } from './typeorm-chat-task.store.js';
import type { EntityManager } from 'typeorm';
import {
  chatItemIds,
  parseChatPreviewsV1,
  type ChatPreviewV1,
} from '@partner-agent/contracts';

function storedPreview(
  userMessageId: string,
  previewId: string,
  title = previewId,
  warningMessage = '',
): ChatPreviewV1 {
  return {
    schema_version: 1,
    preview_id: previewId,
    kind: 'action',
    confirmation_status: 'unconfirmed',
    applied: false,
    source_refs: [{ kind: 'chat_message', id: userMessageId }],
    content: { title, confidence: 0.8 },
    warnings: warningMessage
      ? [{ code: 'RECOVERY_TEST', message: warningMessage }]
      : [],
  };
}

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
  it('passes one transaction manager to a session mutation and replays once', async () => {
    const source = dataSource();
    await source.initialize();
    const sessions = new TypeOrmSessionStore(new ConfigService(), source);
    const store = new TypeOrmChatTaskStore(source);
    const sessionId = '00000000-0000-4000-8000-000000000001';
    const operationId = '00000000-0000-4000-8000-000000000002';
    await sessions.createIfAllowed(sessionId, 'owner', 100);
    const command = {
      ownerId: 'owner',
      operationId,
      requestFingerprint: 'set-model-fingerprint',
      commandName: 'SetMessageModelSelection',
    };
    let executions = 0;
    const appendTip = async (manager?: EntityManager) => {
      executions += 1;
      return sessions.appendSystemTip(sessionId, 'owner', '模型切换成 test', {
        model_config_id: 'test:model',
        previous_model_config_id: 'test:previous',
      }, manager);
    };

    const first = await store.executeIdempotentCommand(command, async (manager) => {
      expect(manager).toBeDefined();
      const message = await appendTip(manager);
      return { message_id: message.id };
    });
    const replay = await store.executeIdempotentCommand(command, async () => {
      throw new Error('replay must not execute');
    });

    expect(replay).toEqual(first);
    expect(executions).toBe(1);
    expect(
      await source.getRepository(SessionMessageEntity).count({
        where: { ownerId: 'owner', sessionId, role: 'system' },
      }),
    ).toBe(1);
    await source.destroy();
  });

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

  it('rejects chat completion with a preview without writing partial state', async () => {
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
    const preview = {
      schema_version: 1 as const,
      preview_id: 'preview-for-chat',
      kind: 'action' as const,
      confirmation_status: 'unconfirmed' as const,
      applied: false as const,
      source_refs: [{ kind: 'chat_message' as const, id: task.userMessageId }],
      content: { title: '不应写入', confidence: 0.8 },
      warnings: [],
    };
    await expect(
      store.completeAssistantOutput({ ...command, chatPreviews: [preview] }),
    ).resolves.toMatchObject({
      outcome: 'invalid_output',
      code: 'STRUCTURED_PREVIEW_INVALID',
    });
    await expect(store.completeAssistantOutput({
      ...command,
      leaseToken: 'stale-worker',
      chatPreviews: [preview],
    })).resolves.toEqual({ outcome: 'fence_rejected' });
    await expect(store.completeAssistantOutput({
      ...command,
      expectedRevision: 1,
      chatPreviews: [preview],
    })).resolves.toEqual({ outcome: 'conflict' });
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

  it('rejects structured preview completion without an attachment', async () => {
    const source = dataSource();
    await source.initialize();
    const store = new TypeOrmChatTaskStore(source);
    const accepted = await store.submitText({
      ownerId: 'owner',
      operationId: '00000000-0000-4000-8000-000000000103',
      requestFingerprint: 'fingerprint-3',
      clientSource: 'web',
      text: '生成行动',
      inputId: 'input-3',
      modelConfigId: 'test:model',
      reasoningLevel: 'low',
      outputMode: 'structured_preview',
      previewKind: 'action',
    });
    const task = accepted.task!;
    await source.getRepository(ChatTaskEntity).update(
      { id: task.taskId },
      {
        state: 'running',
        leaseOwner: 'worker',
        leaseExpiresAt: new Date(Date.now() + 30_000),
      },
    );

    await expect(store.completeAssistantOutput({
      ownerId: task.ownerId,
      sessionId: task.sessionId,
      taskId: task.taskId,
      operationId: task.operationId,
      leaseToken: 'worker',
      expectedRevision: 0,
      content: '',
      chatPreviews: [],
      contextMessages: [],
    })).resolves.toMatchObject({
      outcome: 'invalid_output',
      code: 'STRUCTURED_PREVIEW_MISSING',
    });
    await expect(store.completeAssistantOutput({
      ownerId: task.ownerId,
      sessionId: task.sessionId,
      taskId: task.taskId,
      operationId: task.operationId,
      leaseToken: 'worker',
      expectedRevision: 0,
      content: '',
      chatPreviews: [{} as never],
      contextMessages: [],
    })).resolves.toMatchObject({
      outcome: 'invalid_output',
      code: 'STRUCTURED_PREVIEW_INVALID',
    });
    await expect(source.getRepository(SessionMessageEntity).count({
      where: { taskId: task.taskId, role: 'assistant' },
    })).resolves.toBe(0);
    await expect(source.getRepository(ChatTaskEntity).findOneByOrFail({
      id: task.taskId,
    })).resolves.toMatchObject({ state: 'running' });
    await source.destroy();
  });

  it('restores a stable collection from damaged, duplicate and oversized persisted previews', async () => {
    const source = dataSource();
    await source.initialize();
    const store = new TypeOrmChatTaskStore(source);
    const accepted = await store.submitText({
      ownerId: 'owner',
      operationId: '00000000-0000-4000-8000-000000000104',
      requestFingerprint: 'fingerprint-4',
      clientSource: 'web',
      text: '生成行动',
      inputId: 'input-4',
      modelConfigId: 'test:model',
      reasoningLevel: 'low',
      outputMode: 'structured_preview',
      previewKind: 'action',
    });
    const task = accepted.task!;
    await source.getRepository(SessionMessageEntity).save({
      id: '00000000-0000-4000-8000-000000000204',
      ownerId: task.ownerId,
      sessionId: task.sessionId,
      sequence: 2,
      role: 'assistant',
      content: '',
      status: 'complete',
      revision: 1,
      taskId: task.taskId,
      operationId: task.operationId,
      modelConfigId: task.modelConfigId,
      reasoningLevel: task.reasoningLevel,
      metadataJson: { chat_previews: [] },
      createdAt: new Date(),
      completedAt: new Date(),
    });

    const cases = [
      {
        previews: [
          storedPreview(task.userMessageId, 'duplicate', '保留第一项'),
          storedPreview(task.userMessageId, 'duplicate', '忽略重复项'),
          { schema_version: 1, preview_id: 'damaged' },
          storedPreview(task.userMessageId, 'valid-sibling'),
        ],
        expectedIds: ['duplicate', 'valid-sibling'],
      },
      {
        previews: Array.from({ length: 22 }, (_, index) =>
          storedPreview(task.userMessageId, `count-${index}`)),
        expectedIds: Array.from({ length: 20 }, (_, index) => `count-${index}`),
      },
      {
        previews: [
          storedPreview(task.userMessageId, 'large-1', 'large-1', 'a'.repeat(28_000)),
          storedPreview(task.userMessageId, 'large-2', 'large-2', 'b'.repeat(28_000)),
          storedPreview(task.userMessageId, 'would-overflow', 'would-overflow', 'c'.repeat(28_000)),
          storedPreview(task.userMessageId, 'small-after-overflow'),
        ],
        expectedIds: ['large-1', 'large-2', 'small-after-overflow'],
      },
    ];

    for (const testCase of cases) {
      await source.getRepository(SessionMessageEntity).update(
        { id: '00000000-0000-4000-8000-000000000204' },
        { metadataJson: { chat_previews: testCase.previews } },
      );
      const attachments = await store.listSessionChatPreviews(
        task.ownerId,
        task.sessionId,
      );
      expect.soft(attachments.map(({ preview }) => preview.preview_id)).toEqual(
        testCase.expectedIds,
      );
      expect.soft(new Set(attachments.map(({ preview }) =>
        chatItemIds.preview(preview.preview_id))).size)
        .toBe(attachments.length);
      expect.soft(() => parseChatPreviewsV1(
        attachments.map(({ preview }) => preview),
      )).not.toThrow();
    }
    await source.destroy();
  });

  it('does not expose mutable persisted preview metadata across reads', async () => {
    const source = dataSource();
    await source.initialize();
    const store = new TypeOrmChatTaskStore(source);
    const accepted = await store.submitText({
      ownerId: 'owner',
      operationId: '00000000-0000-4000-8000-000000000105',
      requestFingerprint: 'fingerprint-5',
      clientSource: 'web',
      text: '生成行动',
      inputId: 'input-5',
      modelConfigId: 'test:model',
      reasoningLevel: 'low',
      outputMode: 'structured_preview',
      previewKind: 'action',
    });
    const task = accepted.task!;
    const preview = storedPreview(
      task.userMessageId,
      'isolated-persisted',
      '原始标题',
      '原始警告',
    );
    const expected = structuredClone(preview);
    await source.getRepository(SessionMessageEntity).save({
      id: '00000000-0000-4000-8000-000000000205',
      ownerId: task.ownerId,
      sessionId: task.sessionId,
      sequence: 2,
      role: 'assistant',
      content: '',
      status: 'complete',
      revision: 1,
      taskId: task.taskId,
      operationId: task.operationId,
      modelConfigId: task.modelConfigId,
      reasoningLevel: task.reasoningLevel,
      metadataJson: { chat_previews: [preview] },
      createdAt: new Date(),
      completedAt: new Date(),
    });

    const firstRead = await store.listSessionChatPreviews(task.ownerId, task.sessionId);
    firstRead[0]!.preview.content.title = '污染标题';
    firstRead[0]!.preview.source_refs[0]!.id = 'polluted-source';
    firstRead[0]!.preview.warnings.push({ code: 'POLLUTED', message: '污染警告' });

    const secondRead = await store.listSessionChatPreviews(task.ownerId, task.sessionId);
    expect(secondRead).toEqual([
      expect.objectContaining({ preview: expected }),
    ]);
    await source.destroy();
  });
});
