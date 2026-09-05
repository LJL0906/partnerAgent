import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../../store/chat-store';
import { initialize会话, new会话, open会话, reset会话管理, retry会话, useConversationStore } from './会话管理';
import { getChatSession, getTaskStatus } from '../../api/chat-api';
import { sessionReferenceStorage } from './会话存储';

vi.mock('../../api/chat-api', () => ({ getChatSession: vi.fn(), getTaskStatus: vi.fn(), listChatSessions: vi.fn() }));
vi.mock('../../api/agent-stream', () => ({ closeAllAgentStreams: vi.fn() }));
vi.mock('../../api/access-token', () => ({ requireAccessToken: async () => `a.${btoa(JSON.stringify({ sub: 'owner' }))}.b` }));
vi.mock('../../api/config', () => ({ apiConfig: { serverUrl: 'http://server' } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'new-session', CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async (_: string, value: string) => value }));
vi.mock('./会话存储', () => ({ sessionReferenceStorage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }));
const snapshot = (id: string) => ({ id, created_at: '', updated_at: '', message_count: 1, messages: [{ id: `${id}-message`, role: 'user' as const, content: id, created_at: '' }] });

beforeEach(async () => {
  await reset会话管理();
  vi.clearAllMocks();
  useChatStore.getState().resetChat();
});

describe('会话恢复与隔离', () => {
  it('retries a failed blank conversation without querying a nonexistent session', async () => {
    vi.mocked(sessionReferenceStorage.remove).mockRejectedValueOnce(new Error('storage unavailable'));
    await new会话();
    expect(useConversationStore.getState().ready).toBe(false);
    await retry会话();
    expect(useConversationStore.getState().ready).toBe(true);
    expect(getChatSession).not.toHaveBeenCalled();
  });
  it('cold boot opens only the scoped saved reference and restores an active task', async () => {
    vi.mocked(sessionReferenceStorage.get).mockResolvedValue('saved');
    vi.mocked(getChatSession).mockResolvedValue({ ...snapshot('saved'), active_task: { task_id: 'task', operation_id: 'operation', state: 'running' } });
    vi.mocked(getTaskStatus).mockResolvedValue({ task_id: 'task', state: 'running' });
    await initialize会话();
    expect(sessionReferenceStorage.get).toHaveBeenCalledWith(JSON.stringify(['http://server', 'owner']));
    expect(useChatStore.getState()).toMatchObject({ sessionId: 'saved', sessionPersisted: true, activeTaskId: 'task', isStreaming: true });
    expect(useConversationStore.getState().ready).toBe(true);
  });

  it('an old open response cannot replace a newly selected session', async () => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    vi.mocked(getChatSession).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const old = open会话('old');
    await new会话();
    resolve(snapshot('old'));
    expect(await old).toBe(false);
    expect(useChatStore.getState()).toMatchObject({ sessionId: 'new-session', messages: [], sessionPersisted: false });
  });

  it('logout invalidates an outstanding restore without writing or showing its messages', async () => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    vi.mocked(getChatSession).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const opening = open会话('old');
    await reset会话管理();
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
    expect(await open会话('saved')).toBe(false);
    expect(useConversationStore.getState()).toMatchObject({ ready: false, error: 'offline' });
    expect(await open会话('saved')).toBe(true);
    expect(useChatStore.getState()).toMatchObject({ isStreaming: false, taskStatus: 'completed' });
  });
});
