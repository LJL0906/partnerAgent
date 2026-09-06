import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { EgressPolicyGateway } from './egress-policy.gateway.js';
import { MemoryEgressDecisionStore } from './memory-egress-decision.store.js';
import {
  EgressAuditStore,
  MemoryEgressAuditStore,
} from '../database/egress-audit.store.js';
import type { EgressAuditRecord } from './egress.types.js';

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
  audit: EgressAuditStore = new MemoryEgressAuditStore(),
) {
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

async function callProviderAfterApproval(
  policy: EgressPolicyGateway,
  input: ReturnType<typeof request>,
  provider: ReturnType<typeof vi.fn>,
) {
  const result = await policy.evaluate(input);
  if (result.request) provider(result.request);
  return result;
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

  it('ignores reconstructed message timestamps but binds approval to content and model', async () => {
    const { policy, decisions } = gateway({ EGRESS_SENSITIVE_ACTION: 'ask' });
    const firstRequest = request('password=hunter2', {
      context: {
        messages: [{ role: 'user', content: 'password=hunter2', timestamp: 1 }],
      },
    });
    const pending = await policy.evaluate(firstRequest);
    await decisions.submitDecision({
      ownerId: 'owner',
      egressId: pending.egressId!,
      decision: 'allow',
      commandOperationId: 'allow-reconstructed-request',
      commandRequestFingerprint: 'command-fingerprint',
    });

    const reconstructed = request('password=hunter2', {
      context: {
        messages: [{ role: 'user', content: 'password=hunter2', timestamp: 2 }],
      },
    });
    const approved = await policy.evaluate(reconstructed);
    expect(approved.decision).toBe('allowed');
    expect(approved.request?.context.messages[0]).not.toHaveProperty(
      'timestamp',
    );

    const changedContent = request('password=changed', {
      context: {
        messages: [{ role: 'user', content: 'password=changed', timestamp: 2 }],
      },
    });
    expect((await policy.evaluate(changedContent)).decision).toBe(
      'pending_user_decision',
    );
    expect(
      policy.computeRequestFingerprint(
        request('password=hunter2', {
          model: { provider: 'deepseek', id: 'different-model' },
        }),
      ),
    ).not.toBe(policy.computeRequestFingerprint(reconstructed));
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
    expect(JSON.stringify(approved.request)).toContain('[REDACTED:PASSWORD]');
  });

  it('blocks when the redacted payload does not pass the mandatory rescan', async () => {
    const { policy } = gateway();
    (
      policy as unknown as {
        redactor: { redact: (value: unknown) => { ok: true; value: unknown } };
      }
    ).redactor.redact = (value) => ({ ok: true, value });
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
      '身份证 110101199001011234 银行卡 4532015112830366 password=hunter2 api_key=abcdefgh123456 secret=topsecret';
    const result = await policy.evaluate(request(plaintext));
    const sent = JSON.stringify(result.request?.context);
    expect(result.decision).toBe('redacted');
    expect(result.categories).toHaveLength(5);
    expect(result.categories).toEqual(
      expect.arrayContaining([
        'identity_document',
        'bank_card',
        'password',
        'api_key',
        'secret',
      ]),
    );
    expect(sent).not.toContain('hunter2');
    expect(sent).not.toContain('abcdefgh123456');
    expect(JSON.stringify(audit.records)).not.toContain(plaintext);
  });

  it.each([
    ['ask', 'pending_user_decision'],
    ['block', 'blocked'],
    ['redact', 'redacted'],
  ])(
    'enforces %s policy for secrets embedded in a JSON string',
    async (action, expected) => {
      const { policy } = gateway({ EGRESS_SENSITIVE_ACTION: action });
      const secret = 'json-password-value';
      const result = await policy.evaluate(
        request(JSON.stringify({ password: secret })),
      );

      expect(result.decision).toBe(expected);
      expect(result.categories).toContain('password');
      if (expected === 'redacted') {
        expect(JSON.stringify(result.request?.context)).not.toContain(secret);
      } else {
        expect(result.request).toBeUndefined();
      }
    },
  );

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

  it.each(['onPayload', 'fetch'] as const)(
    'blocks the post-approval %s hook before provider access',
    async (hook) => {
      const { policy, audit } = gateway({ EGRESS_SENSITIVE_ACTION: 'allow' });
      const result = await policy.evaluate(
        request('普通问题', {
          options: {
            [hook]: vi.fn(),
          },
        }),
      );

      expect(result).toMatchObject({ decision: 'blocked' });
      expect(result.request).toBeUndefined();
      expect(audit.records).toHaveLength(1);
      expect(audit.records[0]).toMatchObject({ decision: 'blocked' });
    },
  );

  it('does not brand or expose a request until scan, redact, rescan and audit finish', async () => {
    const order: string[] = [];
    const audit = new (class extends EgressAuditStore {
      async record(): Promise<void> {
        order.push('audit:start');
        await Promise.resolve();
        order.push('audit:resolved');
      }
    })();
    const { policy } = gateway({}, new MemoryEgressDecisionStore(), audit);
    const internals = policy as unknown as {
      scanner: { scan: (value: unknown) => unknown };
      redactor: { redact: (value: unknown) => unknown };
      approve: (...args: unknown[]) => unknown;
    };
    const scan = internals.scanner.scan.bind(internals.scanner);
    const redact = internals.redactor.redact.bind(internals.redactor);
    const approve = internals.approve.bind(policy);
    vi.spyOn(internals.scanner, 'scan').mockImplementation((value) => {
      order.push('scan');
      return scan(value);
    });
    vi.spyOn(internals.redactor, 'redact').mockImplementation((value) => {
      order.push('redact');
      return redact(value);
    });
    vi.spyOn(internals, 'approve').mockImplementation((...args) => {
      order.push('approve');
      return approve(...args);
    });
    const provider = vi.fn(() => order.push('provider'));

    const result = await callProviderAfterApproval(
      policy,
      request('password=hunter2'),
      provider,
    );

    expect(result.decision).toBe('redacted');
    expect(order).toEqual([
      'scan',
      'redact',
      'scan',
      'audit:start',
      'audit:resolved',
      'approve',
      'provider',
    ]);
  });

  it('sends the immutable payload that was scanned before awaiting audit', async () => {
    let releaseAudit: (() => void) | undefined;
    const audit = new (class extends EgressAuditStore {
      async record(): Promise<void> {
        await new Promise<void>((resolve) => {
          releaseAudit = resolve;
        });
      }
    })();
    const { policy } = gateway(
      { EGRESS_SENSITIVE_ACTION: 'allow' },
      new MemoryEgressDecisionStore(),
      audit,
    );
    const input = request('普通问题', {
      context: {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: '普通问题' }],
          },
        ],
      },
    });

    const evaluation = policy.evaluate(input);
    await vi.waitFor(() => expect(releaseAudit).toBeTypeOf('function'));
    (
      input.context.messages[0]!.content as Array<{
        type: string;
        text: string;
      }>
    )[0]!.text = 'password=late-secret';
    releaseAudit!();
    const result = await evaluation;

    expect(result.decision).toBe('allowed');
    expect(JSON.stringify(result.request?.context)).toContain('普通问题');
    expect(JSON.stringify(result.request?.context)).not.toContain(
      'late-secret',
    );
  });

  it.each([
    ['configured allowed', 'allow', undefined],
    ['automatic redacted', 'redact', undefined],
    ['user allow', 'ask', 'allow'],
    ['user redact', 'ask', 'redact'],
  ] as const)(
    'fails closed with EGRESS_001 when audit fails for %s',
    async (_label, action, userDecision) => {
      let rejectAudit = false;
      const secret = 'hunter2';
      const audit = new (class extends EgressAuditStore {
        readonly records: EgressAuditRecord[] = [];
        async record(record: EgressAuditRecord): Promise<void> {
          if (rejectAudit) {
            throw new Error(
              `postgres://admin:${secret}@database/internal ${secret}`,
            );
          }
          this.records.push(structuredClone(record));
        }
      })();
      const { policy, decisions } = gateway(
        { EGRESS_SENSITIVE_ACTION: action },
        new MemoryEgressDecisionStore(),
        audit,
      );
      if (userDecision) {
        const pending = await policy.evaluate(request(`password=${secret}`));
        await decisions.submitDecision({
          ownerId: 'owner',
          egressId: pending.egressId!,
          decision: userDecision,
          commandOperationId: `${userDecision}-operation`,
          commandRequestFingerprint: 'command-fingerprint',
        });
      }
      rejectAudit = true;
      const provider = vi.fn();
      const input =
        action === 'allow'
          ? request('普通问题')
          : request(`password=${secret}`);

      const attempt = callProviderAfterApproval(policy, input, provider);
      await expect(attempt).rejects.toMatchObject({
        code: 'EGRESS_001',
        decision: 'blocked',
        message: '外发安全检查暂时不可用，本次内容未发送。',
      });
      await expect(attempt).rejects.not.toThrow(secret);
      await expect(attempt).rejects.not.toThrow('postgres://');
      expect(provider).not.toHaveBeenCalled();
    },
  );

  it('audits pending and blocked outcomes without payload content', async () => {
    const pendingGateway = gateway({ EGRESS_SENSITIVE_ACTION: 'ask' });
    const blockedGateway = gateway({ EGRESS_SENSITIVE_ACTION: 'block' });

    await pendingGateway.policy.evaluate(request('password=hunter2'));
    await blockedGateway.policy.evaluate(request('password=hunter2'));

    expect(pendingGateway.audit.records[0]).toMatchObject({
      decision: 'pending_user_decision',
      ownerId: 'owner',
      sessionId: 'session',
      operationId: 'operation',
      modelId: 'test',
    });
    expect(pendingGateway.audit.records[0]?.egressId).toBeTruthy();
    expect(blockedGateway.audit.records[0]).toMatchObject({
      decision: 'blocked',
      categories: ['password'],
    });
    expect(
      JSON.stringify([
        ...pendingGateway.audit.records,
        ...blockedGateway.audit.records,
      ]),
    ).not.toContain('hunter2');
  });

  it('reevaluates and reaudits retries and model switches', async () => {
    const { policy, audit } = gateway({ EGRESS_SENSITIVE_ACTION: 'allow' });
    const first = await policy.evaluate(request('普通问题'));
    const retry = await policy.evaluate(request('普通问题'));
    const switched = await policy.evaluate(
      request('普通问题', {
        model: { provider: 'deepseek', id: 'second-model' },
      }),
    );

    expect(audit.records).toHaveLength(3);
    expect(audit.records.map(({ modelId }) => modelId)).toEqual([
      'test',
      'test',
      'second-model',
    ]);
    expect(first.requestFingerprint).toBe(retry.requestFingerprint);
    expect(switched.requestFingerprint).not.toBe(first.requestFingerprint);
  });
});
