import { describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';
import {
  OutboxRemediationError,
  OutboxRemediationService,
  buildOutboxRemediationPhrase,
  type RemediateOutboxInput,
} from './outbox-remediation.service.js';

const eventId = '10000000-0000-4000-8000-000000000001';

function input(): RemediateOutboxInput {
  const value: RemediateOutboxInput = {
    kind: 'chat_task',
    eventId,
    action: 'retry',
    expectedAttempts: 8,
    operatorLabel: 'local-admin',
    confirmationPhrase: '',
  };
  value.confirmationPhrase = buildOutboxRemediationPhrase(value);
  return value;
}

describe('OutboxRemediationService', () => {
  it('requires an exact confirmation phrase', async () => {
    const service = new OutboxRemediationService({} as DataSource);
    await expect(
      service.remediate({ ...input(), confirmationPhrase: 'wrong' }),
    ).rejects.toBeInstanceOf(OutboxRemediationError);
  });

  it('audits and resets an exhausted event transactionally', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        { event_id: eventId, attempt_count: 8, last_error_code: 'failed' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[{ event_id: eventId }], 1]);
    const dataSource = {
      transaction: (run: (manager: EntityManager) => Promise<unknown>) =>
        run({ query } as unknown as EntityManager),
    } as DataSource;
    const service = new OutboxRemediationService(dataSource);

    await expect(service.remediate(input())).resolves.toMatchObject({
      auditId: expect.any(String),
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(String(query.mock.calls[1]?.[0])).toContain(
      'outbox_remediation_audits',
    );
    expect(String(query.mock.calls[2]?.[0])).toContain('attempt_count = 0');
  });
});
