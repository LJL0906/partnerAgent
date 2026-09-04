import { describe, expect, it } from 'vitest';
import {
  buildToolReconciliationPhrase,
  ToolReconciliationError,
} from '../src/tools/tool-operation.store.js';
import { ToolReconciliationService } from '../src/tools/tool-reconciliation.service.js';
import {
  executeToolReconciliationCommand,
  formatToolReconciliationError,
  parseToolReconciliationArgs,
} from './tool-reconciliation.js';

describe('tool reconciliation CLI', () => {
  it('parses owner-scoped list commands with a bounded limit', () => {
    expect(
      parseToolReconciliationArgs([
        'list',
        '--owner-id',
        'owner-a',
        '--limit',
        '20',
      ]),
    ).toEqual({ command: 'list', ownerId: 'owner-a', limit: 20 });
    expect(() =>
      parseToolReconciliationArgs([
        'list',
        '--owner-id',
        'owner-a',
        '--limit',
        '101',
      ]),
    ).toThrow('--limit 必须在 1 到 100 之间');
  });

  it('requires every reconciliation guard and the fixed outcome enum', () => {
    const base = {
      confirmationId: '10000000-0000-4000-8000-000000000001',
      ownerId: 'owner-a',
      expectedVersion: 1,
      expectedStatus: 'indeterminate' as const,
      outcome: 'verified_applied' as const,
    };
    const parsed = parseToolReconciliationArgs([
      'reconcile',
      '--confirmation-id',
      base.confirmationId,
      '--owner-id',
      base.ownerId,
      '--expected-version',
      '1',
      '--expected-state',
      base.expectedStatus,
      '--outcome',
      base.outcome,
      '--operator-label',
      'local-operator',
      '--confirm',
      buildToolReconciliationPhrase(base),
    ]);
    expect(parsed).toMatchObject({ command: 'reconcile', ...base });
    expect(() =>
      parseToolReconciliationArgs([
        'reconcile',
        '--owner-id',
        'owner-a',
        '--outcome',
        'custom-json',
      ]),
    ).toThrow(
      '--outcome 只能是 verified_applied/verified_not_applied/abandoned',
    );
  });

  it('delegates without executing a tool and hides unexpected database errors', async () => {
    const service = {
      list: async () => [
        {
          confirmationId: 'safe-id',
          ownerId: 'owner-a',
          currentVersion: 1,
          currentStatus: 'indeterminate',
        },
      ],
    } as unknown as ToolReconciliationService;
    await expect(
      executeToolReconciliationCommand(
        { command: 'list', ownerId: 'owner-a', limit: 1 },
        service,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        confirmationId: 'safe-id',
        confirmationPhrases: {
          verified_applied: expect.stringContaining('OUTCOME verified_applied'),
          verified_not_applied: expect.stringContaining(
            'OUTCOME verified_not_applied',
          ),
          abandoned: expect.stringContaining('OUTCOME abandoned'),
        },
      }),
    ]);
    expect(
      formatToolReconciliationError(
        new Error('postgresql://user:secret@localhost/private'),
      ),
    ).toBe('工具核对失败（底层错误详情已隐藏）');
    expect(
      formatToolReconciliationError(
        new ToolReconciliationError('核对记录版本已变化'),
      ),
    ).toBe('核对记录版本已变化');
  });
});
