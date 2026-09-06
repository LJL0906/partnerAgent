import { describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../../api/api-error';
import type {
  ActionApi,
  ActionDetail,
  ConfirmationBatchDetail,
  PendingConfirmationBatchSummary,
} from '../services/action-api';
import { createActionStore } from './action-store';

vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'generated-operation') }));
vi.mock('../../../api/config', () => ({ apiConfig: { serverUrl: 'http://example.test' } }));

const BATCH_ID = '00000000-0000-4000-8000-000000000001';
const CANDIDATE_ID = '00000000-0000-4000-8000-000000000002';
const ACTION_ID = '00000000-0000-4000-8000-000000000003';
const CONFIRMATION_ACTION_ID = '00000000-0000-4000-8000-000000000004';
const UNDO_BATCH_ID = '00000000-0000-4000-8000-000000000005';
const UNDO_CANDIDATE_ID = '00000000-0000-4000-8000-000000000006';
const candidate = {
  candidate_ref: { kind: 'candidate' as const, id: CANDIDATE_ID }, candidate_version: '1',
  batch_ref: { kind: 'confirmation_batch' as const, id: BATCH_ID },
  kind: 'action' as const, action: 'create' as const, status: 'pending' as const,
  content: { title: '原始标题' }, source_refs: [], confidence: 0.9, risk: 'normal' as const,
  sensitive_marks: [], editable_fields: ['title'], expires_at: '2026-09-07T00:00:00.000Z',
  created_at: '2026-09-06T00:00:00.000Z', updated_at: '2026-09-06T00:00:00.000Z',
};
const batch: ConfirmationBatchDetail = {
  batch_ref: { kind: 'confirmation_batch', id: BATCH_ID }, batch_version: '1', status: 'pending', risk: 'normal',
  item_count: 1, high_risk_count: 0, created_at: '2026-09-06T00:00:00.000Z',
  updated_at: '2026-09-06T00:00:00.000Z', expires_at: '2026-09-07T00:00:00.000Z', candidates: [candidate], source_refs: [],
};
const batchSummary: PendingConfirmationBatchSummary = {
  batch_id: BATCH_ID, batch_version: '1', status: 'pending', risk: 'normal',
  item_count: 1, high_risk_count: 0, created_at: batch.created_at, updated_at: batch.updated_at, expires_at: batch.expires_at,
};
const action: ActionDetail = {
  action_ref: { kind: 'action', id: ACTION_ID }, version: '1', lifecycle_status: 'active', title: '正式行动', execution_status: 'todo',
  plan_status: 'normal', timeliness_status: 'no_deadline', source_refs: [],
  last_confirmation_batch_ref: { kind: 'confirmation_batch', id: BATCH_ID },
  created_at: '2026-09-06T00:01:00.000Z', updated_at: '2026-09-06T00:01:00.000Z',
};

function api(overrides: Partial<ActionApi> = {}): ActionApi {
  return {
    listPendingConfirmationBatches: vi.fn(async () => ({ items: [batchSummary] })),
    getConfirmationBatch: vi.fn(async () => batch),
    getCandidateDetail: vi.fn(async () => candidate),
    listConfirmationHistory: vi.fn(async () => ({ items: [] })),
    submitConfirmationBatch: vi.fn(async (_payload, options) => ({
      operation_id: options.operationId, status: 'completed' as const,
      data: { batch_ref: { kind: 'confirmation_batch' as const, id: BATCH_ID }, confirmed: [{ ref: { kind: 'action' as const, id: ACTION_ID }, version: '1' }] },
    })),
    listActions: vi.fn(async () => ({ items: [action] })),
    getAction: vi.fn(async () => action),
    getActionHistory: vi.fn(async () => ({ items: [] })),
    getUndoEligibility: vi.fn(async () => ({
      object_ref: { kind: 'action' as const, id: ACTION_ID }, eligible: true,
      original_confirmation_action_id: CONFIRMATION_ACTION_ID, original_confirmation_batch_id: BATCH_ID,
      reversible: true, version_conflict: false, incompatible_follow_up: false,
      undo_scope: { original_confirmation_batch_id: BATCH_ID, whole_batch_required: true as const, object_refs: [{ kind: 'action' as const, id: ACTION_ID }], observed_versions: { [ACTION_ID]: '1' } },
      blocking_reasons: [], requires_confirmation_batch: true as const,
    })),
    createUndoCandidate: vi.fn(async (_payload, options) => ({
      operation_id: options.operationId, status: 'completed' as const,
      resource_refs: [{ kind: 'confirmation_batch' as const, id: UNDO_BATCH_ID }, { kind: 'candidate' as const, id: UNDO_CANDIDATE_ID }],
      new_versions: { [UNDO_BATCH_ID]: '1', [UNDO_CANDIDATE_ID]: '1' },
      data: { confirmation_batch_ref: { kind: 'confirmation_batch' as const, id: UNDO_BATCH_ID }, batch_version: '1', candidate_refs: [{ candidate_ref: { kind: 'candidate' as const, id: UNDO_CANDIDATE_ID }, candidate_version: '1', target_object_ref: { kind: 'action' as const, id: ACTION_ID }, expected_target_version: '1' }] },
    })),
    ...overrides,
  };
}

