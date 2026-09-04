import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PiAgentService } from './pi-agent.service.js';
import { AgentGateway } from './agent.gateway.js';
import { ModelGatewayModule } from '../model-gateway/model-gateway.module.js';
import { SessionManager } from './session-manager.service.js';

@Module({
  imports: [ConfigModule, ModelGatewayModule],
  providers: [SessionManager, PiAgentService, AgentGateway],
  exports: [SessionManager, PiAgentService],
})
export class AgentModule {}
