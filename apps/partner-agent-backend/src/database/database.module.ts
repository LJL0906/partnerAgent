import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemorySessionStore } from './memory-session.store.js';
import { SessionStore } from './session-store.js';
import { TypeOrmSessionStore } from './typeorm-session.store.js';
import { ToolOperationStore } from '../tools/tool-operation.store.js';
import { MemoryToolOperationStore } from '../tools/memory-tool-operation.store.js';
import { TypeOrmToolOperationStore } from '../tools/typeorm-tool-operation.store.js';
import { ChatTaskStore } from '../local-core-api/chat-task.store.js';
import { MemoryChatTaskStore } from '../local-core-api/memory-chat-task.store.js';
import { TypeOrmChatTaskStore } from '../local-core-api/typeorm-chat-task.store.js';
import {
  EgressAuditStore,
  MemoryEgressAuditStore,
  TypeOrmEgressAuditStore,
} from './egress-audit.store.js';
import {
  EGRESS_DECISION_STORE,
  type EgressDecisionStore,
} from '../model-gateway/egress-decision.store.js';
import { MemoryEgressDecisionStore } from '../model-gateway/memory-egress-decision.store.js';
import { TypeOrmEgressDecisionStore } from '../model-gateway/typeorm-egress-decision.store.js';

@Module({
  providers: [
    {
      provide: SessionStore,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): SessionStore => {
        const driver = configService.get<string>('SESSION_STORE') ?? 'postgres';
        if (driver === 'memory') return new MemorySessionStore();
        if (driver === 'postgres')
          return new TypeOrmSessionStore(configService);
        throw new Error(`不支持的 SESSION_STORE: ${driver}`);
      },
    },
    {
      provide: ToolOperationStore,
      inject: [SessionStore],
      useFactory: (sessionStore: SessionStore): ToolOperationStore =>
        sessionStore instanceof TypeOrmSessionStore
          ? new TypeOrmToolOperationStore(sessionStore.getDataSource())
          : new MemoryToolOperationStore(),
    },
    {
      provide: ChatTaskStore,
      inject: [SessionStore, ConfigService],
      useFactory: (
        sessionStore: SessionStore,
        configService: ConfigService,
      ): ChatTaskStore => {
        const maxSessions = Number(
          configService.get<string>('MAX_SESSIONS_PER_USER') ?? 100,
        );
        if (!Number.isInteger(maxSessions) || maxSessions <= 0) {
          throw new Error('MAX_SESSIONS_PER_USER 必须是正整数');
        }
        return sessionStore instanceof TypeOrmSessionStore
          ? new TypeOrmChatTaskStore(sessionStore.getDataSource(), maxSessions)
          : new MemoryChatTaskStore(sessionStore, maxSessions);
      },
    },
    {
      provide: EgressAuditStore,
      inject: [SessionStore],
      useFactory: (sessionStore: SessionStore): EgressAuditStore =>
        sessionStore instanceof TypeOrmSessionStore
          ? new TypeOrmEgressAuditStore(sessionStore.getDataSource())
          : new MemoryEgressAuditStore(),
    },
    {
      provide: EGRESS_DECISION_STORE,
      inject: [SessionStore],
      useFactory: (sessionStore: SessionStore): EgressDecisionStore =>
        sessionStore instanceof TypeOrmSessionStore
          ? new TypeOrmEgressDecisionStore(sessionStore.getDataSource())
          : new MemoryEgressDecisionStore(),
    },
  ],
  exports: [
    SessionStore,
    ToolOperationStore,
    ChatTaskStore,
    EgressAuditStore,
    EGRESS_DECISION_STORE,
  ],
})
export class DatabaseModule {}
