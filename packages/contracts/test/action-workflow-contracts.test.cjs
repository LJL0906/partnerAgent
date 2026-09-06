const contracts = require('../dist');

const ids = {
  action: '11111111-1111-4111-8111-111111111111',
  batch: '22222222-2222-4222-8222-222222222222',
  candidate: '33333333-3333-4333-8333-333333333333',
  confirmationAction: '44444444-4444-4444-8444-444444444444',
  analysis: '55555555-5555-4555-8555-555555555555',
  structured: '66666666-6666-4666-8666-666666666666',
  record: '77777777-7777-4777-8777-777777777777',
  task: '88888888-8888-4888-8888-888888888888',
  operation: '99999999-9999-4999-8999-999999999999',
  history: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

const at = '2026-09-06T08:00:00.000Z';
const later = '2026-09-06T09:00:00.000Z';
const actionRef = { kind: 'action', id: ids.action };
const batchRef = { kind: 'confirmation_batch', id: ids.batch };
const candidateRef = { kind: 'candidate', id: ids.candidate };

const candidate = {
  candidate_ref: candidateRef,
  batch_ref: batchRef,
  candidate_version: '1',
  kind: 'action',
  action: 'create',
  content: { title: '整理发布清单' },
  source_refs: [{ kind: 'original_record', id: ids.record }],
  confidence: 0.9,
  risk: 'normal',
  sensitive_marks: [],
  status: 'pending',
  editable_fields: ['title'],
  expires_at: later,
  created_at: at,
  updated_at: at,
};

const action = {
  action_ref: actionRef,
  version: '1',
  lifecycle_status: 'active',
  title: '整理发布清单',
  execution_status: 'todo',
  plan_status: 'normal',
  timeliness_status: 'no_deadline',
  created_at: at,
  updated_at: at,
};

describe('action workflow query result contracts', () => {
  const parsers = [
    ['parseGetConfirmationBatchResult', {
      batch_ref: batchRef, batch_version: '1', status: 'pending', risk: 'normal',
      item_count: 1, high_risk_count: 0, source_refs: candidate.source_refs,
      candidates: [candidate], expires_at: later, created_at: at, updated_at: at,
    }],
    ['parseGetCandidateDetailResult', candidate],
    ['parseGetConfirmationHistoryResult', {
      items: [{ confirmation_action_id: ids.confirmationAction, batch_ref: batchRef,
        operation_id: ids.operation, action_type: 'confirm', client_source: 'android',
        object_refs: [actionRef], created_at: at }],
    }],
    ['parseListActionsResult', { items: [action], next_cursor: 'opaque-cursor' }],
    ['parseGetActionResult', {
      ...action, description: '逐项核对', source_refs: candidate.source_refs,
      last_confirmation_batch_ref: batchRef,
    }],
    ['parseGetChangeHistoryResult', {
      object_ref: actionRef,
      items: [{ change_id: ids.history, object_version: '1', change_type: 'create',
        confirmation_action_id: ids.confirmationAction, before: null,
        after: { title: '整理发布清单' }, created_at: at }],
    }],
    ['parseGetUndoEligibilityResult', {
      object_ref: actionRef, eligible: true,
      original_confirmation_action_id: ids.confirmationAction,
      original_confirmation_batch_id: ids.batch, reversible: true,
      version_conflict: false, incompatible_follow_up: false,
      undo_scope: { original_confirmation_batch_id: ids.batch,
        whole_batch_required: true, object_refs: [actionRef],
        observed_versions: { [ids.action]: '1' } },
      blocking_reasons: [], requires_confirmation_batch: true,
    }],
    ['parseGetAnalysisRunResult', {
      analysis_run_ref: { kind: 'analysis_run', id: ids.analysis },
      original_record_ref: { kind: 'original_record', id: ids.record },
      chat_task_ref: { kind: 'analysis', task_id: ids.task },
      analysis_type: 'action', status: 'completed',
      result_refs: [{ kind: 'analysis_result', id: ids.structured }],
      version: '1', created_at: at, updated_at: later, completed_at: later,
    }],
  ];

  it.each(parsers)('%s accepts its stable result shape', (name, value) => {
    expect(contracts[name](value)).toBe(value);
  });

  it.each(parsers)('%s rejects unknown top-level fields', (name, value) => {
    expect(() => contracts[name]({ ...value, internal_row_id: 'leak' })).toThrow(TypeError);
  });

  it('rejects inconsistent and malformed nested results', () => {
    expect(() => contracts.parseGetConfirmationBatchResult({
      ...parsers[0][1], item_count: 2,
    })).toThrow(TypeError);
    expect(() => contracts.parseGetCandidateDetailResult({
      ...candidate, candidate_version: '0', risk: 'critical',
    })).toThrow(TypeError);
    expect(() => contracts.parseListActionsResult({
      items: [{ ...action, execution_status: 'unknown' }],
    })).toThrow(TypeError);
    expect(() => contracts.parseGetChangeHistoryResult({
      ...parsers[5][1], object_ref: { kind: 'session', id: ids.action },
    })).toThrow(TypeError);
    expect(() => contracts.parseGetUndoEligibilityResult({
      ...parsers[6][1], eligible: true,
      blocking_reasons: [{ code: 'version_conflict', message: '冲突' }],
    })).toThrow(TypeError);
    expect(() => contracts.parseGetAnalysisRunResult({
      ...parsers[7][1], completed_at: 'not-a-date',
    })).toThrow(TypeError);
  });
});

describe('CreateUndoObjectCandidate command contract', () => {
  const request = {
    operation_id: ids.operation,
    client_source: 'android',
    request_fingerprint: 'sha256:undo-request',
    payload: {
      original_confirmation_action_id: ids.confirmationAction,
      original_confirmation_batch_id: ids.batch,
      observed_versions: { [ids.action]: '1' },
    },
  };
  const data = {
    confirmation_batch_ref: batchRef,
    batch_version: '1',
    candidate_refs: [{ candidate_ref: candidateRef, candidate_version: '1',
      target_object_ref: actionRef, expected_target_version: '1' }],
  };
  const result = {
    operation_id: ids.operation,
    status: 'completed',
    resource_refs: [batchRef, candidateRef],
    new_versions: { [ids.batch]: '1', [ids.candidate]: '1' },
    data,
  };

  it('accepts an owner-neutral envelope whose operation_id is the idempotency key', () => {
    expect(contracts.parseCreateUndoObjectCandidateCommandRequest(request)).toBe(request);
    expect(contracts.parseCreateUndoObjectCandidateCommandResult(result, ids.operation)).toBe(result);
  });

  it.each(['object_refs', 'kind', 'action', 'risk'])('rejects client-controlled payload field %s', (field) => {
    expect(() => contracts.parseCreateUndoObjectCandidateCommandRequest({
      ...request, payload: { ...request.payload, [field]: [] },
    })).toThrow(TypeError);
  });

  it('rejects unknown envelope fields, expected_version, invalid versions, and mismatched results', () => {
    expect(() => contracts.parseCreateUndoObjectCandidateCommandRequest({
      ...request, owner_id: 'attacker',
    })).toThrow(TypeError);
    expect(() => contracts.parseCreateUndoObjectCandidateCommandRequest({
      ...request, expected_version: '1',
    })).toThrow(TypeError);
    expect(() => contracts.parseCreateUndoObjectCandidateCommandRequest({
      ...request, payload: { ...request.payload, observed_versions: { [ids.action]: '0' } },
    })).toThrow(TypeError);
    expect(() => contracts.parseCreateUndoObjectCandidateCommandResult({
      ...result, operation_id: ids.history,
    }, ids.operation)).toThrow(TypeError);
    expect(() => contracts.parseCreateUndoObjectCandidateCommandResult({
      ...result, resource_refs: [batchRef],
    }, ids.operation)).toThrow(TypeError);
  });
});
