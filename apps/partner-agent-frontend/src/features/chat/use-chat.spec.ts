import fixture from '@partner-agent/contracts/fixtures/chat-session-v1.json';
import type { ChatSessionSummary, TaskStatus } from '@partner-agent/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '../../store/chat-store';
import { toPrivacyDecisionSummary } from './chat-event-state';
import {
  adoptPendingSubmissionSession, createUseChatToolControls, desiredChannels,
  findAuthoritativeUserMessageId, initialChatChannels,
  loadChatReconciliation, reconcileChatFromRest,
} from './use-chat';

vi.mock('expo-constants', () => ({ default: { expoConfig: undefined, expoGoConfig: undefined } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'local-message' }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' }, AppState: { addEventListener: vi.fn() } }));

const snapshot = (): ChatSessionSummary => structuredClone(fixture.snapshot) as ChatSessionSummary;
const task = (state: TaskStatus['state'] = 'running'): TaskStatus => ({
  task_id: 'task-1', state, created_at: '2026-09-06T08:00:00.000Z',
  updated_at: '2026-09-06T08:01:00.000Z',
});
const queries = (session: ChatSessionSummary) => ({
  getTaskStatus: vi.fn(async () => task()), getChatSession: vi.fn(async () => session),
});

beforeEach(() => {
  useChatStore.getState().resetChat();
  useChatStore.getState().selectSession('session-1', true);
});

describe('chat subscription bootstrap', () => {
  it('starts owner-only and adds authoritative resource channels after acceptance', () => {
    expect(initialChatChannels()).toEqual(['user:self']);
    expect(desiredChannels('session-1', 'task-1', '11111111-1111-4111-8111-111111111111'))
      .toEqual(['user:self', 'session:session-1', 'task:task-1',
        'operation:11111111-1111-4111-8111-111111111111']);
  });

  it('starts task and session reconciliation requests together', async () => {
    const started: string[] = [];
    const pendingTask = new Promise<TaskStatus>(() => undefined);
    const pendingSession = new Promise<ChatSessionSummary>(() => undefined);
    void loadChatReconciliation('task-1', 'session-1', {
      getTaskStatus: vi.fn(() => { started.push('task'); return pendingTask; }),
      getChatSession: vi.fn(() => { started.push('session'); return pendingSession; }),
    });
    expect(started).toEqual(['task', 'session']);
  });
});

describe('revision-aware REST reconciliation', () => {
  it('consumes the shared fixture including its authoritative tool view', async () => {
    await reconcileChatFromRest(undefined, 'session-1', { queries: queries(snapshot()) });
    expect(useChatStore.getState().items).toHaveLength(fixture.snapshot.items.length);
    expect(useChatStore.getState().toolViews).toHaveLength(1);
  });

  it('recovers the persisted structured preview repeatedly without duplicating it', async () => {
    await reconcileChatFromRest(undefined, 'session-1', { queries: queries(snapshot()) });
    await reconcileChatFromRest(undefined, 'session-1', { queries: queries(snapshot()) });

    const previews = useChatStore.getState().items.filter((item) => item.type === 'structured_preview');
    const fixturePreview = fixture.snapshot.items.find((item) => item.type === 'structured_preview');
    expect(previews).toHaveLength(1);
    expect(previews[0]).toEqual(fixturePreview);
  });

  it('does not let a late older snapshot overwrite a newer realtime item', async () => {
    const current = snapshot().items.find((item) => item.id === 'task:task-1:assistant')!;
    if (current.type !== 'message') throw new Error('fixture assistant item missing');
    useChatStore.getState().upsertItem({ ...current, revision: 4, updated_at: current.updated_at + 1,
      status: 'streaming', payload: { ...current.payload, content: '实时新正文' } });
    await reconcileChatFromRest(undefined, 'session-1', { queries: queries(snapshot()) });
    expect(useChatStore.getState().items.find((item) => item.id === current.id))
      .toMatchObject({ revision: 4, payload: { content: '实时新正文' } });
  });

  it('rejects malformed snapshots without mutating current items but still applies a valid task', async () => {
    const current = snapshot().items[0];
    useChatStore.getState().upsertItem(current);
    const result = await reconcileChatFromRest('task-1', 'session-1', {
      queries: { getTaskStatus: vi.fn(async () => ({ ...task('failed'), error: '权威失败' })),
        getChatSession: vi.fn(async () => ({ ...snapshot(), items: [{ bad: true }] } as never)) },
    });
    expect(result[1].status).toBe('rejected');
    expect(useChatStore.getState().items).toContainEqual(current);
    expect(useChatStore.getState().taskStatus).toBe('failed');
  });

  it('discards a snapshot that resolves after switching sessions', async () => {
    let resolve!: (value: ChatSessionSummary) => void;
    const waiting = new Promise<ChatSessionSummary>((done) => { resolve = done; });
    const reconciling = reconcileChatFromRest(undefined, 'session-1', {
      queries: { getTaskStatus: vi.fn(), getChatSession: vi.fn(() => waiting) },
    });
    useChatStore.getState().selectSession('session-2', false);
    resolve(snapshot());
    await reconciling;
    expect(useChatStore.getState().items).toEqual([]);
  });

  it('adopts an authoritative active task and replaces its optimistic user item', async () => {
    const operationId = '11111111-1111-4111-8111-111111111111';
    const recovered = snapshot();
    recovered.active_task = { task_id: 'task-1', operation_id: operationId, state: 'running' };
    const state = useChatStore.getState();
    state.beginTask();
    state.setActiveOperationId(operationId);
    state.addMessage({ id: 'optimistic-user', role: 'user', content: '帮我安排周一提交周报' });
    state.setTaskStatus('recovering');

    await reconcileChatFromRest(undefined, 'session-1', { queries: queries(recovered) });

    expect(useChatStore.getState()).toMatchObject({ activeTaskId: 'task-1',
      activeOperationId: operationId, taskStatus: 'running', isStreaming: true });
    expect(useChatStore.getState().messages.filter((message) => message.role === 'user')).toEqual([
      expect.objectContaining({ id: 'message:message-user-1' }),
    ]);
  });

  it('clears recovering when the accepted operation already completed before reconciliation', async () => {
    const operationId = '11111111-1111-4111-8111-111111111111';
    const recovered = snapshot();
    recovered.latest_task = { task_id: 'task-1', operation_id: operationId, state: 'completed' };
    const state = useChatStore.getState();
    state.beginTask();
    state.setActiveOperationId(operationId);
    state.addMessage({ id: 'optimistic-user', role: 'user', content: '帮我安排周一提交周报' });
    state.setTaskStatus('recovering');

    await reconcileChatFromRest(undefined, 'session-1', { queries: queries(recovered) });

    expect(useChatStore.getState()).toMatchObject({ activeTaskId: undefined,
      activeOperationId: undefined, taskStatus: 'completed', isStreaming: false });
    expect(useChatStore.getState().messages.filter((message) => message.role === 'user')).toHaveLength(1);
  });

  it('finds an authoritative user message in a legal legacy snapshot without items', () => {
    const legacy = { ...snapshot(), items: undefined };
    expect(findAuthoritativeUserMessageId(legacy, '11111111-1111-4111-8111-111111111111'))
      .toBe('message-user-1');
  });

  it('adopts a server session only for a matching pending owner-scoped event', () => {
    useChatStore.getState().selectSession('local-session', false);
    const pending = { inputId: 'input-1', operationId: '11111111-1111-4111-8111-111111111111',
      optimisticMessageId: 'local-user', sessionId: 'local-session', text: '消息', outputMode: 'chat' as const };
    const event = { schema_version: 1 as const, event_id: 'accepted', channel: 'user:self' as const,
      sequence: 1, session_id: 'server-session', task_id: 'task-1',
      operation_id: pending.operationId, event_type: 'done' as const, timestamp: 1, data: {} };
    expect(adoptPendingSubmissionSession(event, pending, '__pending_task__')).toBe(true);
    expect(useChatStore.getState()).toMatchObject({ sessionId: 'server-session', sessionPersisted: true });
    expect(pending.sessionId).toBe('server-session');

    useChatStore.getState().selectSession('another-local', false);
    expect(adoptPendingSubmissionSession({ ...event,
      operation_id: '22222222-2222-4222-8222-222222222222' }, pending, '__pending_task__')).toBe(false);
    expect(useChatStore.getState().sessionId).toBe('another-local');
  });
});

describe('privacy and tool projections', () => {
  it('keeps only safe privacy fields and known categories', () => {
    expect(toPrivacyDecisionSummary({ egress_id: 'egress-1', categories: ['secret', 'raw'] as never,
      provider: 'provider', model_id: 'model', expires_at: '2026-09-06T09:00:00.000Z',
      raw_payload: 'hidden' } as never)).toEqual({ egress_id: 'egress-1', categories: ['secret'],
      provider: 'provider', model_id: 'model', expires_at: '2026-09-06T09:00:00.000Z' });
  });

  it('passes stable tool resource ids to the injected transport', async () => {
    const transport = { confirmTool: vi.fn(async () => ({ request_id: 'r1', action: 'confirm' as const,
      status: 'completed' as const })), dismissTool: vi.fn(), undoTool: vi.fn() };
    const controls = createUseChatToolControls(() => 'session-1', () => transport);
    await controls.confirmTool('confirmation-1');
    expect(transport.confirmTool).toHaveBeenCalledWith({ session_id: 'session-1', confirmation_id: 'confirmation-1' });
  });
});
