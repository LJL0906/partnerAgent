import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../../store/chat-store';
import { initializeSession, createSession, openSession, resetSessionManagement, retrySession, useConversationStore } from './session-management';
import { getChatSession, getTaskStatus } from '../../api/chat-api';
import { sessionReferenceStorage } from './session-store';

vi.mock('../../api/chat-api', () => ({ getChatSession: vi.fn(), getTaskStatus: vi.fn(), listChatSessions: vi.fn() }));
vi.mock('../../api/agent-stream', () => ({ closeAllAgentStreams: vi.fn() }));
vi.mock('../../api/access-token', () => ({ requireAccessToken: async () => `a.${btoa(JSON.stringify({ sub: 'owner' }))}.b` }));
vi.mock('../../api/config', () => ({ apiConfig: { serverUrl: 'http://server' } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'new-session', CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async (_: string, value: string) => value }));
vi.mock('./session-store', () => ({ sessionReferenceStorage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }));
const snapshot = (id: string) => ({ id, created_at: '', updated_at: '', message_count: 1, messages: [{ id: `${id}-message`, role: 'user' as const, content: id, created_at: '' }] });

beforeEach(async () => {
  await resetSessionManagement();
  vi.clearAllMocks();
  useChatStore.getState().resetChat();
});

describe('会话恢复与隔离', () => {
  it('opens an authoritative empty items snapshot without reviving legacy messages', async () => {
    vi.mocked(getChatSession).mockResolvedValue({ ...snapshot('saved'), items: [] });
    expect(await openSession('saved')).toBe(true);
    expect(useChatStore.getState().items).toEqual([]);
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('keeps sending disabled when any recovered item belongs to another session', async () => {
    const item = { schema_version: 1 as const, id: 'foreign-item', type: 'message' as const,
      status: 'completed' as const, collapsed: false, created_at: 1, updated_at: 1,
      session_id: 'other-session', payload: { role: 'assistant' as const, content: 'foreign' } };
    vi.mocked(getChatSession).mockResolvedValue({ ...snapshot('saved'), items: [item] });
    expect(await openSession('saved')).toBe(false);
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
  it('cold boot opens only the scoped saved reference and restores an active task', async () => {
    vi.mocked(sessionReferenceStorage.get).mockResolvedValue('saved');
    vi.mocked(getChatSession).mockResolvedValue({ ...snapshot('saved'), active_task: { task_id: 'task', operation_id: 'operation', state: 'running' } });
    vi.mocked(getTaskStatus).mockResolvedValue({ task_id: 'task', state: 'running' });
    await initializeSession();
    expect(sessionReferenceStorage.get).toHaveBeenCalledWith(JSON.stringify(['http://server', 'owner']));
    expect(useChatStore.getState()).toMatchObject({ sessionId: 'saved', sessionPersisted: true, activeTaskId: 'task', isStreaming: true });
    expect(useConversationStore.getState().ready).toBe(true);
  });

  it('an old open response cannot replace a newly selected session', async () => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    vi.mocked(getChatSession).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const old = openSession('old');
    await createSession();
    resolve(snapshot('old'));
    expect(await old).toBe(false);
    expect(useChatStore.getState()).toMatchObject({ sessionId: 'new-session', messages: [], sessionPersisted: false });
  });

  it('logout invalidates an outstanding restore without writing or showing its messages', async () => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    vi.mocked(getChatSession).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const opening = openSession('old');
    await resetSessionManagement();
    useChatStore.getState().resetChat();
    resolve(snapshot('old'));
    expect(await opening).toBe(false);
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useConversationStore.getState().ready).toBe(false);
    expect(sessionReferenceStorage.set).not.toHaveBeenCalled();
  });

  it('a failed task lookup leaves sending disabled and can be retried', async () => {
    vi.mocked(getChatSession).mockResolvedValue({ ...snapshot('saved'), active_task: { task_id: 'task', operation_id: 'operation', state: 'running' } });
    vi.mocked(getTaskStatus).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ task_id: 'task', state: 'completed' });
    expect(await openSession('saved')).toBe(false);
    expect(useConversationStore.getState()).toMatchObject({ ready: false, error: 'offline' });
    expect(await openSession('saved')).toBe(true);
    expect(useChatStore.getState()).toMatchObject({ isStreaming: false, taskStatus: 'completed' });
  });
});
