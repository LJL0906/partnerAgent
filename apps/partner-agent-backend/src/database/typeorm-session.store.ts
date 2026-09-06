import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, In, IsNull, type EntityManager } from 'typeorm';
import {
  SessionStore,
  type StoredSession,
  type TaskAssistantMessageWrite,
} from './session-store.js';
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

  async list(ownerId: string): Promise<StoredSession[]> {
    const sessions = await this.dataSource
      .getRepository(ChatSessionEntity)
      .find({
        where: { ownerId, archivedAt: IsNull(), deletedAt: IsNull() },
        select: {
          id: true,
          ownerId: true,
          title: true,
          createdAt: true,
          lastActiveAt: true,
        },
        order: { lastActiveAt: 'DESC', id: 'DESC' },
      });
    if (!sessions.length) return [];
    const messages = await this.dataSource
      .getRepository(SessionMessageEntity)
      .find({
        where: {
          ownerId,
          sessionId: In(sessions.map((session) => session.id)),
        },
        order: { sequence: 'ASC' },
      });
    return sessions.map((session) =>
      this.toStoredSession(
        { ...session, contextJson: '[]', contextRevision: 0 },
        messages.filter((message) => message.sessionId === session.id),
      ),
    );
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

  async rename(
    sessionId: string,
    ownerId: string,
    title: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<StoredSession> {
    const result = await manager.getRepository(ChatSessionEntity).update(
      { id: sessionId, ownerId, deletedAt: IsNull() },
      { title, updatedAt: new Date() },
    );
    if (!result.affected) throw new Error('会话不存在');
    const session = await this.findWithManager(manager, sessionId, ownerId);
    if (!session) throw new Error('会话不存在');
    return session;
  }

  async archive(
    sessionId: string,
    ownerId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<StoredSession> {
    const result = await manager.getRepository(ChatSessionEntity).update(
      { id: sessionId, ownerId, deletedAt: IsNull() },
      { archivedAt: () => 'coalesce(archived_at, now())', lifecycleStatus: 'archived', updatedAt: new Date() },
    );
    if (!result.affected) throw new Error('会话不存在');
    const session = await this.findWithManager(manager, sessionId, ownerId);
    if (!session) throw new Error('会话不存在');
    return session;
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

  async appendSystemTip(
    sessionId: string,
    ownerId: string,
    content: string,
    metadata: { model_config_id: string; previous_model_config_id: string },
    manager?: EntityManager,
  ) {
    const append = async (transactionManager: EntityManager) => {
      await this.findOwnedSessionForUpdate(transactionManager, sessionId, ownerId);
      const sequence = (await this.findLastSequence(transactionManager, sessionId)) + 1;
      const createdAt = new Date();
      const id = randomUUID();
      await this.insertMessage(transactionManager, sessionId, ownerId, 'system', content, sequence, metadata, id, createdAt);
      await transactionManager.getRepository(ChatSessionEntity).update({ id: sessionId, ownerId }, { lastActiveAt: new Date(), updatedAt: new Date() });
      return { id, sequence, createdAt };
    };
    return manager ? append(manager) : this.dataSource.transaction(append);
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

  async saveTaskAssistantMessage(
    sessionId: string,
    ownerId: string,
    message: TaskAssistantMessageWrite,
  ) {
    return this.dataSource.transaction(async (manager) => {
      await this.findOwnedSessionForUpdate(manager, sessionId, ownerId);
      const repository = manager.getRepository(SessionMessageEntity);
      let row = await repository.findOne({
        where: { ownerId, sessionId, taskId: message.taskId, role: 'assistant' },
        lock: { mode: 'pessimistic_write' },
      });
      const createdAt = row?.createdAt ?? new Date();
      if (!row) {
        row = repository.create({
          id: message.id,
          ownerId,
          sessionId,
          sequence: (await this.findLastSequence(manager, sessionId)) + 1,
          role: 'assistant',
          createdAt,
        });
      }
      Object.assign(row, {
        content: message.content,
        status: message.status,
        revision: message.revision,
        taskId: message.taskId,
        operationId: message.operationId,
        modelConfigId: message.modelConfigId,
        reasoningLevel: message.reasoningLevel,
        metadataJson: message.metadata ?? null,
        completedAt: message.status === 'complete' ? new Date() : null,
      });
      await repository.save(row);
      await manager.getRepository(ChatSessionEntity).update(
        { id: sessionId, ownerId },
        { lastActiveAt: new Date(), updatedAt: new Date() },
      );
      return { id: row.id, sequence: row.sequence, createdAt };
    });
  }

  async saveContextSnapshot(
    sessionId: string,
    ownerId: string,
    contextMessages: unknown[],
    contextRevision: number,
  ): Promise<void> {
    const result = await this.dataSource.getRepository(ChatSessionEntity).update(
      { id: sessionId, ownerId, deletedAt: IsNull() },
      {
        contextJson: JSON.stringify(contextMessages),
        contextFormat: SEQUENCE_WATERMARK_CONTEXT_FORMAT,
        contextRevision,
        lastActiveAt: new Date(),
        updatedAt: new Date(),
      },
    );
    if (!result.affected) throw new Error('会话不存在');
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

  private async findWithManager(
    manager: EntityManager,
    sessionId: string,
    ownerId: string,
  ): Promise<StoredSession | undefined> {
    const session = await manager.getRepository(ChatSessionEntity).findOne({
      where: { id: sessionId, ownerId, deletedAt: IsNull() },
    });
    if (!session) return undefined;
    const messages = await manager.getRepository(SessionMessageEntity).find({
      where: { sessionId, ownerId },
      order: { sequence: 'ASC' },
    });
    return this.toStoredSession(session, messages);
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
    role: 'user' | 'assistant' | 'system',
    content: string,
    sequence: number,
    metadata?: Record<string, unknown>,
    messageId = randomUUID(),
    createdAt = new Date(),
  ): Promise<number> {
    await manager.getRepository(SessionMessageEntity).insert({
      id: messageId,
      sessionId,
      ownerId,
      sequence,
      role,
      content,
      status: 'complete',
      revision: 1,
      createdAt,
      completedAt: createdAt,
      metadataJson: (metadata ?? null) as any,
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
      title: session.title,
      messages: messages
        .filter(
          (
            message,
          ): message is SessionMessageEntity & {
            role: 'user' | 'assistant';
          } => message.role !== 'system',
        )
        .map((message) => ({
          id: message.id,
          sequence: message.sequence,
          role: message.role,
          content: message.content,
          timestamp: message.createdAt.getTime(),
          status: message.status,
          revision: message.revision,
          ...(message.taskId ? { taskId: message.taskId } : {}),
          ...(message.operationId ? { operationId: message.operationId } : {}),
          ...(message.modelConfigId ? { modelConfigId: message.modelConfigId } : {}),
          ...(message.reasoningLevel ? { reasoningLevel: message.reasoningLevel } : {}),
          ...(message.metadataJson ? { metadata: message.metadataJson } : {}),
        })),
      contextMessages: JSON.parse(session.contextJson) as unknown[],
      contextRevision,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      archivedAt: session.archivedAt,
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
