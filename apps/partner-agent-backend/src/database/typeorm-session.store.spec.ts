import { ConfigService } from '@nestjs/config';
import { DataType, newDb } from 'pg-mem';
import type { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { ChatSessionEntity } from './entities/chat-session.entity.js';
import { SessionMessageEntity } from './entities/session-message.entity.js';
import { TypeOrmSessionStore } from './typeorm-session.store.js';
import { ToolConfirmationEntity } from './entities/tool-confirmation.entity.js';
import { ToolAuditEntity } from './entities/tool-audit.entity.js';
import { ToolExecutionReceiptEntity } from './entities/tool-execution-receipt.entity.js';
import { TypeOrmToolOperationStore } from '../tools/typeorm-tool-operation.store.js';

const entities = [
  ChatSessionEntity,
  SessionMessageEntity,
  ToolConfirmationEntity,
  ToolAuditEntity,
  ToolExecutionReceiptEntity,
];

describe('TypeOrmSessionStore', () => {
  it('restores messages and Agent context through a new database connection', async () => {
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

    const dataSourceA = database.adapters.createTypeormDataSource({
      type: 'postgres',
      entities,
      synchronize: true,
    });
    await dataSourceA.initialize();
    const storeA = new TypeOrmSessionStore(new ConfigService(), dataSourceA);
    await storeA.createIfAllowed('persistent', 'user-a', 10);
    await storeA.appendMessage('persistent', 'user-a', 'user', '第一轮问题');
    await storeA.completeAssistantTurn('persistent', 'user-a', '第一轮回答', [
      { role: 'user', content: '第一轮问题' },
      { role: 'assistant', content: [{ type: 'text', text: '第一轮回答' }] },
    ]);
    // 模拟进程在保存下一条用户消息后、生成新快照前退出。
    await storeA.appendMessage(
      'persistent',
      'user-a',
      'user',
      '崩溃前已持久化的问题',
    );
    const operationStoreA = new TypeOrmToolOperationStore(dataSourceA);
    const now = new Date();
    await operationStoreA.saveConfirmation({
      id: '00000000-0000-4000-8000-000000000001',
      ownerId: 'user-a',
      sessionId: 'persistent',
      toolCallId: 'call-1',
      toolName: 'write-test',
      riskLevel: 'high',
      status: 'pending',
      arguments: { value: 1 },
      requestSummary: '{"value":1}',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await operationStoreA.saveAudit({
      id: '00000000-0000-4000-8000-000000000002',
      ownerId: 'user-a',
      sessionId: 'persistent',
      toolCallId: 'call-1',
      toolName: 'write-test',
      riskLevel: 'high',
      action: 'staged',
      requestSummary: '{"value":1}',
      createdAt: now,
    });
    await dataSourceA.destroy();

    const dataSourceB = database.adapters.createTypeormDataSource({
      type: 'postgres',
      entities,
      synchronize: false,
    }) as DataSource;
    await dataSourceB.initialize();
    const storeB = new TypeOrmSessionStore(new ConfigService(), dataSourceB);
    const restored = await storeB.find('persistent');

    expect(restored?.messages).toEqual([
      expect.objectContaining({
        sequence: 1,
        role: 'user',
        content: '第一轮问题',
      }),
      expect.objectContaining({
        sequence: 2,
        role: 'assistant',
        content: '第一轮回答',
      }),
      expect.objectContaining({
        sequence: 3,
        role: 'user',
        content: '崩溃前已持久化的问题',
      }),
    ]);
    expect(restored?.contextRevision).toBe(2);
    expect(restored?.contextMessages).toEqual([
      { role: 'user', content: '第一轮问题' },
      { role: 'assistant', content: [{ type: 'text', text: '第一轮回答' }] },
    ]);
    const operationStoreB = new TypeOrmToolOperationStore(dataSourceB);
    await expect(
      operationStoreB.findConfirmation('00000000-0000-4000-8000-000000000001'),
    ).resolves.toMatchObject({ status: 'pending', arguments: { value: 1 } });
    await expect(operationStoreB.listAudits()).resolves.toEqual([
      expect.objectContaining({ action: 'staged', toolName: 'write-test' }),
    ]);
    await dataSourceB.destroy();
  });

  it('converts a legacy snapshot counter into a message-sequence watermark', async () => {
    const database = newDb();
    database.public.registerFunction({
      name: 'current_database',
      returns: DataType.text,
      implementation: () => 'partner_agent_test',
    });
    database.public.registerFunction({
      name: 'version',
      returns: DataType.text,
      implementation: () => 'PostgreSQL 16.0',
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
    const dataSource = database.adapters.createTypeormDataSource({
      type: 'postgres',
      entities,
      synchronize: true,
    });
    await dataSource.initialize();
    const now = new Date();
    await dataSource.getRepository(ChatSessionEntity).insert({
      id: 'legacy',
      ownerId: 'user-a',
      title: null,
      contextFormat: 'pi-agent-v1',
      contextJson: JSON.stringify([{ role: 'user', content: '旧问题' }]),
      contextRevision: 1,
      createdAt: now,
      lastActiveAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
    });
    await dataSource.getRepository(SessionMessageEntity).insert([
      {
        id: '00000000-0000-4000-8000-000000000011',
        sessionId: 'legacy',
        ownerId: 'user-a',
        sequence: 1,
        role: 'user',
        content: '旧问题',
        status: 'complete',
        createdAt: now,
        completedAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000012',
        sessionId: 'legacy',
        ownerId: 'user-a',
        sequence: 2,
        role: 'assistant',
        content: '旧回答',
        status: 'complete',
        createdAt: now,
        completedAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000013',
        sessionId: 'legacy',
        ownerId: 'user-a',
        sequence: 3,
        role: 'user',
        content: '崩溃后缀',
        status: 'complete',
        createdAt: now,
        completedAt: now,
      },
    ]);

    const restored = await new TypeOrmSessionStore(
      new ConfigService(),
      dataSource,
    ).find('legacy', 'user-a');
    expect(restored?.contextRevision).toBe(2);
    expect(
      restored?.messages.filter(
        (message) => message.sequence > (restored?.contextRevision ?? 0),
      ),
    ).toEqual([expect.objectContaining({ sequence: 3, content: '崩溃后缀' })]);
    await dataSource.destroy();
  });
});
