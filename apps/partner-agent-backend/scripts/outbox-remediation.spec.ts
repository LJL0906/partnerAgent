import { describe, expect, it } from 'vitest';
import { parseOutboxRemediationArgs } from './outbox-remediation.js';

describe('outbox remediation cli', () => {
  it('parses a protected remediation request', () => {
    expect(
      parseOutboxRemediationArgs([
        'remediate',
        '--kind',
        'chat_task',
        '--event-id',
        '10000000-0000-4000-8000-000000000001',
        '--action',
        'retry',
        '--expected-attempts',
        '8',
        '--operator-label',
        'local-admin',
        '--confirm',
        'exact phrase',
      ]),
    ).toMatchObject({ command: 'remediate', expectedAttempts: 8 });
  });

  it('rejects an unsupported kind', () => {
    expect(() =>
      parseOutboxRemediationArgs([
        'remediate',
        '--kind',
        'unknown',
        '--event-id',
        'id',
        '--action',
        'retry',
        '--expected-attempts',
        '8',
        '--operator-label',
        'operator',
        '--confirm',
        'phrase',
      ]),
    ).toThrow('--kind 无效');
  });
});
