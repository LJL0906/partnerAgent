import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE_ENTITIES } from '../src/database/database-definition.js';
import { LocalCoreOperationEntity } from '../src/database/entities/chat-task.entity.js';
import { SessionMessageEntity } from '../src/database/entities/session-message.entity.js';
import { TypeOrmSessionStore } from '../src/database/typeorm-session.store.js';
import { TypeOrmChatTaskStore } from '../src/local-core-api/typeorm-chat-task.store.js';

const databaseUrl = process.env.REAL_POSTGRES_DATABASE_URL;
const describeReal = databaseUrl ? describe : describe.skip;

describeReal('PostgreSQL idempotent command transaction', () => {
  let source: DataSource;

  beforeAll(async () => {
    source = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      entities: [...DATABASE_ENTITIES],
      synchronize: true,
      dropSchema: true,
    });
    await source.initialize();
  });

  afterAll(async () => {
    await source?.destroy();
  });

  it('rolls back the session mutation with the missing ledger and retries once', async () => {
    const sessions = new TypeOrmSessionStore(new ConfigService(), source);
    const tasks = new TypeOrmChatTaskStore(source);
    const sessionId = 'a1000000-0000-4000-8000-000000000001';
    const operationId = 'a1000000-0000-4000-8000-000000000002';
    await sessions.createIfAllowed(sessionId, 'a10-owner', 100);
    const command = {
      ownerId: 'a10-owner',
      operationId,
      requestFingerprint: 'a10-set-model-fingerprint',
      commandName: 'SetMessageModelSelection',
    };
    let executions = 0;
    const mutate = async (manager?: EntityManager) => {
      executions += 1;
      return sessions.appendSystemTip(
        sessionId,
        'a10-owner',
        '模型切换成 test',
        {
          model_config_id: 'test:model',
          previous_model_config_id: 'test:previous',
        },
        manager,
      );
    };

    await expect(
      tasks.executeIdempotentCommand(command, async (manager) => {
        await mutate(manager);
        throw new Error('injected after session mutation');
      }),
    ).rejects.toThrow('injected after session mutation');
    await expect(
      source.getRepository(SessionMessageEntity).count({
        where: { ownerId: 'a10-owner', sessionId, role: 'system' },
      }),
    ).resolves.toBe(0);
    await expect(
      source.getRepository(LocalCoreOperationEntity).count({
        where: { ownerId: 'a10-owner', operationId },
      }),
    ).resolves.toBe(0);

    const first = await tasks.executeIdempotentCommand(command, async (manager) => {
      const message = await mutate(manager);
      return { message_id: message.id };
    });
    const replay = await tasks.executeIdempotentCommand(command, async () => {
      throw new Error('replay must not execute');
    });

    expect(replay).toEqual(first);
    expect(executions).toBe(2);
    await expect(
      source.getRepository(SessionMessageEntity).count({
        where: { ownerId: 'a10-owner', sessionId, role: 'system' },
      }),
    ).resolves.toBe(1);
    await expect(
      source.getRepository(LocalCoreOperationEntity).count({
        where: { ownerId: 'a10-owner', operationId },
      }),
    ).resolves.toBe(1);
  });
});
