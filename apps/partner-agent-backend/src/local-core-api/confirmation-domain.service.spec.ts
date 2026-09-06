import type { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmationDomainService } from './confirmation-domain.service.js';
import { ConfirmationTransactionPersistence } from './confirmation-transaction.persistence.js';
import type {
  BusinessRow,
  CandidateRow,
  ObjectSnapshot,
  ParsedPayload,
} from './confirmation-transaction.types.js';

const userId = 'owner';
const batchId = '20000000-0000-4000-8000-000000000001';
const actionId = '50000000-0000-4000-8000-000000000001';
const candidateId = '30000000-0000-4000-8000-000000000001';
const objectId = '40000000-0000-4000-8000-000000000001';
const now = new Date('2026-09-04T00:00:00.000Z');

describe('ConfirmationDomainService', () => {
  it('merges a generic update into the prior content instead of the domain row wrapper', async () => {
    const target = businessObject('memory');
    const before: ObjectSnapshot = {
      object: target,
      domain: {
        id: objectId,
        user_id: userId,
        content: { title: '旧标题', retained: '保留' },
        domain_status: 'active',
        confidence: 0.8,
        is_sensitive: false,
        confirmed_at: now.toISOString(),
      },
    };
    const updated = { ...target, version: '2' };
    const persistence = {
      snapshot: vi
        .fn()
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce({
          object: updated,
          domain: { content: { title: '新标题', retained: '保留' } },
        }),
      updateObject: vi.fn().mockResolvedValue(updated),
      recordChange: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ConfirmationDomainService(persistence as never);
    const candidate = updateCandidate('memory', { title: '新标题' });

    await service.applyCandidates(
      userId,
      batchId,
      actionId,
      confirmationPayload(),
      [candidate],
      [target],
      now,
    );

    expect(persistence.updateObject).toHaveBeenCalledWith(
      userId,
      batchId,
      candidate,
      target,
      { title: '新标题', retained: '保留' },
      'active',
      now,
    );
  });
});

describe('ConfirmationTransactionPersistence restoreObject', () => {
  it('restores every Action domain field from the original snapshot', async () => {
    const calls = queryCalls('action');
    const persistence = new ConfirmationTransactionPersistence(calls.runner);
    const domain = {
      id: objectId,
      user_id: userId,
      title: '原行动',
      description: '原说明',
      execution_status: 'paused',
      plan_status: 'rescheduled',
      timeliness_status: 'overdue',
      deadline_at: '2026-09-10T08:00:00.000Z',
      planned_at: '2026-09-09T08:00:00.000Z',
      started_at: '2026-09-08T08:00:00.000Z',
      completed_at: null,
      priority: 'high',
      timezone: 'Asia/Shanghai',
    };

    await persistence.restoreObject(
      userId,
      batchId,
      businessObject('action'),
      { object: businessObject('action'), domain },
      now,
    );

    expect(calls.domainSql()).toContain(
      'title=$3,description=$4,execution_status=$5,plan_status=$6',
    );
    expect(calls.domainSql()).toContain(
      'timeliness_status=$7,deadline_at=$8,planned_at=$9,started_at=$10,completed_at=$11',
    );
    expect(calls.domainParameters()).toEqual([
      userId,
      objectId,
      domain.title,
      domain.description,
      domain.execution_status,
      domain.plan_status,
      domain.timeliness_status,
      domain.deadline_at,
      domain.planned_at,
      domain.started_at,
      domain.completed_at,
      domain.priority,
      domain.timezone,
    ]);
  });

  it('restores every Goal domain field from the original snapshot', async () => {
    const calls = queryCalls('goal');
    const persistence = new ConfirmationTransactionPersistence(calls.runner);
    const domain = {
      id: objectId,
      user_id: userId,
      title: '原目标',
      description: '原说明',
      goal_status: 'paused',
      deadline_at: '2026-09-10T08:00:00.000Z',
      deadline_observation: 'due',
      confirmed_at: '2026-09-04T00:00:00.000Z',
    };

    await persistence.restoreObject(
      userId,
      batchId,
      businessObject('goal'),
      { object: businessObject('goal'), domain },
      now,
    );

    expect(calls.domainSql()).toContain(
      'title=$3,description=$4,goal_status=$5,deadline_at=$6,deadline_observation=$7,confirmed_at=$8',
    );
    expect(calls.domainParameters()).toEqual([
      userId,
      objectId,
      domain.title,
      domain.description,
      domain.goal_status,
      domain.deadline_at,
      domain.deadline_observation,
      domain.confirmed_at,
    ]);
  });

  it('restores every common domain field from the original snapshot', async () => {
    const calls = queryCalls('memory');
    const persistence = new ConfirmationTransactionPersistence(calls.runner);
    const domain = {
      id: objectId,
      user_id: userId,
      content: { title: '原内容', retained: true },
      domain_status: 'inactive',
      confidence: '0.750',
      is_sensitive: true,
      confirmed_at: '2026-09-04T00:00:00.000Z',
    };

    await persistence.restoreObject(
      userId,
      batchId,
      businessObject('memory'),
      { object: businessObject('memory'), domain },
      now,
    );

    expect(calls.domainSql()).toContain(
      'content=$3::jsonb,domain_status=$4,confidence=$5,is_sensitive=$6,confirmed_at=$7',
    );
    expect(calls.domainParameters()).toEqual([
      userId,
      objectId,
      JSON.stringify(domain.content),
      domain.domain_status,
      domain.confidence,
      domain.is_sensitive,
      domain.confirmed_at,
    ]);
  });
});

function businessObject(kind: BusinessRow['kind']): BusinessRow {
  return {
    id: objectId,
    user_id: userId,
    kind,
    version: '1',
    lifecycle_status: 'active',
    created_by_batch_id: batchId,
    last_confirmation_batch_id: batchId,
    archived_at: null,
    deleted_at: null,
    purged_at: null,
  };
}

function updateCandidate(
  kind: CandidateRow['kind'],
  payload: Record<string, unknown>,
): CandidateRow {
  return {
    id: candidateId,
    batch_id: batchId,
    kind,
    action: 'update',
    candidate_status: 'pending',
    risk: 'normal',
    payload,
    edited_payload: null,
    target_object_id: objectId,
    expected_version: '1',
    source_refs: [],
    expires_at: new Date(now.getTime() + 86_400_000),
    version: '1',
    editable_fields: ['title'],
  };
}

function confirmationPayload(): ParsedPayload {
  return {
    confirmation_batch_id: batchId,
    batch_version: '1',
    items: [
      {
        candidate_id: candidateId,
        candidate_version: '1',
        decision: 'confirm',
        expected_target_version: '1',
      },
    ],
  };
}

function queryCalls(kind: BusinessRow['kind']) {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const runner = {
    query: async (sql: string, parameters: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      calls.push({ sql: normalized, parameters });
      return normalized.startsWith('update business_objects')
        ? [{ ...businessObject(kind), version: '2' }]
        : [];
    },
  } as unknown as QueryRunner;
  return {
    runner,
    domainSql: () => (calls.at(-1)?.sql ?? '').replace(/\s+/g, ''),
    domainParameters: () => calls.at(-1)?.parameters ?? [],
  };
}
