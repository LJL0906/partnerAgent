import type { CommandResult } from '@partner-agent/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../api/api-error';
import {
  createPrivacyDecisionStore,
  type SubmitPrivacyDecisionInput,
} from './privacy-decision-store';

vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => 'generated-operation'),
}));
vi.mock('../../api/config', () => ({
  apiConfig: {
    serverUrl: 'http://example.test',
    submitPrivacyDecisionPath: '/api/v1/privacy-decisions/submit',
  },
}));

const ACCEPTED: CommandResult = { operation_id: 'operation-1', status: 'accepted' };

describe('privacy decision submission', () => {
  it.each<SubmitPrivacyDecisionInput['decision']>(['allow', 'redact', 'block'])(
    'submits %s and reconciles authoritative REST state',
    async (decision) => {
      const submitDecision = vi.fn(async () => ACCEPTED);
      const reconcile = vi.fn(async () => undefined);
      const store = createPrivacyDecisionStore({
        submitDecision,
        createOperationId: () => 'operation-1',
      });

      await expect(
        store.getState().submit({ egressId: 'egress-1', decision, reconcile }),
      ).resolves.toBe(true);

      expect(submitDecision).toHaveBeenCalledWith({
        egressId: 'egress-1',
        decision,
        operationId: 'operation-1',
        signal: undefined,
      });
      expect(reconcile).toHaveBeenCalledOnce();
      expect(store.getState()).toMatchObject({
        phase: 'submitted',
        canRefresh: false,
      });
    },
  );

  it('locks a duplicate click while the first submission is pending', async () => {
    let finishRequest: ((result: CommandResult) => void) | undefined;
    const submitDecision = vi.fn(
      () => new Promise<CommandResult>((resolve) => (finishRequest = resolve)),
    );
    const reconcile = vi.fn(async () => undefined);
    const store = createPrivacyDecisionStore({
      submitDecision,
      createOperationId: () => 'operation-1',
    });
    const input: SubmitPrivacyDecisionInput = {
      egressId: 'egress-1',
      decision: 'redact',
      reconcile,
    };

    const first = store.getState().submit(input);
    await expect(store.getState().submit(input)).resolves.toBe(false);
    expect(submitDecision).toHaveBeenCalledOnce();

    finishRequest?.(ACCEPTED);
    await expect(first).resolves.toBe(true);
  });

  it('does not restore stale submission state after reset', async () => {
    let finishRequest: ((result: CommandResult) => void) | undefined;
    const store = createPrivacyDecisionStore({
      submitDecision: vi.fn(
        () => new Promise<CommandResult>((resolve) => (finishRequest = resolve)),
      ),
    });
    const pending = store.getState().submit({
      egressId: 'egress-1',
      decision: 'block',
      reconcile: vi.fn(),
    });

    store.getState().reset();
    finishRequest?.(ACCEPTED);

    await expect(pending).resolves.toBe(false);
    expect(store.getState()).toMatchObject({ phase: 'idle', canRefresh: false });
  });

  it('rejects an already expired decision before making a request', async () => {
    const submitDecision = vi.fn(async () => ACCEPTED);
    const store = createPrivacyDecisionStore({
      submitDecision,
      now: () => Date.parse('2026-09-04T10:00:00.000Z'),
    });

    await expect(
      store.getState().submit({
        egressId: 'egress-expired',
        decision: 'allow',
        expiresAt: '2026-09-04T09:59:59.000Z',
        reconcile: vi.fn(),
      }),
    ).resolves.toBe(false);

    expect(submitDecision).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({
      phase: 'expired',
      canRefresh: true,
    });
  });

  it('maps server expiry and conflict responses to refreshable safe states', async () => {
    const expired = createPrivacyDecisionStore({
      submitDecision: vi.fn(async () => {
        throw new ApiClientError('server detail', 403, {
          code: 'EGRESS_001',
          message: 'server detail',
        });
      }),
    });
    const conflict = createPrivacyDecisionStore({
      submitDecision: vi.fn(async () => {
        throw new ApiClientError('server detail', 409, {
          code: 'IDEMPOTENCY_001',
          message: 'server detail',
        });
      }),
    });
    const input: SubmitPrivacyDecisionInput = {
      egressId: 'egress-1',
      decision: 'block',
      reconcile: vi.fn(),
    };

    await expired.getState().submit(input);
    await conflict.getState().submit(input);

    expect(expired.getState()).toMatchObject({ phase: 'expired', canRefresh: true });
    expect(conflict.getState()).toMatchObject({ phase: 'conflict', canRefresh: true });
  });

  it('does not leak a token or raw sensitive value through error state', async () => {
    const store = createPrivacyDecisionStore({
      submitDecision: vi.fn(async () => {
        throw new ApiClientError(
          'Bearer secret-token identity=110101199001011234',
          500,
          { code: 'INTERNAL_000', message: 'api_key=raw-secret' },
        );
      }),
    });

    await store.getState().submit({
      egressId: 'egress-1',
      decision: 'redact',
      reconcile: vi.fn(),
    });

    expect(store.getState()).toMatchObject({
      phase: 'error',
      errorMessage: '提交失败，请刷新状态后重试。',
    });
    const message = store.getState().errorMessage ?? '';
    expect(message).not.toMatch(/secret|110101|api_key|Bearer/i);
  });

  it('keeps the outcome unresolved when REST reconciliation fails', async () => {
    const store = createPrivacyDecisionStore({
      submitDecision: vi.fn(async () => ACCEPTED),
    });

    await expect(
      store.getState().submit({
        egressId: 'egress-1',
        decision: 'allow',
        reconcile: vi.fn(async () => {
          throw new Error('offline');
        }),
      }),
    ).resolves.toBe(false);

    expect(store.getState()).toMatchObject({
      phase: 'error',
      errorMessage: '决定已提交，但状态刷新失败，请重试刷新。',
      canRefresh: true,
    });
  });

  it('refreshes through the injected authoritative reconciliation callback', async () => {
    const reconcile = vi.fn(async () => undefined);
    const store = createPrivacyDecisionStore();
    store.setState({ phase: 'conflict', errorMessage: '冲突', canRefresh: true });

    await expect(store.getState().refresh(reconcile)).resolves.toBe(true);
    expect(reconcile).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({ phase: 'idle', canRefresh: false });
  });
});
