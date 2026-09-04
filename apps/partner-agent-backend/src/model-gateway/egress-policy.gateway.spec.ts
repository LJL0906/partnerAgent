import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { EgressPolicyGateway } from './egress-policy.gateway.js';
import { MemoryEgressDecisionStore } from './memory-egress-decision.store.js';
import { MemoryEgressAuditStore } from '../database/egress-audit.store.js';

const model = { provider: 'deepseek', id: 'test' } as never;

function request(content: string, overrides: Record<string, unknown> = {}) {
  return {
    metadata: {
      ownerId: 'owner',
      sessionId: 'session',
      taskId: 'task',
      operationId: 'operation',
      source: 'test',
      provider: 'deepseek',
    },
    model,
    context: { messages: [{ role: 'user' as const, content }] },
    ...overrides,
  };
}

function gateway(
  config: Record<string, unknown> = {},
  decisions = new MemoryEgressDecisionStore(),
) {
  const audit = new MemoryEgressAuditStore();
  return {
    decisions,
    audit,
    policy: new EgressPolicyGateway(
      new ConfigService(config),
      audit,
      decisions,
    ),
  };
}

describe('EgressPolicyGateway', () => {
  it('allows clean payloads and records metadata-only audit', async () => {
    const { policy, audit } = gateway();
    const result = await policy.evaluate(request('普通问题'));
    expect(result.decision).toBe('allowed');
    expect(result.request?.context.messages[0]).toMatchObject({
      content: '普通问题',
    });
    expect(JSON.stringify(audit.records)).not.toContain('普通问题');
  });

  it('creates a durable pending decision before returning ask metadata', async () => {
    const { policy, decisions } = gateway({ EGRESS_SENSITIVE_ACTION: 'ask' });
    const result = await policy.evaluate(request('password=hunter2'));
    const stored = await decisions.findCurrentForTask('task', 'owner');

    expect(result).toMatchObject({
      decision: 'pending_user_decision',
      egressId: stored?.id,
      categories: ['password'],
    });
    expect(result.expiresAt).toEqual(stored?.expiresAt);
    expect((await policy.evaluate(request('password=hunter2'))).egressId).toBe(
      result.egressId,
    );
  });

  it('fails closed when pending persistence fails', async () => {
    const decisions = new MemoryEgressDecisionStore();
    decisions.createOrGetPending = async () => {
      throw new Error('database unavailable');
    };
    const { policy } = gateway({ EGRESS_SENSITIVE_ACTION: 'ask' }, decisions);
    expect(await policy.evaluate(request('password=hunter2'))).toMatchObject({
      decision: 'blocked',
    });
  });

  it('expires a pending wait before any request can reach the provider', async () => {
    let now = new Date('2026-09-04T00:00:00.000Z');
    const decisions = new MemoryEgressDecisionStore(() => now);
    const { policy } = gateway(
      { EGRESS_SENSITIVE_ACTION: 'ask', PRIVACY_DECISION_TTL_MS: 1_000 },
      decisions,
    );
    const first = await policy.evaluate(request('password=hunter2'));
    now = new Date('2026-09-04T00:00:01.001Z');

    const result = await policy.evaluate(request('password=hunter2'));
    expect(result.decision).toBe('blocked');
    expect(result.request).toBeUndefined();
    expect(
      (await decisions.findByIdForOwner(first.egressId!, 'owner'))?.state,
    ).toBe('expired');
  });

  it('uses a stable SHA-256 fingerprint independent of object key order', () => {
    const { policy } = gateway();
    const first = request('普通问题', {
      options: { metadata: { z: 1, a: 2 }, temperature: 0.2 },
    });
    const second = request('普通问题', {
      options: { temperature: 0.2, metadata: { a: 2, z: 1 } },
    });
    expect(policy.computeRequestFingerprint(first)).toBe(
      policy.computeRequestFingerprint(second),
    );
    expect(policy.computeRequestFingerprint(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    [
      'circular',
      () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        return request('普通问题', { options: { metadata: circular } });
      },
    ],
    ['oversized', () => request('x'.repeat(100), {})],
  ])('fails closed for %s fingerprint input', async (kind, makeRequest) => {
    const { policy } = gateway(
      kind === 'oversized' ? { EGRESS_FINGERPRINT_MAX_BYTES: 32 } : {},
    );
    expect(await policy.evaluate(makeRequest())).toMatchObject({
      decision: 'blocked',
    });
  });

  it('consumes allow exactly once and creates a new wait on the next attempt', async () => {
    const { policy, decisions } = gateway({ EGRESS_SENSITIVE_ACTION: 'ask' });
    const first = await policy.evaluate(request('password=hunter2'));
    await decisions.submitDecision({
      ownerId: 'owner',
      egressId: first.egressId!,
      decision: 'allow',
      commandOperationId: 'allow-operation',
      commandRequestFingerprint: 'command-fingerprint',
    });

    expect((await policy.evaluate(request('password=hunter2'))).decision).toBe(
      'allowed',
    );
    const third = await policy.evaluate(request('password=hunter2'));
    expect(third.decision).toBe('pending_user_decision');
    expect(third.egressId).not.toBe(first.egressId);
  });

  it('honors a persisted block without approving a provider request', async () => {
    const { policy, decisions } = gateway({ EGRESS_SENSITIVE_ACTION: 'ask' });
    const first = await policy.evaluate(request('password=hunter2'));
    await decisions.submitDecision({
      ownerId: 'owner',
      egressId: first.egressId!,
      decision: 'block',
      commandOperationId: 'block-operation',
      commandRequestFingerprint: 'command-fingerprint',
    });
    const result = await policy.evaluate(request('password=hunter2'));
    expect(result.decision).toBe('blocked');
    expect(result.request).toBeUndefined();
  });

  it('redacts, rescans, and never exposes the original value to the approved request', async () => {
    const { policy, decisions } = gateway({ EGRESS_SENSITIVE_ACTION: 'ask' });
    const first = await policy.evaluate(request('password=hunter2'));
    await decisions.submitDecision({
      ownerId: 'owner',
      egressId: first.egressId!,
      decision: 'redact',
      commandOperationId: 'redact-operation',
      commandRequestFingerprint: 'command-fingerprint',
    });

    const approved = await policy.evaluate(request('password=hunter2'));
    expect(approved.decision).toBe('redacted');
    expect(JSON.stringify(approved.request)).not.toContain('hunter2');
    expect(JSON.stringify(approved.request)).toContain('[REDACTED]');
  });

  it('blocks when the redacted payload does not pass the mandatory rescan', async () => {
    const { policy } = gateway();
    (
      policy as unknown as { redactValue: (value: unknown) => unknown }
    ).redactValue = (value) => value;
    expect((await policy.evaluate(request('password=hunter2'))).decision).toBe(
      'blocked',
    );
  });

  it.each([
    ['context', request('password=different')],
    [
      'model',
      request('password=hunter2', {
        model: { provider: 'deepseek', id: 'different-model' },
      }),
    ],
    [
      'provider',
      request('password=hunter2', {
        metadata: {
          ownerId: 'owner',
          sessionId: 'session',
          taskId: 'task',
          operationId: 'operation',
          source: 'test',
          provider: 'openai',
        },
        model: { provider: 'openai', id: 'test' },
      }),
    ],
  ])(
    'invalidates a ready decision when %s changes',
    async (_kind, changedRequest) => {
      const { policy, decisions } = gateway({ EGRESS_SENSITIVE_ACTION: 'ask' });
      const first = await policy.evaluate(request('password=hunter2'));
      await decisions.submitDecision({
        ownerId: 'owner',
        egressId: first.egressId!,
        decision: 'allow',
        commandOperationId: 'allow-operation',
        commandRequestFingerprint: 'command-fingerprint',
      });

      const changed = await policy.evaluate(changedRequest);
      expect(changed.decision).toBe('pending_user_decision');
      expect(
        (await decisions.findByIdForOwner(first.egressId!, 'owner'))?.state,
      ).toBe('invalidated');
    },
  );

  it('redacts identity, bank, password, api key and secret values by default', async () => {
    const { policy, audit } = gateway();
    const plaintext =
      '身份证 110101199001011234 银行卡 6222021234567890 password=hunter2 api_key=abcdefgh123456 secret=topsecret';
    const result = await policy.evaluate(request(plaintext));
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
    expect(JSON.stringify(audit.records)).not.toContain(plaintext);
  });

  it.each([
    ['block', 'blocked'],
    ['allow', 'allowed'],
  ])('maps configured %s policy to %s', async (action, expected) => {
    const { policy } = gateway({ EGRESS_SENSITIVE_ACTION: action });
    expect((await policy.evaluate(request('password=hunter2'))).decision).toBe(
      expected,
    );
  });

  it('fails closed for an invalid policy', async () => {
    const { policy } = gateway({ EGRESS_SENSITIVE_ACTION: 'broken' });
    const result = await policy.evaluate(request('password=hunter2'));
    expect(result.decision).toBe('blocked');
    expect(result.request).toBeUndefined();
  });
});
