const { CHAT_ITEM_TYPES, createChatItemDefaults, isChatItem, parseChatItem, PREVIEW_ONLY_APPLIED } = require('../dist');

describe('unified chat item contract', () => {
  it('exports all supported item types and safe collapse defaults', () => {
    expect(CHAT_ITEM_TYPES).toEqual(['message','thinking','tool','candidate','approval','runtime','system','reminder','summary','error']);
    expect(createChatItemDefaults('message').collapsed).toBe(false);
    expect(createChatItemDefaults('thinking').collapsed).toBe(true);
    expect(createChatItemDefaults('tool').collapsed).toBe(true);
    expect(createChatItemDefaults('candidate').collapsed).toBe(true);
  });

  it('validates stable ids and relations without requiring backend-specific fields', () => {
    const item = {
      schema_version: 1, id: 'item-1', type: 'candidate', status: 'pending', collapsed: true,
      created_at: 1000, updated_at: 1000, session_id: 's-1', task_id: 't-1', operation_id: 'op-1',
      payload: { candidate_id: 'c-1', kind: 'goal', preview: { title: 'x' }, applied: false }
    };
    expect(isChatItem(item)).toBe(true);
    expect(parseChatItem(item)).toEqual(item);
    expect(isChatItem({ ...item, id: '' })).toBe(false);
  });

  it('requires preview-only business output to declare applied false', () => {
    expect(PREVIEW_ONLY_APPLIED).toBe(false);
    expect(isChatItem({
      schema_version: 1, id: 'item-2', type: 'candidate', status: 'pending', collapsed: true,
      created_at: 1000, updated_at: 1000, payload: { candidate_id: 'c-2', kind: 'goal', preview: {}, applied: true }
    })).toBe(false);
  });

  it('does not treat thinking deltas as ordinary message content', () => {
    expect(isChatItem({
      schema_version: 1, id: 'item-3', type: 'thinking', status: 'streaming', collapsed: true,
      created_at: 1000, updated_at: 1000, payload: { text: 'internal', display: 'summary' }
    })).toBe(true);
    expect(isChatItem({
      schema_version: 1, id: 'item-4', type: 'message', status: 'streaming', collapsed: false,
      created_at: 1000, updated_at: 1000, payload: { role: 'assistant', content: 'internal', visibility: 'thinking' }
    })).toBe(false);
  });
});

const validPayloads = {
  message: { role: 'assistant', content: '', format: 'markdown' },
  thinking: { text: '', display: 'summary' },
  tool: { tool: 'search', input_summary: '', output_summary: 'found', risk_level: 'low', undo_available: false },
  candidate: {
    candidate_id: 'c-1', kind: 'goal', preview: {}, applied: false,
    source_refs: [{ kind: 'message', id: 'm-1' }], confidence: 0.5, risk: 'normal', sensitive_marks: ['private'],
  },
  approval: { approval_id: 'a-1', tool: 'write', request_summary: 'Confirm write', risk_level: 'high', expires_at: 1000 },
  runtime: { state: 'running', detail: '', progress: 0.5 },
  system: { code: '', message: '' },
  reminder: { reminder_id: 'r-1', title: '', due_at: 1000 },
  summary: { content: '', period: '' },
  error: { code: 'failed', message: '', retryable: false },
};
const relationFields = [
  'session_id', 'task_id', 'operation_id', 'parent_id', 'message_id',
  'tool_call_id', 'execution_id', 'candidate_id', 'approval_id',
];
const makeItem = (type, payload = validPayloads[type]) => ({
  schema_version: 1, id: 'item-1', type, status: 'completed', collapsed: type !== 'message',
  created_at: 0, updated_at: 1000.5, sequence: 0,
  ...Object.fromEntries(relationFields.map((field) => [field, `${field}-1`])), payload,
});
const expectValid = (item) => {
  expect(isChatItem(item)).toBe(true);
  expect(parseChatItem(item)).toBe(item);
};
const expectInvalid = (item) => {
  expect(isChatItem(item)).toBe(false);
  expect(() => parseChatItem(item)).toThrow(TypeError);
};
const badNumbers = [null, '1', false, {}, [], NaN, Infinity, -Infinity];
const badStrings = [null, 1, false, {}, []];
const badIds = [...badStrings, '', '   '];
const badBooleans = [null, 0, 1, 'false', {}, []];

