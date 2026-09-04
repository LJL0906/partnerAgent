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
import { AgentModule } from '../agent/agent.module.js';
import { ChatTaskEventBus } from './chat-task-event.bus.js';
import { ChatTaskOwnershipService } from './chat-task-ownership.service.js';
import {
  ChatTaskScheduler,
  PiChatTaskScheduler,
} from './chat-task-scheduler.js';
import { PrivacyDecisionService } from './privacy-decision.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, AgentModule],
  controllers: [LocalCoreCommandController, LocalCoreQueryController],
  providers: [
    CommandStatusInterceptor,
    ConfirmationTransactionService,
    HttpAuthGuard,
    LocalCoreApplicationService,
    ChatTaskEventBus,
    ChatTaskOwnershipService,
    PrivacyDecisionService,
    PiChatTaskScheduler,
    { provide: ChatTaskScheduler, useExisting: PiChatTaskScheduler },
    {
      provide: LocalCoreApplicationPort,
      useExisting: LocalCoreApplicationService,
    },
  ],
  exports: [
    LocalCoreApplicationPort,
    ChatTaskEventBus,
    ChatTaskOwnershipService,
    ChatTaskScheduler,
  ],
})
export class LocalCoreApiModule {}
