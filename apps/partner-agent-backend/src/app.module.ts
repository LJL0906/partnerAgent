import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentModule } from './agent/agent.module.js';
import { legacyAgentWsImports } from './agent/legacy-agent-ws-imports.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { validateRuntimeConfig } from './config/runtime-config.js';
import { HealthModule } from './health/health.module.js';
import { LocalCoreApiModule } from './local-core-api/local-core-api.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { WsV1Module } from './ws-v1/ws-v1.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateRuntimeConfig,
    }),
    AuthModule,
    HealthModule,
    ObservabilityModule,
    AgentModule,
    LocalCoreApiModule,
    WsV1Module,
    ...legacyAgentWsImports(process.env),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