describe('untrusted chat item parsing', () => {
  it.each(Object.keys(validPayloads))('accepts a complete valid %s payload', (type) => {
    expectValid(makeItem(type));
  });

  it.each([
    ['message', { role: 'user', content: '' }], ['thinking', {}], ['tool', { tool: 'read' }],
    ['candidate', { candidate_id: 'c', kind: 'goal', preview: {}, applied: false }],
    ['approval', { approval_id: 'a', tool: 'write', request_summary: 'Confirm', risk_level: 'low' }],
    ['runtime', { state: '' }], ['system', { message: '' }], ['reminder', { title: '' }],
    ['summary', { content: '' }], ['error', { code: 'error', message: '' }],
  ])('accepts %s without optional fields', (type, payload) => {
    const item = makeItem(type, payload);
    delete item.sequence;
    for (const field of relationFields) delete item[field];
    expectValid(item);
  });

  it.each([null, undefined, [], 'item', 1])('rejects a non-object envelope: %p', expectInvalid);

  it.each([
    ['schema_version', [undefined, null, '1', 2]], ['id', [undefined, ...badIds]],
    ['type', [undefined, null, 'unknown', 1]], ['status', [undefined, null, 'unknown', 1]],
    ['collapsed', [undefined, ...badBooleans]], ['payload', [undefined, null, [], 'payload', 1]],
    ['created_at', [undefined, ...badNumbers, -1]], ['updated_at', [undefined, ...badNumbers, -1]],
    ['sequence', [...badNumbers, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]],
    ...relationFields.map((field) => [field, badIds]),
  ])('rejects invalid envelope field %s', (field, values) => {
    for (const value of values) expectInvalid({ ...makeItem('message'), [field]: value });
  });

  it('accepts safe sequence boundaries and finite nonnegative timestamps without changing units', () => {
    expectValid({ ...makeItem('message'), sequence: Number.MAX_SAFE_INTEGER, created_at: 0.5, updated_at: 0 });
  });

  it('rejects timestamps outside the JavaScript Date range used by renderers', () => {
    const tooLarge = 8_640_000_000_000_001;
    expectInvalid({ ...makeItem('message'), created_at: tooLarge });
    expectInvalid({ ...makeItem('message'), updated_at: tooLarge });
    expectInvalid(makeItem('approval', { ...validPayloads.approval, expires_at: tooLarge }));
    expectInvalid(makeItem('reminder', { ...validPayloads.reminder, due_at: tooLarge }));
  });

  it('rejects collapsed ordinary messages and thinking visibility', () => {
    expectInvalid({ ...makeItem('message'), collapsed: true });
    expectInvalid(makeItem('message', { ...validPayloads.message, visibility: 'thinking' }));
  });

  it.each([
    ['message', 'role', [undefined, null, 'tool', 1]],
    ['message', 'content', [undefined, ...badStrings]],
    ['message', 'format', [null, 'html', 1]],
    ['thinking', 'text', badStrings], ['thinking', 'display', [null, '', 'full', 1]],
    ['tool', 'tool', [undefined, ...badIds]],
    ['tool', 'input_summary', badStrings], ['tool', 'output_summary', badStrings],
    ['tool', 'risk_level', [null, '', 'critical', 1]], ['tool', 'undo_available', badBooleans],
    ['candidate', 'candidate_id', [undefined, ...badIds]], ['candidate', 'kind', [undefined, ...badIds]],
    ['candidate', 'preview', [undefined, null, [], 'preview', 1]],
    ['candidate', 'applied', [undefined, null, true, 0, 'false']],
    ['candidate', 'source_refs', [null, {}, 'refs', [null], ['ref'], [[]], [{}],
      [{ kind: 'message' }], [{ id: 'm' }],
      ...badIds.map((value) => [{ kind: value, id: 'm' }]),
      ...badIds.map((value) => [{ kind: 'message', id: value }])]],
    ['candidate', 'confidence', badNumbers], ['candidate', 'risk', [null, '', 'low', 1]],
    ['candidate', 'sensitive_marks', [null, {}, 'private', [null], [1], [[]], ['private', false]]],
    ['approval', 'approval_id', [undefined, ...badIds]], ['approval', 'tool', [undefined, ...badIds]],
    ['approval', 'request_summary', [undefined, ...badIds]],
    ['approval', 'risk_level', [undefined, null, '', 'critical', 1]],
    ['approval', 'expires_at', [...badNumbers, -1]],
    ['runtime', 'state', [undefined, ...badStrings]], ['runtime', 'detail', badStrings],
    ['runtime', 'progress', badNumbers],
    ['system', 'code', badStrings], ['system', 'message', [undefined, ...badStrings]],
    ['reminder', 'reminder_id', badIds], ['reminder', 'title', [undefined, ...badStrings]],
    ['reminder', 'due_at', [...badNumbers, -1]],
    ['summary', 'content', [undefined, ...badStrings]], ['summary', 'period', badStrings],
    ['error', 'code', [undefined, ...badIds]], ['error', 'message', [undefined, ...badStrings]],
    ['error', 'retryable', badBooleans],
  ])('rejects invalid %s payload field %s', (type, field, values) => {
    for (const value of values) expectInvalid(makeItem(type, { ...validPayloads[type], [field]: value }));
  });

  it.each([
    ['message', 'role', ['user', 'assistant', 'system']], ['message', 'format', ['text', 'markdown']],
    ['thinking', 'display', ['summary', 'progress', 'hidden']],
    ['tool', 'risk_level', ['read_only', 'low', 'medium', 'high']],
    ['approval', 'risk_level', ['read_only', 'low', 'medium', 'high']],
    ['tool', 'undo_available', [true, false]], ['error', 'retryable', [true, false]],
    ['candidate', 'risk', ['normal', 'high']], ['candidate', 'source_refs', [[], [{ kind: 'record', id: 'r' }]]],
    ['candidate', 'sensitive_marks', [[], ['']]], ['candidate', 'confidence', [0, 1]],
    ['runtime', 'progress', [0, 1]], ['approval', 'expires_at', [0, 0.5]], ['reminder', 'due_at', [0, 0.5]],
  ])('accepts valid %s payload field %s values', (type, field, values) => {
    for (const value of values) expectValid(makeItem(type, { ...validPayloads[type], [field]: value }));
  });

  it.each(['queued', 'streaming', 'pending', 'running', 'completed', 'failed', 'cancelled', 'dismissed', 'expired', 'paused'])(
    'preserves the existing status %s', (status) => expectValid({ ...makeItem('runtime'), status }),
  );
});
