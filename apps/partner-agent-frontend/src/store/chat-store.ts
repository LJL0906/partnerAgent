import type { ChatItem, PrivacyDecisionStatus } from '@partner-agent/contracts';
import { create } from 'zustand';

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  thinkingContent?: string;
  createdAt?: string;
  tool?: string;
  toolCallId?: string;
  toolSuccess?: boolean;
}

export type ChatConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'auth_required';
export type ChatTaskStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'waiting_privacy_decision'
  | 'waiting_tool_approval'
  | 'recovering'
  | 'completed'
  | 'cancelled'
  | 'failed';

const TERMINAL_TASK_STATUSES = new Set<ChatTaskStatus>(['completed', 'cancelled', 'failed']);

export function isTerminalTaskStatus(
  status: ChatTaskStatus,
): status is Extract<ChatTaskStatus, 'completed' | 'cancelled' | 'failed'> {
  return TERMINAL_TASK_STATUSES.has(status);
}

/**
 * 服务端任务终态是吸收态：第一个被客户端观察到的终态胜出，之后的迟到事件
 * 不能将它改回进行中，也不能用另一个终态覆盖它。新任务必须通过 beginTask 显式开启。
 */
export function mergeChatTaskStatus(
  current: ChatTaskStatus,
  incoming: ChatTaskStatus,
): ChatTaskStatus {
  if (isTerminalTaskStatus(current)) return current;
  if (current === 'running' && incoming === 'queued') return current;
  return incoming;
}

function hasMatchingContentPrefix(left: ChatMessage, right: ChatMessage): boolean {
  if (left.role !== right.role || (left.role !== 'user' && left.role !== 'assistant')) {
    return false;
  }
  if (left.content === right.content) return true;
  if (!left.content || !right.content) return left.role === 'assistant';
  return left.content.startsWith(right.content) || right.content.startsWith(left.content);
}

/**
 * 将 REST 会话快照合并到本地消息：稳定 id 优先，其次用角色和内容前缀识别
 * 乐观用户消息或流式助手占位；本地 system/tool 消息不会因恢复被清除。
 */
export function mergeChatMessages(
  current: readonly ChatMessage[],
  recovered: readonly ChatMessage[],
): ChatMessage[] {
  const merged = current.map((message) => ({ ...message }));
  const matchedIndexes = new Set<number>();

  for (const recoveredMessage of recovered) {
    let index = merged.findIndex((message) => message.id === recoveredMessage.id);
    if (index < 0) {
      index = merged.findIndex(
        (message, candidateIndex) =>
          !matchedIndexes.has(candidateIndex) &&
          hasMatchingContentPrefix(message, recoveredMessage),
      );
    }

    if (index < 0) {
      merged.push({ ...recoveredMessage });
      matchedIndexes.add(merged.length - 1);
    } else {
      const currentMessage = merged[index];
      const content =
        currentMessage.role === 'assistant' &&
        currentMessage.content.startsWith(recoveredMessage.content)
          ? currentMessage.content
          : recoveredMessage.content;
      merged[index] = { ...currentMessage, ...recoveredMessage, content };
      matchedIndexes.add(index);
    }
  }

  const seenIds = new Set<string>();
  return merged.filter((message) => {
    if (seenIds.has(message.id)) return false;
    seenIds.add(message.id);
    return true;
  });
}

