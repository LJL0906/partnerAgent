import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemorySessionStore } from './memory-session.store.js';
import { SessionStore } from './session-store.js';
import { TypeOrmSessionStore } from './typeorm-session.store.js';
import { ToolOperationStore } from '../tools/tool-operation.store.js';
import { MemoryToolOperationStore } from '../tools/memory-tool-operation.store.js';
import { TypeOrmToolOperationStore } from '../tools/typeorm-tool-operation.store.js';

@Module({
  providers: [
    {
      provide: SessionStore,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): SessionStore => {
        const driver = configService.get<string>('SESSION_STORE') ?? 'postgres';
        if (driver === 'memory') return new MemorySessionStore();
        if (driver === 'postgres') return new TypeOrmSessionStore(configService);
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
  ],
  exports: [SessionStore, ToolOperationStore],
})
export class DatabaseModule {}
