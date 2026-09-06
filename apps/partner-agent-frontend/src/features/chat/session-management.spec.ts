import fixture from '@partner-agent/contracts/fixtures/chat-session-v1.json';
import type { ChatSessionSummary } from '@partner-agent/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getChatSession, getTaskStatus } from '../../api/chat-api';
import { useChatStore } from '../../store/chat-store';
import {
  archiveSession, createSession, initializeSession, openSession, renameSession, resetSessionManagement,
  retrySession, useConversationStore,
} from './session-management';
import { sessionReferenceStorage } from './session-store';

vi.mock('../../api/chat-api', () => ({ getChatSession: vi.fn(), getTaskStatus: vi.fn(),
  listChatSessions: vi.fn(), renameChatSession: vi.fn(), archiveChatSession: vi.fn() }));
vi.mock('../../api/agent-stream', () => ({ closeAllAgentStreams: vi.fn() }));
vi.mock('../../api/access-token', () => ({ requireAccessToken: async () => `a.${btoa(JSON.stringify({ sub: 'owner' }))}.b` }));
vi.mock('../../api/config', () => ({ apiConfig: { serverUrl: 'http://server' } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'new-session', CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: async (_: string, value: string) => value }));
vi.mock('./session-store', () => ({ sessionReferenceStorage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }));

const operationId = '11111111-1111-4111-8111-111111111111';
const snapshot = (): ChatSessionSummary => structuredClone(fixture.snapshot) as ChatSessionSummary;
const emptySnapshot = (id = 'session-1'): ChatSessionSummary => ({
  id, created_at: '2026-09-06T08:00:00.000Z', updated_at: '2026-09-06T08:00:00.000Z',
  message_count: 0, items: [], messages: [], tool_views: [],
});

beforeEach(async () => {
  await resetSessionManagement();
  vi.clearAllMocks();
  useChatStore.getState().resetChat();
});

describe('会话恢复与隔离', () => {
  it('opens the shared authoritative snapshot and consumes tool views', async () => {
    vi.mocked(getChatSession).mockResolvedValue(snapshot());
    expect(await openSession('session-1')).toBe(true);
    expect(useChatStore.getState().items).toHaveLength(fixture.snapshot.items.length);
    expect(useChatStore.getState().toolViews).toHaveLength(1);
  });

  it('keeps sending disabled when a snapshot item belongs to another session', async () => {
    const invalid = snapshot();
    invalid.items[0] = { ...invalid.items[0], session_id: 'other-session' };
    vi.mocked(getChatSession).mockResolvedValue(invalid);
    expect(await openSession('session-1')).toBe(false);
    expect(useConversationStore.getState().ready).toBe(false);
    expect(useChatStore.getState().items).toEqual([]);
  });

  it('retries a failed blank conversation without querying a nonexistent session', async () => {
    vi.mocked(sessionReferenceStorage.remove).mockRejectedValueOnce(new Error('storage unavailable'));
    await createSession();
    expect(useConversationStore.getState().ready).toBe(false);
    await retrySession();
    expect(useConversationStore.getState().ready).toBe(true);
    expect(getChatSession).not.toHaveBeenCalled();
  });

  it('cold boot restores only the scoped saved session and its active task', async () => {
    const recovered = emptySnapshot('saved');
    recovered.active_task = { task_id: 'task', operation_id: operationId, state: 'running' };
    vi.mocked(sessionReferenceStorage.get).mockResolvedValue('saved');
    vi.mocked(getChatSession).mockResolvedValue(recovered);
    vi.mocked(getTaskStatus).mockResolvedValue({ task_id: 'task', state: 'running',
      created_at: recovered.created_at, updated_at: recovered.updated_at });
    await initializeSession();
    expect(sessionReferenceStorage.get).toHaveBeenCalledWith(JSON.stringify(['http://server', 'owner']));
    expect(useChatStore.getState()).toMatchObject({ sessionId: 'saved', sessionPersisted: true,
      activeTaskId: 'task', isStreaming: true });
  });

  it('an old open response cannot replace a newly selected session', async () => {
    let resolve!: (value: ChatSessionSummary) => void;
    vi.mocked(getChatSession).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const old = openSession('old');
    await createSession();
    resolve(emptySnapshot('old'));
    expect(await old).toBe(false);
    expect(useChatStore.getState()).toMatchObject({ sessionId: 'new-session', sessionPersisted: false });
  });

  it('logout invalidates an outstanding restore', async () => {
    let resolve!: (value: ChatSessionSummary) => void;
    vi.mocked(getChatSession).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const opening = openSession('old');
    await resetSessionManagement();
    useChatStore.getState().resetChat();
    resolve(emptySnapshot('old'));
    expect(await opening).toBe(false);
    expect(useChatStore.getState().items).toEqual([]);
    expect(sessionReferenceStorage.set).not.toHaveBeenCalled();
  });

  it.each([
    ['rename', renameSession, '旧名称'],
    ['archive', archiveSession, undefined],
  ] as const)('does not publish an old-account %s failure', async (kind, action, title) => {
    let reject!: (reason: Error) => void;
    const request = new Promise<never>((_resolve, fail) => { reject = fail; });
    const api = await import('../../api/chat-api');
    if (kind === 'rename') vi.mocked(api.renameChatSession).mockReturnValueOnce(request);
    else vi.mocked(api.archiveChatSession).mockReturnValueOnce(request);
    const pending = title === undefined ? action('session-1') : action('session-1', title);
    await vi.waitFor(() => expect(kind === 'rename' ? api.renameChatSession : api.archiveChatSession)
      .toHaveBeenCalledOnce());
    await resetSessionManagement();
    reject(new Error('旧账户失败'));

    expect(await pending).toBe(false);
    expect(useConversationStore.getState().error).toBeUndefined();
  });

  it('a failed task lookup remains retryable', async () => {
    const recovered = emptySnapshot('saved');
    recovered.active_task = { task_id: 'task', operation_id: operationId, state: 'running' };
    vi.mocked(getChatSession).mockResolvedValue(recovered);
    vi.mocked(getTaskStatus).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      task_id: 'task', state: 'completed', created_at: recovered.created_at, updated_at: recovered.updated_at,
    });
    expect(await openSession('saved')).toBe(false);
    expect(useConversationStore.getState()).toMatchObject({ ready: false, error: 'offline' });
    expect(await openSession('saved')).toBe(true);
    expect(useChatStore.getState()).toMatchObject({ isStreaming: false, taskStatus: 'completed' });
  });
});