export interface ChatState {
  sessionId: string;
  sessionRevision: number;
  sessionPersisted: boolean;
  selectSession: (sessionId: string, persisted: boolean) => void;
  setSessionPersisted: (persisted: boolean) => void;
  activeTaskId?: string;
  activeOperationId?: string;
  items: ChatItem[];
  messages: ChatMessage[];
  isStreaming: boolean;
  isThinking: boolean;
  connectionStatus: ChatConnectionStatus;
  taskStatus: ChatTaskStatus;
  privacyDecision?: PrivacyDecisionStatus;
  setSessionId: (sessionId: string) => void;
  setActiveTaskId: (activeTaskId?: string) => void;
  setActiveOperationId: (activeOperationId?: string) => void;
  setConnectionStatus: (connectionStatus: ChatConnectionStatus) => void;
  beginTask: () => void;
  setTaskStatus: (taskStatus: ChatTaskStatus) => boolean;
  setPrivacyDecision: (privacyDecision?: PrivacyDecisionStatus) => void;
  setStreaming: (isStreaming: boolean) => void;
  setThinking: (isThinking: boolean) => void;
  upsertItem: (item: ChatItem) => void;
  replaceItems: (items: ChatItem[]) => void;
  addMessage: (message: ChatMessage) => void;
  bindOptimisticMessageId: (optimisticId: string, stableId: string) => void;
  appendAssistantContent: (id: string, content: string) => void;
  appendThinkingContent: (id: string, content: string) => void;
  completeTool: (toolCallId: string, success: boolean) => void;
  reconcileMessages: (messages: ChatMessage[]) => void;
  replaceMessages: (messages: ChatMessage[]) => void;
  resetChat: () => void;
}


const TERMINAL_ITEM_STATUSES = new Set(['completed', 'failed', 'cancelled', 'dismissed', 'expired']);
function itemScopeMatches(item: ChatItem, state: Pick<ChatState, 'sessionId' | 'activeTaskId' | 'activeOperationId'>): boolean {
  return (!item.session_id || item.session_id === state.sessionId)
    && (!item.task_id || !state.activeTaskId || item.task_id === state.activeTaskId)
    && (!item.operation_id || !state.activeOperationId || item.operation_id === state.activeOperationId);
}
function mergeItem(current: ChatItem, incoming: ChatItem): ChatItem {
  if (current.type !== incoming.type) return incoming;
  const status = TERMINAL_ITEM_STATUSES.has(current.status) ? current.status : incoming.status;
  switch (current.type) {
    case 'thinking':
      if (incoming.type !== 'thinking') return incoming;
      return { ...current, ...incoming, status, payload: { ...current.payload, ...incoming.payload, text: `${current.payload.text}${incoming.payload.text}` } };
    case 'message':
      if (incoming.type !== 'message') return incoming;
      return { ...current, ...incoming, status, payload: { ...current.payload, ...incoming.payload, content: current.status === 'streaming' && incoming.status === 'streaming' ? `${current.payload.content}${incoming.payload.content}` : incoming.payload.content } } as ChatItem;
    case 'tool':
      if (incoming.type !== 'tool') return incoming;
      return { ...current, ...incoming, status, payload: { ...current.payload, ...incoming.payload } };
    case 'approval':
      if (incoming.type !== 'approval') return incoming;
      return { ...current, ...incoming, status, payload: { ...current.payload, ...incoming.payload } };
    default:
      return incoming;
  }
}function itemsToMessages(items: readonly ChatItem[]): ChatMessage[] {
  return items.flatMap((item): ChatMessage[] => {
    if (item.type === 'message') return [{ id: item.id, role: item.payload.role, content: item.payload.content, ...(item.created_at > 1000000000000 ? { createdAt: new Date(item.created_at).toISOString() } : {}) }];
    if (item.type === 'thinking') return [];
    if (item.type === 'tool') return [{ id: item.id, role: 'tool', content: item.payload.output_summary ?? item.payload.input_summary ?? '正在执行' , tool: item.payload.tool, toolCallId: item.tool_call_id, toolSuccess: item.status === 'completed' ? true : item.status === 'failed' ? false : undefined }];
    if (item.type === 'system' || item.type === 'error') return [{ id: item.id, role: 'system', content: item.payload.message }];
    return [];
  });
}
function sortItems(items: readonly ChatItem[]): ChatItem[] { return [...items].sort((a, b) => (a.sequence ?? a.created_at) - (b.sequence ?? b.created_at) || a.id.localeCompare(b.id)); }

function chatMessageToItem(message: ChatMessage, sessionId?: string, index = 0): ChatItem {
  const isTool = message.role === 'tool';
  const role = isTool ? 'system' : message.role;
  return { schema_version: 1, id: message.id, type: isTool ? 'tool' : 'message', status: 'completed', collapsed: isTool, created_at: message.createdAt ? Date.parse(message.createdAt) : 0, updated_at: message.createdAt ? Date.parse(message.createdAt) : 0, sequence: index + 1, session_id: sessionId, tool_call_id: message.toolCallId, payload: isTool ? { tool: message.tool ?? 'tool', output_summary: message.content } : { role, content: message.content, format: 'text' } } as ChatItem;
}

