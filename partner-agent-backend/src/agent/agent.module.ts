import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PiAgentService } from './pi-agent.service.js';
import { AgentGateway } from './agent.gateway.js';
import { ModelGatewayModule } from '../model-gateway/model-gateway.module.js';

@Module({
  imports: [ConfigModule, ModelGatewayModule],
  providers: [PiAgentService, AgentGateway],
  exports: [PiAgentService],
})
export class AgentModule {}