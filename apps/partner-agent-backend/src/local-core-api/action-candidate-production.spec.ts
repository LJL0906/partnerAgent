import type { ChatPreviewV1 } from '@partner-agent/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import type { ChatTaskEntity } from '../database/entities/chat-task.entity.js';
import { actionPreviewDisposition, persistActionCandidates } from './action-candidate-production.js';

const preview: ChatPreviewV1 = {
  schema_version: 1,
  preview_id: '30000000-0000-4000-8000-000000000001',
  kind: 'action',
  confirmation_status: 'unconfirmed',
  applied: false,
  source_refs: [
    { kind: 'original_record', id: '10000000-0000-4000-8000-000000000001' },
  ],
  content: {
    title: '明天提交周报',
    deadline_at: '2026-09-07T10:00:00.000Z',
    timezone: 'Asia/Shanghai',
    priority: 'high',
    confidence: 0.9,
  },
  warnings: [],
};

const task = {
  id: '20000000-0000-4000-8000-000000000001',
  ownerId: 'owner',
  sessionId: 'session',
  operationId: '40000000-0000-4000-8000-000000000001',
  originalRecordId: preview.source_refs[0].id,
} as ChatTaskEntity;

describe('persistActionCandidates', () => {
  it('auto-applies only one confident preview without uncertainty', () => {
    expect(actionPreviewDisposition([preview])).toBe('auto_apply');
    expect(actionPreviewDisposition([{ ...preview, content: { ...preview.content, confidence: 0.84 } }])).toBe('needs_choice');
    expect(actionPreviewDisposition([{ ...preview, content: { ...preview.content, uncertainty: '日期可能指下周' } }])).toBe('needs_choice');
    expect(actionPreviewDisposition([preview, { ...preview, preview_id: '30000000-0000-4000-8000-000000000002' }])).toBe('needs_choice');
  });

  it('atomically creates an action analysis, batch and server-owned candidates', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('from original_records') ? [{ request_fingerprint: 'fp' }] : [],
    );

    const result = await persistActionCandidates(
      { query } as unknown as EntityManager,
      task,
      [preview],
      new Date('2026-09-06T00:00:00.000Z'),
    );

    expect(result).toMatchObject({ candidateCount: 1, riskLevel: 'normal' });
    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('insert into analysis_runs');
    expect(sql).toContain('insert into structured_analyses');
    expect(sql).toContain('insert into confirmation_batches');
    expect(sql).toContain('insert into candidate_items');
    const candidateCall = query.mock.calls.find(([statement]) =>
      statement.includes('insert into candidate_items'),
    );
    expect(candidateCall?.[1]).toEqual(expect.arrayContaining([
      'owner',
      'action',
      'create',
      'normal',
    ]));
    expect(JSON.parse(String(candidateCall?.[1]?.[5]))).toMatchObject({
      title: '明天提交周报',
      execution_status: 'todo',
      priority: 'high',
      timezone: 'Asia/Shanghai',
    });
  });

  it('does not create analysis rows when there are no previews', async () => {
    const query = vi.fn();
    await expect(
      persistActionCandidates(
        { query } as unknown as EntityManager,
        task,
        [],
        new Date('2026-09-06T00:00:00.000Z'),
      ),
    ).resolves.toEqual(undefined);
    expect(query).not.toHaveBeenCalled();
  });
});
