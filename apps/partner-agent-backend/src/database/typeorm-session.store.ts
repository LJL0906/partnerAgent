import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { SessionStore, type StoredSession } from './session-store.js';
import { ChatSessionEntity } from './entities/chat-session.entity.js';
import { SessionMessageEntity } from './entities/session-message.entity.js';
import { DATABASE_ENTITIES } from './database-definition.js';

const SEQUENCE_WATERMARK_CONTEXT_FORMAT = 'pi-agent-v2-sequence-watermark';

@Injectable()
export class TypeOrmSessionStore
  extends SessionStore
  implements OnModuleInit, OnModuleDestroy
{
  private readonly dataSource: DataSource;
  private readonly ownsDataSource: boolean;

  constructor(configService: ConfigService, dataSource?: DataSource) {
    super();
    if (dataSource) {
      this.dataSource = dataSource;
      this.ownsDataSource = false;
      return;
    }

    const url = configService.get<string>('DATABASE_URL');
    if (!url) throw new Error('DATABASE_URL 未配置');
    this.ownsDataSource = true;
    this.dataSource = new DataSource({
      type: 'postgres',
      url,
      entities: [...DATABASE_ENTITIES],
      migrations: ['dist/database/migrations/*.js'],
      synchronize: false,
      migrationsRun: false,
      extra: {
        max: Number(configService.get<string>('DATABASE_POOL_SIZE') ?? 10),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.ownsDataSource && this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }

  async find(
    sessionId: string,
    ownerId?: string,
  ): Promise<StoredSession | undefined> {
    const session = await this.dataSource
      .getRepository(ChatSessionEntity)
      .findOne({
        where: {
          id: sessionId,
          ...(ownerId === undefined ? {} : { ownerId }),
          deletedAt: IsNull(),
        },
      });
    if (!session) return undefined;
    const messages = await this.dataSource
      .getRepository(SessionMessageEntity)
      .find({
        where: { sessionId, ownerId: session.ownerId },
        order: { sequence: 'ASC' },
      });
    return this.toStoredSession(session, messages);
  }

  async createIfAllowed(
    sessionId: string,
    ownerId: string,
    maxSessionsPerUser: number,
  ): Promise<StoredSession> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('select pg_advisory_xact_lock(hashtext($1))', [
        ownerId,
      ]);
      const repository = manager.getRepository(ChatSessionEntity);
      const existing = await repository.findOne({ where: { id: sessionId } });
      if (existing) return this.toStoredSession(existing);

      const count = await repository.count({
        where: { ownerId, deletedAt: IsNull() },
      });
      if (count >= maxSessionsPerUser) {
        throw new Error(`用户会话数量已达到上限 ${maxSessionsPerUser}`);
      }

      const now = new Date();
      const created = await repository.save(
        repository.create({
          id: sessionId,
          ownerId,
          title: null,
          contextFormat: 'pi-agent-v1',
          contextJson: '[]',
          contextRevision: 0,
          createdAt: now,
          lastActiveAt: now,
          updatedAt: now,
          archivedAt: null,
          deletedAt: null,
        }),
      );
      return this.toStoredSession(created);
    });
  }

  async appendMessage(
    sessionId: string,
    ownerId: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.appendMessageWithManager(manager, sessionId, ownerId, role, content),
    );
  }

  async completeAssistantTurn(
    sessionId: string,
    ownerId: string,
    content: string | undefined,
    contextMessages: unknown[],
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.findOwnedSessionForUpdate(manager, sessionId, ownerId);
      let contextRevision = await this.findLastSequence(manager, sessionId);
      if (content) {
        contextRevision = await this.insertMessage(
          manager,
          sessionId,
          ownerId,
          'assistant',
          content,
          contextRevision + 1,
        );
      }
      await manager.getRepository(ChatSessionEntity).update(
        { id: sessionId, ownerId },
        {
          contextJson: JSON.stringify(contextMessages),
          contextFormat: SEQUENCE_WATERMARK_CONTEXT_FORMAT,
          contextRevision,
          lastActiveAt: new Date(),
          updatedAt: new Date(),
        },
      );
    });
  }

  async delete(sessionId: string, ownerId: string): Promise<void> {
    const result = await this.dataSource
      .getRepository(ChatSessionEntity)
      .delete({ id: sessionId, ownerId });
    if (!result.affected) throw new Error('会话不存在');
  }

  private async appendMessageWithManager(
    manager: EntityManager,
    sessionId: string,
    ownerId: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<void> {
    await this.findOwnedSessionForUpdate(manager, sessionId, ownerId);
    const sequence = (await this.findLastSequence(manager, sessionId)) + 1;
    await this.insertMessage(
      manager,
      sessionId,
      ownerId,
      role,
      content,
      sequence,
    );
    await manager
      .getRepository(ChatSessionEntity)
      .update(
        { id: sessionId, ownerId },
        { lastActiveAt: new Date(), updatedAt: new Date() },
      );
  }

  private async findOwnedSessionForUpdate(
    manager: EntityManager,
    sessionId: string,
    ownerId: string,
  ): Promise<ChatSessionEntity> {
    const session = await manager.getRepository(ChatSessionEntity).findOne({
      where: { id: sessionId, ownerId, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (!session) throw new Error('会话不存在');
    return session;
  }

  private async findLastSequence(
    manager: EntityManager,
    sessionId: string,
  ): Promise<number> {
    const last = await manager.getRepository(SessionMessageEntity).findOne({
      where: { sessionId },
      order: { sequence: 'DESC' },
    });
    return last?.sequence ?? 0;
  }

  private async insertMessage(
    manager: EntityManager,
    sessionId: string,
    ownerId: string,
    role: 'user' | 'assistant',
    content: string,
    sequence: number,
  ): Promise<number> {
    await manager.getRepository(SessionMessageEntity).insert({
      id: randomUUID(),
      sessionId,
      ownerId,
      sequence,
      role,
      content,
      status: 'complete',
      createdAt: new Date(),
      completedAt: new Date(),
    });
    return sequence;
  }

  private toStoredSession(
    session: ChatSessionEntity,
    messages: SessionMessageEntity[] = [],
  ): StoredSession {
    const contextRevision =
      session.contextFormat === SEQUENCE_WATERMARK_CONTEXT_FORMAT
        ? session.contextRevision
        : this.legacySnapshotWatermark(messages, session.contextRevision);
    return {
      id: session.id,
      ownerId: session.ownerId,
      messages: messages
        .filter(
          (
            message,
          ): message is SessionMessageEntity & {
            role: 'user' | 'assistant';
          } => message.role !== 'system',
        )
        .map((message) => ({
          sequence: message.sequence,
          role: message.role,
          content: message.content,
          timestamp: message.createdAt.getTime(),
        })),
      contextMessages: JSON.parse(session.contextJson) as unknown[],
      contextRevision,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
    };
  }

  /** v1 的 revision 是快照次数；换算为第 N 条 assistant 消息的序号。 */
  private legacySnapshotWatermark(
    messages: SessionMessageEntity[],
    snapshotCount: number,
  ): number {
    if (snapshotCount <= 0) return 0;
    const completedTurns = messages.filter(
      (message) => message.role === 'assistant',
    );
    return completedTurns[snapshotCount - 1]?.sequence ?? 0;
  }
}
