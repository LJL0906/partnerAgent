import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  isSessionMessageDto,
  type ChatPreviewV1,
} from '@partner-agent/contracts';
import { SignJWT } from 'jose';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { TypeOrmSessionStore } from '../src/database/typeorm-session.store.js';
import { createDatabaseDataSource } from '../src/database/database-definition.js';
import { ChatTaskEntity } from '../src/database/entities/chat-task.entity.js';
import { getChatSessionSnapshot } from '../src/local-core-api/chat-session-snapshot.js';
import { HttpAuthGuard } from '../src/local-core-api/http-auth.guard.js';
import { LocalCoreApplicationPort } from '../src/local-core-api/local-core-application.port.js';
import { LocalCoreQueryController } from '../src/local-core-api/local-core-query.controller.js';
import { TypeOrmChatTaskStore } from '../src/local-core-api/typeorm-chat-task.store.js';

const databaseUrl = process.env.REAL_POSTGRES_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;
const authSecret = 'real-postgres-data-recovery-secret';
const formalTables = [
  'confirmation_batches',
  'candidate_items',
  'confirmation_actions',
  'business_objects',
  'formal_object_details',
  'goals',
  'actions',
  'goal_action_relations',
  'object_versions',
  'source_relations',
  'object_index_jobs',
] as const;

run('real PostgreSQL data recovery', () => {
  it('keeps all formal tables unchanged and restores a traceable preview after an API restart', async () => {
    const ownerId = `preview-recovery-${randomUUID()}`;
    const source = createDatabaseDataSource(databaseUrl!);
    await source.initialize();
    const before = await formalTableSnapshot(source);
    let sessionId = '';
    let taskId = '';
    let messageId = '';
    let taskRevision = 0;
    const previewId = randomUUID();

    try {
      const store = new TypeOrmChatTaskStore(source);
      const accepted = await store.submitText({
        ownerId,
        operationId: randomUUID(),
        requestFingerprint: `preview-${randomUUID()}`,
        clientSource: 'web',
        text: '帮我安排明天下午回访客户',
        inputId: randomUUID(),
        modelConfigId: 'test:model',
        reasoningLevel: 'low',
      });
      const task = accepted.task!;
      sessionId = task.sessionId;
      taskId = task.taskId;
      await setRunningLease(source, taskId, 'preview-worker');
      const preview = validPreview(previewId, task.userMessageId);
      const completed = await store.completeAssistantOutput({
        ownerId,
        sessionId,
        taskId,
        operationId: task.operationId,
        leaseToken: 'preview-worker',
        expectedRevision: 0,
        content: '',
        chatPreviews: [preview],
        contextMessages: [],
      });
      expect(completed.outcome).toBe('committed');
      if (completed.outcome !== 'committed') return;
      messageId = completed.message.id;
      taskRevision = completed.task.revision;
      expect(completed.message).toMatchObject({
        content: '',
        revision: 1,
        status: 'complete',
      });
      expect(await formalTableSnapshot(source)).toEqual(before);
    } finally {
      await source.destroy();
    }

    let firstApi: RecoveryApi | undefined;
    let restartedApi: RecoveryApi | undefined;
    try {
      firstApi = await startRecoveryApi(databaseUrl!);
      const firstRead = await readSession(
        firstApi.app,
        await firstApi.token(ownerId),
        sessionId,
      );
      assertRecoveredPreview(firstRead, {
        taskId,
        messageId,
        previewId,
        taskRevision,
      });
      await firstApi.close();
      firstApi = undefined;

      restartedApi = await startRecoveryApi(databaseUrl!);
      const afterRestart = await readSession(
        restartedApi.app,
        await restartedApi.token(ownerId),
        sessionId,
      );
      assertRecoveredPreview(afterRestart, {
        taskId,
        messageId,
        previewId,
        taskRevision,
      });
      expect(await formalTableSnapshot(restartedApi.source)).toEqual(before);
    } finally {
      await firstApi?.close();
      if (restartedApi) {
        await cleanupOwner(restartedApi.source, ownerId);
        await restartedApi.close();
      } else {
        const cleanup = createDatabaseDataSource(databaseUrl!);
        await cleanup.initialize();
        try {
          await cleanupOwner(cleanup, ownerId);
        } finally {
          await cleanup.destroy();
        }
      }
    }
  });

  it.each([
    {
      name: 'chat mode with an applied preview',
      outputMode: 'chat' as const,
      previewKind: undefined,
      previews: (userMessageId: string): unknown[] => [
        { ...validPreview(randomUUID(), userMessageId), applied: true },
      ],
      code: 'STRUCTURED_PREVIEW_INVALID',
    },
    {
      name: 'structured preview mode without a preview',
      outputMode: 'structured_preview' as const,
      previewKind: 'action' as const,
      previews: (): unknown[] => [],
      code: 'STRUCTURED_PREVIEW_MISSING',
    },
  ])('rejects $name without changing formal tables', async (scenario) => {
    const ownerId = `invalid-preview-${randomUUID()}`;
    const source = createDatabaseDataSource(databaseUrl!);
    await source.initialize();
    const before = await formalTableSnapshot(source);
    try {
      const store = new TypeOrmChatTaskStore(source);
      const accepted = await store.submitText({
        ownerId,
        operationId: randomUUID(),
        requestFingerprint: `invalid-${randomUUID()}`,
        clientSource: 'other',
        text: '非法输出组合测试输入',
        inputId: randomUUID(),
        modelConfigId: 'test:model',
        reasoningLevel: 'low',
        outputMode: scenario.outputMode,
        ...(scenario.previewKind ? { previewKind: scenario.previewKind } : {}),
      });
      const task = accepted.task!;
      await setRunningLease(source, task.taskId, 'invalid-worker');
      await expect(
        store.completeAssistantOutput({
          ownerId,
          sessionId: task.sessionId,
          taskId: task.taskId,
          operationId: task.operationId,
          leaseToken: 'invalid-worker',
          expectedRevision: 0,
          content: '不应提交',
          chatPreviews: scenario.previews(task.userMessageId),
          contextMessages: [],
        }),
      ).resolves.toMatchObject({
        outcome: 'invalid_output',
        code: scenario.code,
      });
      expect(await formalTableSnapshot(source)).toEqual(before);
    } finally {
      await cleanupOwner(source, ownerId);
      await source.destroy();
    }
  });
});

