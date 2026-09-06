const fs = require('node:fs');
const path = require('node:path');

const contracts = require('../dist');

const readFixture = (name) => JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'),
);

describe('shared contract alignment v1', () => {
  it('publishes the exact fixture corpus through stable package subpaths', () => {
    expect(require('@partner-agent/contracts/fixtures/chat-session-v1.json'))
      .toEqual(readFixture('chat-session-v1.json'));
    expect(require('@partner-agent/contracts/fixtures/chat-preview-v1.json'))
      .toEqual(readFixture('chat-preview-v1.json'));
  });

  it('accepts the shared REST snapshot and validates every recoverable item', () => {
    const fixture = readFixture('chat-session-v1.json');

    expect(contracts.parseChatSessionSummary(fixture.snapshot)).toBe(fixture.snapshot);
    expect(fixture.snapshot.items.every(contracts.isChatItem)).toBe(true);
    expect(fixture.snapshot.messages.every(contracts.isSessionMessageDto)).toBe(true);
    expect(fixture.snapshot.tool_views.every(contracts.isSessionToolView)).toBe(true);
    expect(fixture.ws_events.every(contracts.isServerPushEventV1)).toBe(true);
  });

  it('uses the same item identity and revision in REST and WebSocket examples', () => {
    const fixture = readFixture('chat-session-v1.json');
    const assistant = fixture.snapshot.items.find((item) => item.id === 'task:task-1:assistant');
    const runtime = fixture.snapshot.items.find((item) => item.id === 'task:task-2:runtime');
    const textDelta = fixture.ws_events.find((event) => event.event_type === 'text_delta');
    const taskState = fixture.ws_events.find((event) => event.event_type === 'task_state');

    expect(textDelta.item_id).toBe(assistant.id);
    expect(textDelta.item_revision).toBe(assistant.revision);
    expect(textDelta.message_id).toBe(assistant.message_id);
    expect(textDelta.text_offset).toBe(0);
    expect(taskState.item_id).toBe(runtime.id);
    expect(taskState.item_revision).toBe(runtime.revision);
  });

  it('validates accepted submit refs and the server-resolved model as one result', () => {
    const fixture = readFixture('chat-session-v1.json');
    const operationId = fixture.submit_result.operation_id;

    expect(contracts.parseSubmitTextInputCommandResult(
      fixture.submit_result,
      operationId,
    )).toBe(fixture.submit_result);
    expect(contracts.isSubmitTextInputCommandResult(
      fixture.submit_result,
      '22222222-2222-4222-8222-222222222222',
    )).toBe(false);
    expect(contracts.isSubmitTextInputCommandResult({
      ...fixture.submit_result,
      task_refs: [{ kind: 'analysis', task_id: 'task-1' }],
    })).toBe(false);
    expect(contracts.isSubmitTextInputCommandResult({
      ...fixture.submit_result,
      data: { ...fixture.submit_result.data, analysis_task: 123 },
    })).toBe(false);
  });

  it('accepts the public preview and rejects all documented invalid previews', () => {
    const fixture = readFixture('chat-preview-v1.json');

    expect(contracts.parseChatPreviewV1(fixture.valid)).toEqual(fixture.valid);
    for (const sample of fixture.invalid) {
      expect(contracts.isChatPreviewV1(sample.value)).toBe(false);
      expect(() => contracts.parseChatPreviewV1(sample.value)).toThrow(
        expect.objectContaining({
          issues: [expect.objectContaining({ code: sample.expected_code })],
        }),
      );
    }
  });

  it('returns stable preview error codes and enforces task-level limits', () => {
    const fixture = readFixture('chat-preview-v1.json');
    const missingSource = { ...fixture.valid, source_refs: [] };

    expect(() => contracts.parseChatPreviewV1(missingSource)).toThrow(
      expect.objectContaining({
        issues: [expect.objectContaining({
          code: 'STRUCTURED_PREVIEW_SOURCE_INVALID', path: '/source_refs',
        })],
      }),
    );
    expect(contracts.parseChatPreviewsV1([fixture.valid])).toHaveLength(1);
    expect(() => contracts.parseChatPreviewsV1([])).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ code: 'STRUCTURED_PREVIEW_MISSING' })] }),
    );
    expect(() => contracts.parseChatPreviewsV1(Array(21).fill(fixture.valid))).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ code: 'STRUCTURED_PREVIEW_TOO_LARGE' })] }),
    );
    expect(() => contracts.parseChatPreviewsV1([fixture.valid, fixture.valid])).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({
        code: 'STRUCTURED_PREVIEW_INVALID', path: '/preview_id',
      })] }),
    );
  });

  it('recovers a stable valid collection without weakening strict writes', () => {
    const fixture = readFixture('chat-preview-v1.json');
    const preview = (previewId, title = previewId, warningMessage = '') => ({
      ...fixture.valid,
      preview_id: previewId,
      content: { ...fixture.valid.content, title },
      warnings: warningMessage
        ? [{ code: 'RECOVERY_TEST', message: warningMessage }]
        : [],
    });

    const deduplicated = contracts.recoverChatPreviewsV1([
      preview('duplicate', '保留第一项'),
      preview('duplicate', '忽略重复项'),
      { schema_version: 1, preview_id: 'damaged' },
      preview('valid-sibling'),
    ]);
    expect(deduplicated.map((item) => item.preview_id)).toEqual([
      'duplicate',
      'valid-sibling',
    ]);
    expect(deduplicated[0].content.title).toBe('保留第一项');
    expect(new Set(deduplicated.map((item) =>
      contracts.chatItemIds.preview(item.preview_id))).size).toBe(deduplicated.length);
    expect(contracts.parseChatPreviewsV1(deduplicated)).toEqual(deduplicated);

    const limited = contracts.recoverChatPreviewsV1(
      Array.from({ length: 22 }, (_, index) => preview(`count-${index}`)),
    );
    expect(limited.map((item) => item.preview_id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `count-${index}`),
    );
    expect(contracts.parseChatPreviewsV1(limited)).toEqual(limited);

    const sizeLimited = contracts.recoverChatPreviewsV1([
      preview('large-1', 'large-1', 'a'.repeat(28_000)),
      preview('large-2', 'large-2', 'b'.repeat(28_000)),
      preview('would-overflow', 'would-overflow', 'c'.repeat(28_000)),
      preview('small-after-overflow'),
    ]);
    expect(sizeLimited.map((item) => item.preview_id)).toEqual([
      'large-1',
      'large-2',
      'small-after-overflow',
    ]);
    expect(contracts.parseChatPreviewsV1(sizeLimited)).toEqual(sizeLimited);

    const source = preview('isolated', '原始标题', '原始警告');
    const expected = structuredClone(source);
    const firstRead = contracts.recoverChatPreviewsV1([source]);
    firstRead[0].content.title = '污染标题';
    firstRead[0].source_refs[0].id = 'polluted-source';
    firstRead[0].warnings.push({ code: 'POLLUTED', message: '污染警告' });
    expect(contracts.recoverChatPreviewsV1([source])).toEqual([expected]);
  });

  it('keeps model output separate from server-owned preview fields', () => {
    const fixture = readFixture('chat-preview-v1.json');

    expect(contracts.isChatPreviewProposalV1(fixture.valid_proposal)).toBe(true);
    expect(contracts.isChatPreviewProposalV1(fixture.valid)).toBe(false);
  });

  it('exports one authoritative output mode, preview kind, and proposal schema', () => {
    const fixture = readFixture('chat-preview-v1.json');

    expect(contracts.CHAT_OUTPUT_MODES).toEqual(['chat', 'structured_preview']);
    expect(contracts.CHAT_PREVIEW_KINDS).toEqual(['action']);
    expect(contracts.CHAT_PREVIEW_PROPOSAL_V1_JSON_SCHEMA).toEqual({
      type: 'object',
      properties: {
        schema_version: { const: 1, type: 'number' },
        kind: { const: 'action', type: 'string' },
        source_refs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: {
                anyOf: [
                  { const: 'original_record', type: 'string' },
                  { const: 'chat_message', type: 'string' },
                ],
              },
              id: { minLength: 1, type: 'string' },
            },
            required: ['kind', 'id'],
            additionalProperties: false,
          },
        },
        content: {
          type: 'object',
          properties: {
            title: { minLength: 1, maxLength: 200, type: 'string' },
            description: { maxLength: 2000, type: 'string' },
            planned_at: { type: 'string' },
            deadline_at: { type: 'string' },
            timezone: { minLength: 1, type: 'string' },
            priority: {
              anyOf: [
                { const: 'low', type: 'string' },
                { const: 'medium', type: 'string' },
                { const: 'high', type: 'string' },
              ],
            },
            confidence: { minimum: 0, maximum: 1, type: 'number' },
            uncertainty: { maxLength: 2000, type: 'string' },
            risk_summary: { maxLength: 2000, type: 'string' },
          },
          required: ['title', 'confidence'],
          additionalProperties: false,
        },
      },
      required: ['schema_version', 'kind', 'content'],
      additionalProperties: false,
    });
    expect(contracts.parseChatPreviewProposalV1(fixture.valid_proposal))
      .toBe(fixture.valid_proposal);
  });

  it('enforces submit mode discrimination and allows server-side model defaults', () => {
    expect(contracts.isSubmitTextInputPayload({
      text: 'hello', input_id: 'input-1',
    })).toBe(true);
    expect(contracts.isSubmitTextInputPayload({
      text: 'extract an action', input_id: 'input-2',
      output_mode: 'structured_preview', preview_kind: 'action',
    })).toBe(true);
    expect(contracts.isSubmitTextInputPayload({
      text: 'bad combination', input_id: 'input-3',
      output_mode: 'structured_preview', preview_kind: 'action', request_analysis: true,
    })).toBe(false);
    expect(contracts.isSubmitTextInputPayload({
      text: 'bad kind', input_id: 'input-4',
      output_mode: 'structured_preview', preview_kind: 'goal',
    })).toBe(false);
    expect(contracts.isSubmitTextInputPayload({
      text: 'chat cannot name preview kind', input_id: 'input-5', preview_kind: 'action',
    })).toBe(false);
  });

  it('provides stable item ids and an exhaustive task display mapping', () => {
    expect(contracts.chatItemIds.message('m-1')).toBe('message:m-1');
    expect(contracts.chatItemIds.taskAssistant('t-1')).toBe('task:t-1:assistant');
    expect(contracts.chatItemIds.taskRuntime('t-1')).toBe('task:t-1:runtime');
    expect(contracts.chatItemIds.tool('tc-1')).toBe('tool:tc-1');
    expect(contracts.chatItemIds.approval('a-1')).toBe('approval:a-1');
    expect(contracts.chatItemIds.preview('p-1')).toBe('preview:p-1');

    expect(Object.keys(contracts.TASK_STATE_TO_CHAT_ITEM_STATUS).sort())
      .toEqual([...contracts.TASK_STATES].sort());
    expect(contracts.taskStateToChatItemStatus('waiting_privacy_decision')).toBe('pending');
    expect(contracts.taskStateToChatItemStatus('waiting_tool_approval')).toBe('pending');
    expect(contracts.taskStateToChatItemStatus('cancelled')).toBe('cancelled');
  });

  it('rejects unsafe or forged tool projections', () => {
    const fixture = readFixture('chat-session-v1.json');
    const tool = fixture.snapshot.tool_views[0];

    expect(contracts.isSessionToolView(tool)).toBe(true);
    expect(contracts.isSessionToolView({ ...tool, arguments: { secret: true } })).toBe(false);
    expect(contracts.isSessionToolView({ ...tool, version: 0 })).toBe(false);
    expect(contracts.isSessionToolView({ ...tool, allowed_actions: ['apply'] })).toBe(false);
    expect(contracts.isSessionToolView({ ...tool, status: 'succeeded', allowed_actions: ['confirm'] })).toBe(false);
    expect(contracts.isSessionToolView({ ...tool, allowed_actions: ['undo'] })).toBe(false);
  });

  it('requires account id to match the trusted JWT subject', () => {
    const user = { id: 'user-1', username: 'liu' };
    expect(contracts.isAccountPublicUser(user)).toBe(true);
    expect(contracts.isAccountIdentityConsistent(user, 'user-1')).toBe(true);
    expect(contracts.isAccountIdentityConsistent(user, 'liu')).toBe(false);
  });

  it('validates server model capabilities and defaults without exposing credentials', () => {
    expect(contracts.isModelConfig({
      id: 'deepseek:deepseek-chat', provider: 'deepseek', model_id: 'deepseek-chat',
      capabilities: ['chat'], reasoning_levels: ['off'], default_reasoning_level: 'off',
    })).toBe(true);
    expect(contracts.isModelConfig({
      id: 'openai:gpt', provider: 'openai', model_id: 'gpt',
      capabilities: ['chat', 'reasoning'], reasoning_levels: ['low', 'high'],
      default_reasoning_level: 'medium',
    })).toBe(false);
    expect(contracts.isModelConfig({
      id: 'unsafe', provider: 'openai', model_id: 'gpt', api_key_ref: 'secret',
      capabilities: ['chat'], reasoning_levels: ['off'], default_reasoning_level: 'off',
    })).toBe(false);
  });

  it('rejects old deltas that lack item revision and UTF-16 offset metadata', () => {
    const fixture = readFixture('chat-session-v1.json');
    const event = fixture.ws_events[0];
    const { item_revision: ignored, ...oldEvent } = event;
    expect(ignored).toBe(3);
    expect(contracts.isServerPushEventV1(oldEvent)).toBe(false);
    expect(contracts.isServerPushEventV1({ ...event, text_offset: -1 })).toBe(false);
    expect(contracts.isServerPushEventV1({ ...event, channel: 'task:other' })).toBe(false);
    expect(contracts.isServerPushEventV1({
      ...event,
      event_type: 'tool_execution_end',
      data: {},
      item_id: 'tool:tool-call-1',
    })).toBe(false);
  });

  it('rejects preview wrappers with formal candidate or tool relationships', () => {
    const fixture = readFixture('chat-session-v1.json');
    const preview = fixture.snapshot.items.find((item) => item.type === 'structured_preview');
    expect(contracts.isChatItem({ ...preview, confirmation_id: 'forged' })).toBe(false);
    expect(contracts.isChatItem({ ...preview, tool_call_id: 'forged' })).toBe(false);
  });

  it('rejects cross-session history and malformed optional event fields', () => {
    const fixture = readFixture('chat-session-v1.json');
    const base = {
      schema_version: 1,
      event_id: 'event-extra',
      channel: 'session:session-1',
      sequence: 3,
      session_id: 'session-1',
      timestamp: 1788681660000,
    };
    expect(contracts.isServerPushEventV1({
      ...base,
      event_type: 'history',
      data: { messages: [{ ...fixture.snapshot.messages[0], session_id: 'session-other' }] },
    })).toBe(false);
    expect(contracts.isServerPushEventV1({
      ...base,
      channel: 'task:task-2',
      task_id: 'task-2',
      event_type: 'task_state',
      item_id: 'task:task-2:runtime',
      item_revision: 3,
      data: { state: 'running', privacy_decision: {} },
    })).toBe(false);
    expect(contracts.isServerPushEventV1({
      ...base,
      event_type: 'recovery_required',
      data: { reason: 'event_expired', query_url: 123 },
    })).toBe(false);
  });

  it('rejects snapshot identity drift and duplicate resources', () => {
    const fixture = readFixture('chat-session-v1.json');
    const snapshot = fixture.snapshot;
    expect(contracts.isChatSessionSummary({
      ...snapshot,
      messages: snapshot.messages.map((message, index) => index === 0
        ? { ...message, role: 'assistant' }
        : message),
    })).toBe(false);
    expect(contracts.isChatSessionSummary({
      ...snapshot,
      messages: [...snapshot.messages, snapshot.messages[0]],
      message_count: snapshot.message_count + 1,
    })).toBe(false);
    expect(contracts.isChatSessionSummary({
      ...snapshot,
      items: snapshot.items.filter((item) => item.id !== 'message:message-user-1'),
    })).toBe(false);
    expect(contracts.isChatSessionSummary({
      ...snapshot,
      messages: snapshot.messages.map((message, index) => index === 0
        ? { ...message, status: 'failed' }
        : message),
    })).toBe(false);
    expect(contracts.isChatSessionSummary({
      ...snapshot,
      tool_views: snapshot.tool_views.map((tool) => ({
        ...tool, status: 'succeeded', allowed_actions: [],
      })),
    })).toBe(false);
    expect(contracts.isChatSessionSummary({
      ...snapshot,
      tool_views: [...snapshot.tool_views, snapshot.tool_views[0]],
    })).toBe(false);
  });
});
