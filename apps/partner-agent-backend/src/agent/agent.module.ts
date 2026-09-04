import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PiAgentService } from './pi-agent.service.js';
import { AgentGateway } from './agent.gateway.js';
import { ModelGatewayModule } from '../model-gateway/model-gateway.module.js';
import { SessionManager } from './session-manager.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { ToolRegistryService } from '../tools/tool-registry.service.js';
import { RedactionService } from '../tools/redaction.service.js';
import { ToolExecutionService } from '../tools/tool-execution.service.js';
import { ExternalToolApprovalService } from '../tools/confirmation-center.service.js';

@Module({
  imports: [ConfigModule, DatabaseModule, ModelGatewayModule],
  providers: [
    SessionManager,
    ToolRegistryService,
    RedactionService,
    ToolExecutionService,
    ExternalToolApprovalService,
    PiAgentService,
    AgentGateway,
  ],
  exports: [SessionManager, PiAgentService],
})
export class AgentModule {}
