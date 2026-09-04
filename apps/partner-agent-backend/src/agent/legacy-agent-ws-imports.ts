import type { Type } from '@nestjs/common';
import { LegacyAgentWsModule } from './legacy-agent-ws.module.js';

export function legacyAgentWsImports(environment: NodeJS.ProcessEnv): Type[] {
  return environment.ENABLE_LEGACY_AGENT_WS === 'true'
    ? [LegacyAgentWsModule]
    : [];
}
