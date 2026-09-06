import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AgentModule } from './agent.module.js';

describe('AgentModule', () => {
  it('does not register a WebSocket gateway', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AgentModule);
    expect(
      providers.some((provider: { name?: string }) =>
        provider.name?.endsWith('Gateway'),
      ),
    ).toBe(false);
  });
});
