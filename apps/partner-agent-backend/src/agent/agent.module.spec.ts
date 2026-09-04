import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AgentGateway } from './agent.gateway.js';
import { AgentModule } from './agent.module.js';
import { LegacyAgentWsModule } from './legacy-agent-ws.module.js';
import { legacyAgentWsImports } from '../app.module.js';

describe('legacy Agent WebSocket module isolation', () => {
  it('does not register the legacy gateway in the normal Agent module', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AgentModule);
    expect(providers).not.toContain(AgentGateway);
  });

  it('keeps the compatibility module out of the default module graph', () => {
    expect(legacyAgentWsImports({})).toEqual([]);
    expect(
      legacyAgentWsImports({ ENABLE_LEGACY_AGENT_WS: 'false' }),
    ).toEqual([]);
  });

  it('loads the compatibility module only after explicit opt-in', () => {
    expect(
      legacyAgentWsImports({ ENABLE_LEGACY_AGENT_WS: 'true' }),
    ).toEqual([LegacyAgentWsModule]);
  });
});
