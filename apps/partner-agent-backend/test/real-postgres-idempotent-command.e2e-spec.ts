import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseDataSource } from '../src/database/database-definition.js';
import { LocalCoreOperationEntity } from '../src/database/entities/chat-task.entity.js';
import { SessionMessageEntity } from '../src/database/entities/session-message.entity.js';
import { TypeOrmSessionStore } from '../src/database/typeorm-session.store.js';
import { TypeOrmChatTaskStore } from '../src/local-core-api/typeorm-chat-task.store.js';
import { assertDedicatedRealPostgresTestDatabase } from './real-postgres-test-database.guard.js';

const databaseUrl = process.env.REAL_POSTGRES_DATABASE_URL;
const confirmedDatabaseUrl = databaseUrl
  ? assertDedicatedRealPostgresTestDatabase(
      databaseUrl,
      process.env.REAL_POSTGRES_TEST_CONFIRM,
    )
  : undefined;
const describeReal = confirmedDatabaseUrl ? describe : describe.skip;

describeReal('PostgreSQL idempotent command transaction', () => {
  let source: DataSource;
  const ownerId = `a10-owner-${randomUUID()}`;
  const sessionId = randomUUID();
  const operationId = randomUUID();

  beforeAll(async () => {
    source = createDatabaseDataSource(confirmedDatabaseUrl!);
    await source.initialize();
    await source.runMigrations();
  });

  afterAll(async () => {
    if (!source?.isInitialized) return;
    for (const table of [
      'local_core_operations',
      'session_messages',
      'chat_sessions',
    ]) {
      await source.query(`delete from ${table} where owner_id=$1`, [ownerId]);
    }
    await source.query('delete from users where id=$1', [ownerId]);
    await source.destroy();
  });

  it('rolls back the session mutation with the missing ledger and retries once', async () => {
    const sessions = new TypeOrmSessionStore(new ConfigService(), source);
    const tasks = new TypeOrmChatTaskStore(source);
    await sessions.createIfAllowed(sessionId, ownerId, 100);
    const command = {
      ownerId,
      operationId,
      requestFingerprint: 'a10-set-model-fingerprint',
      commandName: 'SetMessageModelSelection',
    };
    let executions = 0;
    const mutate = async (manager?: EntityManager) => {
      executions += 1;
      return sessions.appendSystemTip(
        sessionId,
        ownerId,
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
        where: { ownerId, sessionId, role: 'system' },
      }),
    ).resolves.toBe(0);
    await expect(
      source.getRepository(LocalCoreOperationEntity).count({
        where: { ownerId, operationId },
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
        where: { ownerId, sessionId, role: 'system' },
      }),
    ).resolves.toBe(1);
    await expect(
      source.getRepository(LocalCoreOperationEntity).count({
        where: { ownerId, operationId },
      }),
    ).resolves.toBe(1);
  });
});
