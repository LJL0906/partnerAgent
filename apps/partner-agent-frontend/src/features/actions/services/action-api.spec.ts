import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createUndoCandidate,
  getAction,
  getActionHistory,
  getCandidateDetail,
  getConfirmationBatch,
  getUndoEligibility,
  listActions,
  listConfirmationHistory,
  listPendingConfirmationBatches,
  submitConfirmationBatch,
} from './action-api';

const mocks = vi.hoisted(() => ({
  createCommandEnvelope: vi.fn(),
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

vi.mock('../../../api/command-envelope', () => ({
  createCommandEnvelope: mocks.createCommandEnvelope,
}));
vi.mock('../../../api/http-client', () => ({
  getJson: mocks.getJson,
  postJson: mocks.postJson,
}));

const BATCH_ID = '00000000-0000-4000-8000-000000000001';
const CANDIDATE_ID = '00000000-0000-4000-8000-000000000002';
const ACTION_ID = '00000000-0000-4000-8000-000000000003';
const CONFIRMATION_ACTION_ID = '00000000-0000-4000-8000-000000000004';
const CONFIRM_OPERATION_ID = '00000000-0000-4000-8000-000000000005';
const UNDO_OPERATION_ID = '00000000-0000-4000-8000-000000000006';
const UNDO_BATCH_ID = '00000000-0000-4000-8000-000000000007';
const UNDO_CANDIDATE_ID = '00000000-0000-4000-8000-000000000008';
const source = { kind: 'chat_message', id: 'message-1' } as const;
const candidate = {
  candidate_ref: { kind: 'candidate', id: CANDIDATE_ID }, candidate_version: '1',
  batch_ref: { kind: 'confirmation_batch', id: BATCH_ID },
  kind: 'action', action: 'create', status: 'pending',
  content: { title: '整理报告' }, source_refs: [source], confidence: 0.9,
  risk: 'normal', sensitive_marks: [], editable_fields: ['title'],
  expires_at: '2026-09-07T00:00:00.000Z',
  created_at: '2026-09-06T00:00:00.000Z', updated_at: '2026-09-06T00:00:00.000Z',
} as const;
const batch = {
  batch_ref: { kind: 'confirmation_batch', id: BATCH_ID }, batch_version: '1', status: 'pending', risk: 'normal',
  item_count: 1, high_risk_count: 0, created_at: '2026-09-06T00:00:00.000Z',
  updated_at: '2026-09-06T00:00:00.000Z', expires_at: '2026-09-07T00:00:00.000Z', candidates: [candidate], source_refs: [source],
} as const;
const actionSummary = {
  action_ref: { kind: 'action', id: ACTION_ID }, version: '1', lifecycle_status: 'active', title: '整理报告', execution_status: 'todo',
  plan_status: 'normal', timeliness_status: 'no_deadline',
  created_at: '2026-09-06T00:01:00.000Z', updated_at: '2026-09-06T00:01:00.000Z',
} as const;
const action = { ...actionSummary, source_refs: [source], last_confirmation_batch_ref: { kind: 'confirmation_batch', id: BATCH_ID } } as const;

describe('action business API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createCommandEnvelope.mockImplementation(async (payload, options) => ({
      operation_id: options.operationId,
      client_source: 'web',
      request_fingerprint: 'fingerprint',
      payload,
    }));
  });

  it('reads every confirmation and action resource from its REST authority', async () => {
    mocks.getJson
      .mockResolvedValueOnce({ items: [{ batch_id: BATCH_ID, batch_version: '1', status: 'pending', risk: 'normal', item_count: 1, high_risk_count: 0, created_at: batch.created_at, updated_at: batch.updated_at, expires_at: batch.expires_at }], next_cursor: 'batch-cursor' })
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce({ items: [], next_cursor: 'history-cursor' })
      .mockResolvedValueOnce({ items: [actionSummary], next_cursor: 'action-cursor' })
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce({ object_ref: { kind: 'action', id: ACTION_ID }, items: [], next_cursor: undefined })
      .mockResolvedValueOnce({
        object_ref: { kind: 'action', id: ACTION_ID }, eligible: false,
        original_confirmation_action_id: CONFIRMATION_ACTION_ID,
        original_confirmation_batch_id: BATCH_ID, reversible: false,
        version_conflict: false, incompatible_follow_up: false,
        undo_scope: { original_confirmation_batch_id: BATCH_ID, whole_batch_required: true, object_refs: [{ kind: 'action', id: ACTION_ID }], observed_versions: { [ACTION_ID]: '1' } },
        blocking_reasons: [{ code: 'not_reversible', message: '不可撤销' }],
        requires_confirmation_batch: true,
      });

    await expect(listPendingConfirmationBatches({ cursor: 'a/b' })).resolves.toMatchObject({ next_cursor: 'batch-cursor' });
    await expect(getConfirmationBatch('batch/1')).resolves.toMatchObject({ batch_ref: { id: BATCH_ID } });
    await expect(getCandidateDetail('candidate/1')).resolves.toMatchObject({ candidate_ref: { id: CANDIDATE_ID } });
    await expect(listConfirmationHistory({ cursor: 'next' })).resolves.toMatchObject({ next_cursor: 'history-cursor' });
    await expect(listActions({ status: 'todo', cursor: 'next' })).resolves.toMatchObject({ next_cursor: 'action-cursor' });
    await expect(getAction('action/1')).resolves.toMatchObject({ action_ref: { id: ACTION_ID } });
    await expect(getActionHistory('action/1')).resolves.toMatchObject({ items: [] });
    await expect(getUndoEligibility('action/1')).resolves.toMatchObject({ eligible: false });

    expect(mocks.getJson.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/confirmation-batches?cursor=a%2Fb',
      '/api/v1/confirmation-batches/batch%2F1',
      '/api/v1/candidates/candidate%2F1',
      '/api/v1/confirmation-history?cursor=next',
      '/api/v1/actions?cursor=next&status=todo',
      '/api/v1/actions/action%2F1',
      '/api/v1/objects/action/action%2F1/history',
      '/api/v1/objects/action/action%2F1/undo-eligibility',
    ]);
  });

  it('wraps confirmation and undo writes in idempotent command envelopes', async () => {
    mocks.postJson
      .mockResolvedValueOnce({
        operation_id: CONFIRM_OPERATION_ID, status: 'completed',
        data: { batch_ref: { kind: 'confirmation_batch', id: BATCH_ID }, confirmed: [{ ref: { kind: 'action', id: ACTION_ID }, version: '1' }] },
      })
      .mockResolvedValueOnce({
        operation_id: UNDO_OPERATION_ID, status: 'completed',
        resource_refs: [{ kind: 'confirmation_batch', id: UNDO_BATCH_ID }, { kind: 'candidate', id: UNDO_CANDIDATE_ID }],
        new_versions: { [UNDO_BATCH_ID]: '1', [UNDO_CANDIDATE_ID]: '1' },
        data: { confirmation_batch_ref: { kind: 'confirmation_batch', id: UNDO_BATCH_ID }, batch_version: '1', candidate_refs: [{ candidate_ref: { kind: 'candidate', id: UNDO_CANDIDATE_ID }, candidate_version: '1', target_object_ref: { kind: 'action', id: ACTION_ID }, expected_target_version: '1' }] },
      });
    const signal = new AbortController().signal;
    const confirmationPayload = {
      confirmation_batch_id: BATCH_ID, batch_version: '1',
      items: [{ candidate_id: CANDIDATE_ID, candidate_version: '1', decision: 'confirm' as const }],
    };
    const undoPayload = {
      original_confirmation_action_id: CONFIRMATION_ACTION_ID,
      original_confirmation_batch_id: BATCH_ID,
      observed_versions: { [ACTION_ID]: '1' },
    };

    await expect(submitConfirmationBatch(confirmationPayload, { operationId: CONFIRM_OPERATION_ID, signal })).resolves.toMatchObject({ status: 'completed' });
    await expect(createUndoCandidate(undoPayload, { operationId: UNDO_OPERATION_ID, signal })).resolves.toMatchObject({ data: { batch_version: '1' } });

    expect(mocks.createCommandEnvelope).toHaveBeenNthCalledWith(1, confirmationPayload, { operationId: CONFIRM_OPERATION_ID });
    expect(mocks.createCommandEnvelope).toHaveBeenNthCalledWith(2, undoPayload, { operationId: UNDO_OPERATION_ID });
    expect(mocks.postJson).toHaveBeenNthCalledWith(1, '/api/v1/confirmation-batches/submit', expect.any(Object), { signal });
    expect(mocks.postJson).toHaveBeenNthCalledWith(2, '/api/v1/object-change-candidates/undo', expect.any(Object), { signal });
  });

  it('rejects malformed authority responses instead of exposing partial state', async () => {
    mocks.getJson.mockResolvedValueOnce({ items: [{ batch_id: BATCH_ID }] });
    await expect(listPendingConfirmationBatches()).rejects.toThrow('待确认批次响应格式无效');

    mocks.getJson.mockResolvedValueOnce({ ...action, execution_status: 'finished' });
    await expect(getAction('action-1')).rejects.toThrow('行动详情响应格式无效');
  });
});