describe('action authority store', () => {
  it('represents loading, empty, error, and refresh states for pending batches', async () => {
    let resolveFirst: ((value: { items: PendingConfirmationBatchSummary[] }) => void) | undefined;
    const list = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockRejectedValueOnce(new Error('raw server detail'))
      .mockResolvedValueOnce({ items: [] });
    const store = createActionStore({ api: api({ listPendingConfirmationBatches: list }) });

    const first = store.getState().refreshPendingBatches();
    expect(store.getState().pendingBatches.phase).toBe('loading');
    resolveFirst?.({ items: [batchSummary] });
    await first;
    expect(store.getState().pendingBatches).toMatchObject({ phase: 'ready', data: [batchSummary] });

    await expect(store.getState().refreshPendingBatches()).resolves.toBe(false);
    expect(store.getState().pendingBatches).toMatchObject({ phase: 'error', errorMessage: '待确认内容加载失败，请稍后重试。' });

    await expect(store.getState().refreshPendingBatches()).resolves.toBe(true);
    expect(store.getState().pendingBatches).toMatchObject({ phase: 'ready', data: [] });
  });

  it('uses a candidate event only as a hint to refresh REST authority', async () => {
    const list = vi.fn(async () => ({ items: [batchSummary] }));
    const store = createActionStore({ api: api({ listPendingConfirmationBatches: list }) });

    await store.getState().refreshFromCandidateHint();

    expect(list).toHaveBeenCalledOnce();
    expect(store.getState().pendingBatches.data).toEqual([batchSummary]);
  });

  it('loads batch, candidate, histories, action detail, and undo eligibility independently', async () => {
    const actionApi = api();
    const store = createActionStore({ api: actionApi });

    await Promise.all([
      store.getState().loadBatch(BATCH_ID),
      store.getState().loadCandidate(CANDIDATE_ID),
      store.getState().loadConfirmationHistory(),
      store.getState().refreshActions(),
      store.getState().loadAction(ACTION_ID),
      store.getState().loadActionHistory(ACTION_ID),
      store.getState().loadUndoEligibility(ACTION_ID),
    ]);

    expect(store.getState().batches[BATCH_ID]?.data).toEqual(batch);
    expect(store.getState().candidates[CANDIDATE_ID]?.data).toEqual(candidate);
    expect(store.getState().confirmationHistory.data).toEqual([]);
    expect(store.getState().actions.data).toEqual([action]);
    expect(store.getState().actionDetails[ACTION_ID]?.data).toEqual(action);
    expect(store.getState().actionHistory[ACTION_ID]?.data).toEqual([]);
    expect(store.getState().undoEligibility[ACTION_ID]?.data?.eligible).toBe(true);
  });

  it('submits an explicit decision and rereads batch, list, and confirmed actions', async () => {
    const actionApi = api();
    const store = createActionStore({ api: actionApi, createOperationId: () => 'operation-1' });
    store.getState().setCandidateDraft(CANDIDATE_ID, { title: '修改后的标题' });

    await expect(store.getState().submitConfirmation({
      confirmation_batch_id: BATCH_ID, batch_version: '1',
      items: [{ candidate_id: CANDIDATE_ID, candidate_version: '1', decision: 'modify_confirm', modified_payload: { title: '修改后的标题' } }],
    })).resolves.toBe(true);

    expect(actionApi.submitConfirmationBatch).toHaveBeenCalledWith(expect.any(Object), { operationId: 'operation-1' });
    expect(actionApi.getConfirmationBatch).toHaveBeenCalledWith(BATCH_ID);
    expect(actionApi.listPendingConfirmationBatches).toHaveBeenCalled();
    expect(actionApi.listActions).toHaveBeenCalled();
    expect(actionApi.getAction).toHaveBeenCalledWith(ACTION_ID);
    expect(store.getState().actionDetails[ACTION_ID]?.data).toEqual(action);
    expect(store.getState().candidateDrafts[CANDIDATE_ID]).toBeUndefined();
    expect(store.getState().confirmationMutation.phase).toBe('succeeded');
  });

  it('retains edits and refreshes the authoritative batch after a version conflict', async () => {
    const actionApi = api({
      submitConfirmationBatch: vi.fn(async () => {
        throw new ApiClientError('raw conflict', 409);
      }),
    });
    const store = createActionStore({ api: actionApi, createOperationId: () => 'operation-1' });
    store.getState().setCandidateDraft(CANDIDATE_ID, { title: '用户未提交成功的修改' });

    await expect(store.getState().submitConfirmation({
      confirmation_batch_id: BATCH_ID, batch_version: '1',
      items: [{ candidate_id: CANDIDATE_ID, candidate_version: '1', decision: 'modify_confirm', modified_payload: { title: '用户未提交成功的修改' } }],
    })).resolves.toBe(false);

    expect(actionApi.getConfirmationBatch).toHaveBeenCalledWith(BATCH_ID);
    expect(store.getState().candidateDrafts[CANDIDATE_ID]).toEqual({ title: '用户未提交成功的修改' });
    expect(store.getState().confirmationMutation).toMatchObject({ phase: 'conflict', canRetry: true });
  });

  it('reuses the same operation id when an uncertain confirmation is retried', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(new ApiClientError('offline', 0))
      .mockResolvedValueOnce({
        operation_id: 'operation-stable', status: 'completed' as const,
        data: { batch_ref: { kind: 'confirmation_batch' as const, id: BATCH_ID }, confirmed: [] },
      });
    const store = createActionStore({
      api: api({ submitConfirmationBatch: submit }),
      createOperationId: () => 'operation-stable',
    });
    const payload = {
      confirmation_batch_id: BATCH_ID, batch_version: '1',
      items: [{ candidate_id: CANDIDATE_ID, candidate_version: '1', decision: 'cancel' as const }],
    };

    await expect(store.getState().submitConfirmation(payload)).resolves.toBe(false);
    await expect(store.getState().submitConfirmation(payload)).resolves.toBe(true);

    expect(submit.mock.calls.map((call) => call[1]?.operationId)).toEqual(['operation-stable', 'operation-stable']);
  });

  it('does not describe a committed confirmation as failed when authority refresh fails', async () => {
    const store = createActionStore({
      api: api({ getConfirmationBatch: vi.fn(async () => { throw new Error('offline'); }) }),
      createOperationId: () => 'operation-1',
    });

    await expect(store.getState().submitConfirmation({
      confirmation_batch_id: BATCH_ID, batch_version: '1',
      items: [{ candidate_id: CANDIDATE_ID, candidate_version: '1', decision: 'confirm' }],
    })).resolves.toBe(false);

    expect(store.getState().confirmationMutation).toMatchObject({
      phase: 'error',
      errorMessage: '确认已提交，但最新状态读取失败；请刷新，重试仍会复用同一操作。',
      canRetry: true,
    });
  });

  it('creates an undo candidate and refreshes the returned batch without claiming an undo', async () => {
    const actionApi = api({ getConfirmationBatch: vi.fn(async (id) => ({ ...batch, batch_ref: { kind: 'confirmation_batch' as const, id } })) });
    const store = createActionStore({ api: actionApi, createOperationId: () => 'undo-operation' });
    const eligibility = await actionApi.getUndoEligibility(ACTION_ID);

    await expect(store.getState().createUndoCandidate(eligibility)).resolves.toBe(UNDO_BATCH_ID);

    expect(actionApi.createUndoCandidate).toHaveBeenCalledWith(expect.objectContaining({
      original_confirmation_action_id: CONFIRMATION_ACTION_ID,
      original_confirmation_batch_id: BATCH_ID,
      observed_versions: { [ACTION_ID]: '1' },
    }), { operationId: 'undo-operation' });
    expect(actionApi.getConfirmationBatch).toHaveBeenCalledWith(UNDO_BATCH_ID);
    expect(store.getState().undoMutation.phase).toBe('succeeded');
  });
});
