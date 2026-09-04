import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AgentGateway } from './agent.gateway.js';
import { AgentModule } from './agent.module.js';

/**
 * Development-only compatibility surface for the deprecated root Socket.IO API.
 * The production application does not import this module unless it is explicitly
 * enabled before bootstrap; runtime config additionally rejects that flag in
 * production.
 */
@Module({
  imports: [AuthModule, AgentModule],
  providers: [AgentGateway],
})
export class LegacyAgentWsModule {}
