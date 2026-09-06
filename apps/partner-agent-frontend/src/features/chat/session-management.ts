import { applyChatSessionSnapshot } from './chat-session-snapshot';
import type { ChatSessionListItem } from '@partner-agent/contracts';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';

import { requireAccessToken } from '@/api/access-token';
import { closeAllAgentStreams } from '@/api/agent-stream';
import { archiveChatSession, getChatSession, getTaskStatus, listChatSessions, renameChatSession } from '@/api/chat-api';
import { apiConfig } from '@/api/config';
import { useChatStore } from '@/store/chat-store';

import { applyRecoveredTask } from './chat-event-state';
import { sessionReferenceStorage } from './session-store';

interface SessionState {
  sessions: ChatSessionListItem[];
  loading: boolean;
  opening: boolean;
  error?: string;
  listError?: string;
  ready: boolean;
  lastRefreshedAt?: number;
}
const initial: SessionState = { sessions: [], loading: false, opening: false, ready: false, lastRefreshedAt: undefined };
export const useConversationStore = create<SessionState>(() => initial);
let generation = 0;
let listGeneration = 0;
let scope: string | undefined;
let initialization: Promise<void> | undefined;
let writes = Promise.resolve();
let restoreTarget: string | undefined;

// Decode only for cache partitioning; the server remains the authority for ownership.
export async function getSessionScope(): Promise<string> {
  const token = await requireAccessToken();
  const payload = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
  if (!payload) throw new Error('登录凭据格式无效。');
  const owner = JSON.parse(globalThis.atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))).sub;
  if (typeof owner !== 'string' || !owner) throw new Error('登录凭据缺少用户标识。');
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([apiConfig.serverUrl, owner]));
}

export function rememberSession(id: string): void {
  const savedScope = scope;
  const version = generation;
  if (!savedScope) return;
  writes = writes.catch(() => undefined).then(async () => {
    if (version === generation && scope === savedScope) await sessionReferenceStorage.set(savedScope, id);
  }).catch(() => {
    if (version === generation) useConversationStore.setState({ error: '无法保存会话位置，重启后可从历史列表重新打开。' });
  });
}

export async function refreshSessionList(): Promise<void> {
  const version = generation;
  const request = ++listGeneration;
  useConversationStore.setState({ loading: true, listError: undefined });
  try {
    const result = await listChatSessions();
    if (version === generation && request === listGeneration) {
      useConversationStore.setState({ sessions: result.items, lastRefreshedAt: Date.now(), listError: undefined });
    }
  } catch (error) {
    if (version === generation && request === listGeneration) useConversationStore.setState({ listError: error instanceof Error ? error.message : '会话列表加载失败。' });
  } finally {
    if (version === generation && request === listGeneration) useConversationStore.setState({ loading: false });
  }
}


export async function renameSession(id: string, title: string): Promise<boolean> {
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  const version = generation;
  const ownerScope = scope;
  try {
    const updated = await renameChatSession(id, normalized);
    if (version !== generation) return false;
    useConversationStore.setState((state) => ({ sessions: state.sessions.map((item) => item.id === id ? updated : item), error: undefined }));
    return true;
  } catch (error) {
    if (version === generation && scope === ownerScope) {
      useConversationStore.setState({ error: error instanceof Error ? error.message : '修改会话名称失败。' });
    }
    return false;
  }
}

export async function archiveSession(id: string): Promise<boolean> {
  const version = generation;
  const ownerScope = scope;
  try {
    await archiveChatSession(id);
    if (version !== generation) return false;
    useConversationStore.setState((state) => ({ sessions: state.sessions.filter((item) => item.id !== id), error: undefined }));
    return true;
  } catch (error) {
    if (version === generation && scope === ownerScope) {
      useConversationStore.setState({ error: error instanceof Error ? error.message : '归档会话失败。' });
    }
    return false;
  }
}

export async function openSession(id: string): Promise<boolean> {
  restoreTarget = id;
  const version = ++generation;
  closeAllAgentStreams();
  useChatStore.getState().selectSession(id, false);
  useConversationStore.setState({ opening: true, ready: false, loading: false, error: undefined });
  try {
    const [session, nextScope] = await Promise.all([getChatSession(id), scope ?? getSessionScope()]);
    if (version !== generation) return false;
    scope = nextScope;
    if (session.id !== id) throw new Error('会话标识不匹配。');
    applyChatSessionSnapshot(session, id);
    const ref = session.active_task ?? session.latest_task;
    const task = ref ? await getTaskStatus(ref.task_id) : undefined;
    if (version !== generation) return false;
    if (task && ref && task.task_id !== ref.task_id) throw new Error('任务标识不匹配。');
    const state = useChatStore.getState();
    state.setSessionPersisted(true);
    if (ref && task) {
      state.setActiveTaskId(ref.task_id);
      state.setActiveOperationId(ref.operation_id);
      applyRecoveredTask(task, { current: undefined });
    }
    useConversationStore.setState({ ready: true, opening: false });
    rememberSession(id);
    return true;
  } catch (error) {
    if (version === generation) useConversationStore.setState({ opening: false, error: error instanceof Error ? error.message : '打开会话失败，请重试。' });
    return false;
  }
}

export async function createSession(): Promise<void> {
  restoreTarget = undefined;
  const version = ++generation;
  closeAllAgentStreams();
  useChatStore.getState().selectSession(Crypto.randomUUID(), false);
  useConversationStore.setState({ opening: true, ready: false, loading: false, error: undefined });
  try {
    const nextScope = scope ?? await getSessionScope();
    if (version !== generation) return;
    scope = nextScope;
    // A blank new conversation has no server resource yet. Forget the old selection.
    writes = writes.catch(() => undefined).then(async () => {
      if (version === generation) await sessionReferenceStorage.remove(nextScope);
    });
    await writes;
    if (version === generation) useConversationStore.setState({ opening: false, ready: true });
  } catch (error) {
    if (version === generation) useConversationStore.setState({ opening: false, error: error instanceof Error ? error.message : '新建会话失败。' });
  }
}

export function initializeSession(): Promise<void> {
  if (initialization) return initialization;
  if (useConversationStore.getState().ready) return Promise.resolve();
  const version = generation;
  const pending = (async () => {
    try {
      const nextScope = await getSessionScope();
      if (version !== generation) return;
      scope = nextScope;
      const saved = await sessionReferenceStorage.get(nextScope);
      if (version !== generation) return;
      if (saved) await openSession(saved);
      else await createSession();
    } catch (error) {
      if (version === generation) useConversationStore.setState({ error: error instanceof Error ? error.message : '会话恢复失败。' });
    }
  })().finally(() => { if (initialization === pending) initialization = undefined; });
  initialization = pending;
  return pending;
}

export async function retrySession(): Promise<void> {
  if (restoreTarget) await openSession(restoreTarget);
  else if (useChatStore.getState().sessionId) await createSession();
  else await initializeSession();
}

export async function resetSessionManagement(): Promise<void> {
  ++generation;
  ++listGeneration;
  const previousScope = scope;
  scope = undefined;
  restoreTarget = undefined;
  initialization = undefined;
  useConversationStore.setState(initial, true);
  await writes.catch(() => undefined);
  if (previousScope) await sessionReferenceStorage.remove(previousScope);
}

