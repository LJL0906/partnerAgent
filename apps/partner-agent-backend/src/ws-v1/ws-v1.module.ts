import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AgentModule } from '../agent/agent.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { LocalCoreApiModule } from '../local-core-api/local-core-api.module.js';
import { RedactionService } from '../tools/redaction.service.js';
import {
  DefaultWsV1ChannelAuthorizer,
  WsV1ChannelAuthorizer,
} from './ws-v1-channel-authorizer.js';
import { WsV1Gateway } from './ws-v1.gateway.js';
import { WsV1Service } from './ws-v1.service.js';
import { WsV1ToolControlService } from './ws-v1-tool-control.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, AgentModule, LocalCoreApiModule],
  providers: [
    RedactionService,
    WsV1Service,
    WsV1ToolControlService,
    WsV1Gateway,
    {
      provide: WsV1ChannelAuthorizer,
      useClass: DefaultWsV1ChannelAuthorizer,
    },
  ],
  exports: [WsV1Service, WsV1ChannelAuthorizer],
})
export class WsV1Module {}
