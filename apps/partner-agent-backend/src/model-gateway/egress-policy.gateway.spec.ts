import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { EgressPolicyGateway } from './egress-policy.gateway.js';
import { MemoryEgressAuditStore } from '../database/egress-audit.store.js';

const model = { provider: 'deepseek', id: 'test' } as never;

function request(content: string) {
  return {
    metadata: {
      ownerId: 'owner',
      sessionId: 'session',
      taskId: 'task',
      source: 'test',
      provider: 'deepseek',
    },
    model,
    context: { messages: [{ role: 'user' as const, content }] },
  };
}

describe('EgressPolicyGateway', () => {
  it('allows clean payloads and records metadata-only audit', () => {
    const sink = new MemoryEgressAuditStore();
    const result = new EgressPolicyGateway(new ConfigService(), sink).evaluate(
      request('普通问题'),
    );
    expect(result.decision).toBe('allowed');
    expect(result.request?.context.messages[0]).toMatchObject({ content: '普通问题' });
    expect(JSON.stringify(sink.records)).not.toContain('普通问题');
  });

  it('redacts identity, bank, password, api key and secret values by default', () => {
    const sink = new MemoryEgressAuditStore();
    const plaintext =
      '身份证 110101199001011234 银行卡 6222021234567890 password=hunter2 api_key=abcdefgh123456 secret=topsecret';
    const result = new EgressPolicyGateway(new ConfigService(), sink).evaluate(
      request(plaintext),
    );
    const sent = JSON.stringify(result.request?.context);
    expect(result.decision).toBe('redacted');
    expect(result.categories).toEqual([
      'identity_document',
      'bank_card',
      'password',
      'api_key',
      'secret',
    ]);
    expect(sent).not.toContain('hunter2');
    expect(sent).not.toContain('abcdefgh123456');
    expect(JSON.stringify(sink.records)).not.toContain(plaintext);
  });

  it.each([
    ['ask', 'pending_user_decision'],
    ['block', 'blocked'],
    ['allow', 'allowed'],
  ])('maps configured %s policy to %s', (action, expected) => {
    const gateway = new EgressPolicyGateway(
      new ConfigService({ EGRESS_SENSITIVE_ACTION: action }),
      new MemoryEgressAuditStore(),
    );
    expect(gateway.evaluate(request('password=hunter2')).decision).toBe(expected);
  });

  it('fails closed for an invalid policy', () => {
    const result = new EgressPolicyGateway(
      new ConfigService({ EGRESS_SENSITIVE_ACTION: 'broken' }),
      new MemoryEgressAuditStore(),
    ).evaluate(request('password=hunter2'));
    expect(result.decision).toBe('blocked');
    expect(result.request).toBeUndefined();
  });
});