const INITIAL_CHAT_STATE = {
  sessionId: '',
  sessionRevision: 0,
  sessionPersisted: false,
  activeTaskId: undefined,
  activeOperationId: undefined,
  items: [] as ChatItem[],
  messages: [] as ChatMessage[],
  isStreaming: false,
  isThinking: false,
  connectionStatus: 'idle' as ChatConnectionStatus,
  taskStatus: 'idle' as ChatTaskStatus,
  privacyDecision: undefined,
};

export const useChatStore = create<ChatState>((set) => ({
  ...INITIAL_CHAT_STATE,
  setSessionId: (sessionId) => set({ sessionId }),
  selectSession: (sessionId, sessionPersisted) => set((state) => ({ ...INITIAL_CHAT_STATE, items: [], messages: [], sessionId, sessionPersisted, sessionRevision: state.sessionRevision + 1 })),
  setSessionPersisted: (sessionPersisted) => set({ sessionPersisted }),
  setActiveTaskId: (activeTaskId) => set({ activeTaskId }),
  setActiveOperationId: (activeOperationId) => set({ activeOperationId }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  beginTask: () =>
    set({
      activeTaskId: undefined,
      activeOperationId: undefined,
      isStreaming: true,
      isThinking: true,
      taskStatus: 'queued',
      privacyDecision: undefined,
    }),
  setTaskStatus: (taskStatus) => {
    let accepted = false;
    set((state) => {
      const mergedStatus = mergeChatTaskStatus(state.taskStatus, taskStatus);
      accepted = mergedStatus === taskStatus;
      if (mergedStatus === state.taskStatus) return state;
      return {
        taskStatus: mergedStatus,
        ...(mergedStatus === 'waiting_privacy_decision'
          ? {}
          : { privacyDecision: undefined }),
      };
    });
    return accepted;
  },
  setPrivacyDecision: (privacyDecision) => set({ privacyDecision }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setThinking: (isThinking) => set({ isThinking }),
  upsertItem: (item) => set((state) => {
    if (!itemScopeMatches(item, state)) return state;
    const existing = state.items.find((current) => {
      if (current.id === item.id) return true;
      if (current.type !== 'tool' || item.type !== 'tool') return false;
      return (current.tool_call_id !== undefined && current.tool_call_id === item.tool_call_id)
        || (current.execution_id !== undefined && current.execution_id === item.execution_id);
    });
    const next = existing
      ? state.items.map((current) => current.id === existing.id ? mergeItem(current, { ...item, id: existing.id }) : current)
      : [...state.items, item];
    const items = sortItems(next);
    return { items, messages: itemsToMessages(items) };
  }),
  replaceItems: (items) => set((state) => {
    const next = new Map<string, ChatItem>();
    // A session snapshot contains history from multiple tasks. Active-task filtering
    // applies to live events, not to the authenticated session recovery response.
    for (const item of items) {
      if (item.session_id && item.session_id !== state.sessionId) continue;
      next.set(item.id, next.has(item.id) ? mergeItem(next.get(item.id)!, item) : item);
    }
    const sorted = sortItems([...next.values()]);
    return { items: sorted, messages: itemsToMessages(sorted) };
  }),
  addMessage: (message) => set((state) => {
    const item: ChatItem = { schema_version: 1, id: message.id, type: message.role === 'tool' ? 'tool' : 'message', status: 'streaming', collapsed: message.role === 'assistant' ? false : true, created_at: message.createdAt ? Date.parse(message.createdAt) : Date.now(), updated_at: Date.now(), session_id: state.sessionId || undefined, task_id: state.activeTaskId, operation_id: state.activeOperationId, tool_call_id: message.toolCallId, payload: message.role === 'tool' ? { tool: message.tool ?? 'tool', output_summary: message.content } : { role: message.role, content: message.content, format: 'text' } } as ChatItem;
    const existing = state.items.find((current) => current.id === item.id);
    const items = existing
      ? sortItems(state.items.map((current) => current.id === existing.id
        ? current.type === 'message' && item.type === 'message'
          ? { ...current, ...item, payload: item.payload }
          : mergeItem(current, item)
        : current))
      : sortItems([...state.items, item]);
    return { items, messages: itemsToMessages(items) };
  }),
  bindOptimisticMessageId: (optimisticId, stableId) =>
    set((state) => {
      const optimistic = state.messages.find(
        (message) => message.id === optimisticId && message.role === 'user',
      );
      if (!optimistic || optimisticId === stableId) return state;

      const stableMessage = state.messages.find((message) => message.id === stableId);
      const messages = stableMessage
        ? state.messages.filter((message) => message.id !== optimisticId)
        : state.messages.map((message) => message.id === optimisticId ? { ...message, id: stableId } : message);
      const optimisticItem = state.items.find((item) => item.id === optimisticId);
      const stableItem = state.items.find((item) => item.id === stableId);
      const items = optimisticItem
        ? stableItem
          ? state.items.filter((item) => item.id !== optimisticId)
          : state.items.map((item) => item.id === optimisticId ? { ...item, id: stableId, message_id: stableId } as ChatItem : item)
        : state.items;
      return { items, messages };
    }),
  appendThinkingContent: (id, content) => set((state) => {
    const existing = state.items.find((item) => item.type === 'thinking' && item.id === `thinking:${id}`);
    const items = existing
      ? state.items.map((item) => item.id === existing.id ? { ...item, updated_at: Date.now(), payload: { ...item.payload, text: `${(item.payload as { text?: string }).text ?? ''}${content}` } } as ChatItem : item)
      : [...state.items, { schema_version: 1, id: `thinking:${id}`, type: 'thinking', status: 'streaming', collapsed: true, created_at: Date.now(), updated_at: Date.now(), session_id: state.sessionId || undefined, task_id: state.activeTaskId, operation_id: state.activeOperationId, payload: { text: content, display: 'progress' } } as ChatItem];
    const messages = state.messages.map((message) => message.id === id ? { ...message, thinkingContent: `${message.thinkingContent ?? ''}${content}` } : message);
    return { items: sortItems(items), messages: itemsToMessages(items).map((message) => message.id === id ? { ...message, thinkingContent: messages.find((entry) => entry.id === id)?.thinkingContent } : message) };
  }),
  appendAssistantContent: (id, content) => set((state) => {
    const items = state.items.map((item) => item.id === id && item.type === 'message' ? { ...item, updated_at: Date.now(), payload: { ...item.payload, content: `${item.payload.content}${content}` } } as ChatItem : item);
    const messages = state.messages.map((message) => message.id === id ? { ...message, content: `${message.content}${content}` } : message);
    return { items, messages: items.length ? itemsToMessages(items) : messages };
  }),
  completeTool: (toolCallId, success) =>
    set((state) => {
      const items = state.items.map((item) => item.type === 'tool' && item.tool_call_id === toolCallId
        ? { ...item, status: success ? 'completed' : 'failed', updated_at: Date.now() }
        : item) as ChatItem[];
      return { items, messages: itemsToMessages(items) };
    }),
  reconcileMessages: (messages) => set((state) => {
    const mergedMessages = mergeChatMessages(state.messages, messages);
    const nonMessageItems = state.items.filter((item) => item.type !== 'message' && item.type !== 'tool');
    const messageItems = mergedMessages.map((message, index) => chatMessageToItem(message, state.sessionId, index));
    const items = sortItems([...nonMessageItems, ...messageItems]);
    return { items, messages: mergedMessages };
  }),
  replaceMessages: (messages) => set((state) => {
    const nonMessageItems = state.items.filter((item) => item.type !== 'message' && item.type !== 'tool');
    const messageItems = messages.map((message, index) => chatMessageToItem(message, state.sessionId, index));
    const items = sortItems([...nonMessageItems, ...messageItems]);
    return { items, messages: messages.map((message) => ({ ...message })) };
  }),
  resetChat: () => set((state) => ({ ...INITIAL_CHAT_STATE, items: [], messages: [], sessionRevision: state.sessionRevision + 1 })),
}));





