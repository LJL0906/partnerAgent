import { ConfigService } from '@nestjs/config';
import {
  parseGetCandidateDetailResult,
  parseGetUndoEligibilityResult,
  parseListActionsResult,
} from '@partner-agent/contracts';
import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { TypeOrmSessionStore } from '../database/typeorm-session.store.js';
import { ActionQueryService } from './action-query.service.js';

const owner = 'owner';
const objectId = '10000000-0000-4000-8000-000000000001';
const batchId = '20000000-0000-4000-8000-000000000001';
const candidateId = '30000000-0000-4000-8000-000000000001';
const confirmationActionId = '40000000-0000-4000-8000-000000000001';
const at = new Date('2026-09-06T00:00:00.000Z');

function service(query: (sql: string, params: unknown[]) => Promise<unknown>) {
  const dataSource = { query: vi.fn(query) } as unknown as DataSource;
  return {
    service: new ActionQueryService(
      new TypeOrmSessionStore(new ConfigService(), dataSource),
    ),
    query: dataSource.query as ReturnType<typeof vi.fn>,
  };
}

describe('ActionQueryService', () => {
  it('returns an owner-scoped candidate detail accepted by the contract parser', async () => {
    const fixture = service(async () => [{
      id: candidateId, batch_id: batchId, version: '1', kind: 'action', action: 'create',
      payload: { title: '提交周报' }, edited_payload: null,
      source_refs: [{ kind: 'original_record', id: objectId }], confidence: '0.900',
      risk: 'normal', sensitive_marks: [], candidate_status: 'pending',
      editable_fields: ['title'], target_object_id: null, expected_version: null,
      expires_at: at, created_at: at, updated_at: at,
    }]);
    const value = await fixture.service.execute('GetCandidateDetail', {
      userId: owner, input: { candidate_id: candidateId },
    });
    expect(() => parseGetCandidateDetailResult(value)).not.toThrow();
    expect(fixture.query).toHaveBeenCalledWith(expect.stringContaining('ci.user_id=$1'), [owner, candidateId]);
  });

  it('returns Action rows using the combined created_at/id cursor order', async () => {
    const fixture = service(async () => [{
      id: objectId, version: '2', lifecycle_status: 'active', title: '提交周报',
      description: null, execution_status: 'todo', plan_status: 'normal',
      timeliness_status: 'no_deadline', deadline_at: null, planned_at: null,
      started_at: null, completed_at: null, created_at: at, updated_at: at,
    }]);
    const value = await fixture.service.execute('ListActions', {
      userId: owner, input: { limit: '20' },
    });
    expect(() => parseListActionsResult(value)).not.toThrow();
    expect(fixture.query.mock.calls[0][0]).toContain('order by bo.created_at desc,bo.id desc');
  });

  it('reports whole-batch undo eligibility from current observed versions', async () => {
    const fixture = service(async (sql) => sql.includes('limit 1')
      ? [{ confirmation_action_id: confirmationActionId, batch_id: batchId, kind: 'action' }]
      : [{ object_id: objectId, object_version: '2', current_version: '2', change_type: 'create', kind: 'action' }]);
    const value = await fixture.service.execute('GetUndoEligibility', {
      userId: owner, input: { object_kind: 'action', object_id: objectId },
    });
    expect(() => parseGetUndoEligibilityResult(value)).not.toThrow();
    expect(value).toMatchObject({ eligible: true, undo_scope: { observed_versions: { [objectId]: '2' } } });
  });
});
