import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { CommandStatusInterceptor } from './command-status.interceptor.js';
import { ConfirmationTransactionService } from './confirmation-transaction.service.js';
import { HttpAuthGuard } from './http-auth.guard.js';
import { LocalCoreApplicationPort } from './local-core-application.port.js';
import { LocalCoreApplicationService } from './local-core-application.service.js';
import { LocalCoreCommandController } from './local-core-command.controller.js';
import { LocalCoreQueryController } from './local-core-query.controller.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [LocalCoreCommandController, LocalCoreQueryController],
  providers: [
    CommandStatusInterceptor,
    ConfirmationTransactionService,
    HttpAuthGuard,
    LocalCoreApplicationService,
    {
      provide: LocalCoreApplicationPort,
      useExisting: LocalCoreApplicationService,
    },
  ],
  exports: [LocalCoreApplicationPort],
})
export class LocalCoreApiModule {}
