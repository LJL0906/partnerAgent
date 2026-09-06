import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { WsAuthGuard } from './ws-auth.guard.js';
import { DatabaseModule } from '../database/database.module.js';
import { SessionStore } from '../database/session-store.js';
import { TypeOrmSessionStore } from '../database/typeorm-session.store.js';
import { AccountStore } from './account-store.js';
import { AccountService } from './account-service.js';
import { AccountController } from './account-controller.js';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AccountController],
  providers: [
    AuthService,
    WsAuthGuard,
    AccountService,
    {
      provide: AccountStore,
      inject: [SessionStore],
      useFactory: (sessions: SessionStore) =>
        new AccountStore(
          sessions instanceof TypeOrmSessionStore
            ? sessions.getDataSource()
            : undefined,
        ),
    },
  ],
  exports: [AuthService, WsAuthGuard],
})
export class AuthModule {}