interface RecoveryApi {
  app: INestApplication;
  source: DataSource;
  token(ownerId: string): Promise<string>;
  close(): Promise<void>;
}

async function startRecoveryApi(url: string): Promise<RecoveryApi> {
  const source = createDatabaseDataSource(url);
  await source.initialize();
  const config = new ConfigService({ AUTH_JWT_SECRET: authSecret });
  const sessions = new TypeOrmSessionStore(config, source);
  const tasks = new TypeOrmChatTaskStore(source);
  const application = {
    async executeQuery(
      name: string,
      input: { userId: string; input: Record<string, unknown> },
    ) {
      if (name !== 'GetChatSession')
        throw new Error(`unexpected query: ${name}`);
      return getChatSessionSnapshot(input, { sessions, tasks });
    },
  };
  const fixture = await Test.createTestingModule({
    controllers: [LocalCoreQueryController],
    providers: [
      HttpAuthGuard,
      { provide: AuthService, useValue: new AuthService(config) },
      { provide: LocalCoreApplicationPort, useValue: application },
    ],
  }).compile();
  const app = fixture.createNestApplication();
  await app.init();
  return {
    app,
    source,
    token: (ownerId) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(ownerId)
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode(authSecret)),
    async close() {
      await app.close();
      if (source.isInitialized) await source.destroy();
    },
  };
}

async function readSession(
  app: INestApplication,
  token: string,
  sessionId: string,
) {
  const response = await request(app.getHttpServer())
    .get(`/api/v1/chat-sessions/${sessionId}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return response.body as Record<string, unknown>;
}

function assertRecoveredPreview(
  detail: Record<string, unknown>,
  expected: {
    taskId: string;
    messageId: string;
    previewId: string;
    taskRevision: number;
  },
) {
  const messages = detail.messages as unknown[];
  expect(messages.every(isSessionMessageDto)).toBe(true);
  expect(messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: expected.messageId,
        task_id: expected.taskId,
        status: 'complete',
        revision: 1,
      }),
    ]),
  );
  expect(detail.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'runtime',
        task_id: expected.taskId,
        status: 'completed',
        revision: expected.taskRevision,
      }),
      expect.objectContaining({
        type: 'structured_preview',
        task_id: expected.taskId,
        message_id: expected.messageId,
        preview_id: expected.previewId,
        revision: 1,
        payload: expect.objectContaining({
          confirmation_status: 'unconfirmed',
          applied: false,
        }),
      }),
    ]),
  );
}

function validPreview(previewId: string, userMessageId: string): ChatPreviewV1 {
  return {
    schema_version: 1,
    preview_id: previewId,
    kind: 'action',
    confirmation_status: 'unconfirmed',
    applied: false,
    source_refs: [{ kind: 'chat_message', id: userMessageId }],
    content: { title: '未确认行动预览', confidence: 1 },
    warnings: [],
  };
}

async function setRunningLease(
  source: DataSource,
  taskId: string,
  leaseOwner: string,
) {
  await source
    .getRepository(ChatTaskEntity)
    .update(
      { id: taskId },
      {
        state: 'running',
        leaseOwner,
        leaseExpiresAt: new Date(Date.now() + 30_000),
      },
    );
}

async function formalTableSnapshot(source: DataSource) {
  return Object.fromEntries(
    await Promise.all(
      formalTables.map(async (table) => {
        const rows = (await source.query(
          `select to_jsonb(row_data)::text as value from ${table} row_data order by to_jsonb(row_data)::text`,
        )) as { value: string }[];
        return [
          table,
          {
            count: rows.length,
            digest: createHash('sha256')
              .update(rows.map((row) => row.value).join('\n'))
              .digest('hex'),
          },
        ];
      }),
    ),
  );
}

async function cleanupOwner(source: DataSource, ownerId: string) {
  const statements = [
    'delete from chat_task_lifecycle_outbox where owner_id = $1',
    'delete from chat_tasks where owner_id = $1',
    'delete from session_messages where owner_id = $1',
    'delete from original_records where owner_id = $1',
    'delete from local_core_operations where owner_id = $1',
    'delete from chat_sessions where owner_id = $1',
    'delete from users where id = $1',
  ];
  for (const statement of statements) await source.query(statement, [ownerId]);
}
