import type { ChatSessionListItem } from '@partner-agent/contracts';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';

import { requireAccessToken } from '@/api/access-token';
import { closeAllAgentStreams } from '@/api/agent-stream';
import { getChatSession, getTaskStatus, listChatSessions } from '@/api/chat-api';
import { apiConfig } from '@/api/config';
import { useChatStore } from '@/store/chat-store';

import { applyRecoveredTask } from './chat-event-state';
import { sessionReferenceStorage } from './会话存储';

interface SessionState {
  sessions: ChatSessionListItem[];
  loading: boolean;
  opening: boolean;
  error?: string;
  ready: boolean;
}
const initial: SessionState = { sessions: [], loading: false, opening: false, ready: false };
export const useConversationStore = create<SessionState>(() => initial);
let generation = 0;
let listGeneration = 0;
let scope: string | undefined;
let initialization: Promise<void> | undefined;
let writes = Promise.resolve();
let restoreTarget: string | undefined;

// Decode only for cache partitioning; the server remains the authority for ownership.
export async function get会话Scope(): Promise<string> {
  const token = await requireAccessToken();
  const payload = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
  if (!payload) throw new Error('登录凭据格式无效。');
  const owner = JSON.parse(globalThis.atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))).sub;
  if (typeof owner !== 'string' || !owner) throw new Error('登录凭据缺少用户标识。');
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([apiConfig.serverUrl, owner]));
}

export function remember会话(id: string): void {
  const savedScope = scope;
  const version = generation;
  if (!savedScope) return;
  writes = writes.catch(() => undefined).then(async () => {
    if (version === generation && scope === savedScope) await sessionReferenceStorage.set(savedScope, id);
  }).catch(() => {
    if (version === generation) useConversationStore.setState({ error: '无法保存会话位置，重启后可从历史列表重新打开。' });
  });
}

export async function refresh会话列表(): Promise<void> {
  const version = generation;
  const request = ++listGeneration;
  useConversationStore.setState({ loading: true, error: undefined });
  try {
    const result = await listChatSessions();
    if (version === generation && request === listGeneration) useConversationStore.setState({ sessions: result.items });
  } catch (error) {
    if (version === generation && request === listGeneration) useConversationStore.setState({ error: error instanceof Error ? error.message : '会话列表加载失败。' });
  } finally {
    if (version === generation && request === listGeneration) useConversationStore.setState({ loading: false });
  }
}

export async function open会话(id: string): Promise<boolean> {
  restoreTarget = id;
  const version = ++generation;
  closeAllAgentStreams();
  useChatStore.getState().selectSession(id, false);
  useConversationStore.setState({ opening: true, ready: false, loading: false, error: undefined });
  try {
    const [session, nextScope] = await Promise.all([getChatSession(id), scope ?? get会话Scope()]);
    if (version !== generation) return false;
    scope = nextScope;
    if (session.id !== id) throw new Error('会话标识不匹配。');
    useChatStore.getState().reconcileMessages(session.messages.map(({ id, role, content }) => ({ id, role, content })));
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
    remember会话(id);
    return true;
  } catch (error) {
    if (version === generation) useConversationStore.setState({ opening: false, error: error instanceof Error ? error.message : '打开会话失败，请重试。' });
    return false;
  }
}

export async function new会话(): Promise<void> {
  restoreTarget = undefined;
  const version = ++generation;
  closeAllAgentStreams();
  useChatStore.getState().selectSession(Crypto.randomUUID(), false);
  useConversationStore.setState({ opening: true, ready: false, loading: false, error: undefined });
  try {
    const nextScope = scope ?? await get会话Scope();
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

export function initialize会话(): Promise<void> {
  if (initialization) return initialization;
  if (useConversationStore.getState().ready) return Promise.resolve();
  const version = generation;
  const pending = (async () => {
    try {
      const nextScope = await get会话Scope();
      if (version !== generation) return;
      scope = nextScope;
      const saved = await sessionReferenceStorage.get(nextScope);
      if (version !== generation) return;
      if (saved) await open会话(saved);
      else await new会话();
    } catch (error) {
      if (version === generation) useConversationStore.setState({ error: error instanceof Error ? error.message : '会话恢复失败。' });
    }
  })().finally(() => { if (initialization === pending) initialization = undefined; });
  initialization = pending;
  return pending;
}

export async function retry会话(): Promise<void> {
  if (restoreTarget) await open会话(restoreTarget);
  else if (useChatStore.getState().sessionId) await new会话();
  else await initialize会话();
}

export async function reset会话管理(): Promise<void> {
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
