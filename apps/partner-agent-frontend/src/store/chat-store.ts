import {
  chatItemIds,
  sessionMessageStatusToChatItemStatus,
  type ChatItem,
  type PrivacyDecisionStatus,
  type SessionMessageDto,
  type SessionToolView,
  type TaskState,
  type TaskTodoItemV1,
} from '@partner-agent/contracts';
import { create, type StoreApi } from 'zustand';

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  format?: 'markdown' | 'text';
  thinkingContent?: string;
  createdAt?: string;
  tool?: string;
  toolCallId?: string;
  toolSuccess?: boolean;
}

export type ChatConnectionStatus =
  | 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'auth_required';
export type ChatTaskStatus = TaskState | 'idle' | 'cancelling' | 'recovering';

const TERMINAL_TASK_STATUSES = new Set<ChatTaskStatus>(['completed', 'cancelled', 'failed']);
export const LOCAL_ITEM_REVISION = 0;

export function isTerminalTaskStatus(
  status: ChatTaskStatus,
): status is Extract<ChatTaskStatus, 'completed' | 'cancelled' | 'failed'> {
  return TERMINAL_TASK_STATUSES.has(status);
}

export function mergeChatTaskStatus(current: ChatTaskStatus, incoming: ChatTaskStatus): ChatTaskStatus {
  if (isTerminalTaskStatus(current)) return current;
  if (current === 'running' && incoming === 'queued') return current;
  return incoming;
}

export type DeltaApplyResult = 'applied' | 'ignored' | 'recovery_required';

export interface TextDeltaInput {
  itemId: string;
  itemRevision: number;
  messageId: string;
  textOffset: number;
  data: string;
  sessionId?: string;
  taskId?: string;
  operationId?: string;
  timestamp: number;
}

export type ThinkingDeltaInput = Omit<TextDeltaInput, 'messageId'>;

interface ChatState {
  sessionId: string;
  sessionRevision: number;
  sessionPersisted: boolean;
  activeTaskId?: string;
  activeOperationId?: string;
  todoTaskId?: string;
  taskTodos: TaskTodoItemV1[];
  items: ChatItem[];
  toolViews: SessionToolView[];
  isStreaming: boolean;
  isThinking: boolean;
  connectionStatus: ChatConnectionStatus;
  taskStatus: ChatTaskStatus;
  privacyDecision?: PrivacyDecisionStatus;
  selectSession: (sessionId: string, persisted: boolean) => void;
  setSessionId: (sessionId: string) => void;
  setSessionPersisted: (persisted: boolean) => void;
  setActiveTaskId: (activeTaskId?: string) => void;
  setActiveOperationId: (activeOperationId?: string) => void;
  setTaskTodos: (taskId: string, items: TaskTodoItemV1[]) => void;
  clearTaskTodos: () => void;
  setConnectionStatus: (status: ChatConnectionStatus) => void;
  beginTask: () => void;
  setTaskStatus: (status: ChatTaskStatus) => boolean;
  setPrivacyDecision: (decision?: PrivacyDecisionStatus) => void;
  setStreaming: (streaming: boolean) => void;
  setThinking: (thinking: boolean) => void;
  upsertItem: (item: ChatItem) => void;
  mergeSnapshot: (items: ChatItem[], toolViews: SessionToolView[]) => void;
  mergeSessionMessages: (messages: SessionMessageDto[]) => void;
  addMessage: (message: ChatMessage) => void;
  bindOptimisticMessageId: (optimisticId: string, stableMessageId: string) => void;
  clearSubmissionNotice: (operationId: string) => void;
  resetChat: () => void;
}

export type ChatStateView = ChatState & { readonly messages: ChatMessage[] };

const INITIAL_CHAT_STATE = {
  sessionId: '', sessionRevision: 0, sessionPersisted: false,
  activeTaskId: undefined, activeOperationId: undefined,
  todoTaskId: undefined, taskTodos: [] as TaskTodoItemV1[],
  items: [] as ChatItem[], toolViews: [] as SessionToolView[],
  isStreaming: false, isThinking: false,
  connectionStatus: 'idle' as ChatConnectionStatus,
  taskStatus: 'idle' as ChatTaskStatus,
  privacyDecision: undefined,
};

function sortItems(items: readonly ChatItem[]): ChatItem[] {
  const chronological = [...items].sort((left, right) =>
    (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER)
    || left.created_at - right.created_at
    || left.id.localeCompare(right.id));
  const thinkingByTask = new Map<string, ChatItem[]>();
  const followupsByTask = new Map<string, ChatItem[]>();
  const unboundThinking: ChatItem[] = [];
  for (const item of chronological) {
    if (item.type === 'thinking') {
      if (!item.task_id) {
        unboundThinking.push(item);
        continue;
      }
      const taskItems = thinkingByTask.get(item.task_id) ?? [];
      taskItems.push(item);
      thinkingByTask.set(item.task_id, taskItems);
    } else if ((item.type === 'structured_preview' || item.type === 'candidate') && item.task_id) {
      const taskItems = followupsByTask.get(item.task_id) ?? [];
      taskItems.push(item);
      followupsByTask.set(item.task_id, taskItems);
    }
  }
  const ordered: ChatItem[] = [];
  for (const item of chronological) {
    if (item.type === 'thinking'
      || ((item.type === 'structured_preview' || item.type === 'candidate') && item.task_id)) continue;
    if (item.type === 'message' && item.payload.role === 'assistant' && item.task_id) {
      const thinking = thinkingByTask.get(item.task_id);
      if (thinking) {
        ordered.push(...thinking);
        thinkingByTask.delete(item.task_id);
      }
      ordered.push(item);
      const followups = followupsByTask.get(item.task_id);
      if (followups) {
        ordered.push(...followups);
        followupsByTask.delete(item.task_id);
      }
      continue;
    }
    ordered.push(item);
  }
  return [
    ...ordered,
    ...unboundThinking,
    ...thinkingByTask.values(),
    ...followupsByTask.values(),
  ].flat();
}

function mergeItem(current: ChatItem, incoming: ChatItem): ChatItem {
  if (current.type === 'candidate' && incoming.type === 'candidate'
    && incoming.revision === current.revision
    && incoming.payload.batch_ref && !current.payload.batch_ref) return incoming;
  if (incoming.revision <= current.revision) return current;
  if (current.type === 'tool' && incoming.type === 'tool') {
    return { ...current, ...incoming, payload: { ...current.payload, ...incoming.payload } };
  }
  if (current.type === 'approval' && incoming.type === 'approval') {
    return { ...current, ...incoming, payload: { ...current.payload, ...incoming.payload } };
  }
  return incoming;
}

function mergeItems(current: readonly ChatItem[], incoming: readonly ChatItem[]): ChatItem[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    if (item.type === 'message' && item.payload.role === 'user'
      && item.revision > LOCAL_ITEM_REVISION && item.operation_id) {
      for (const [id, candidate] of merged) {
        if (candidate.type === 'message' && candidate.payload.role === 'user'
          && candidate.revision === LOCAL_ITEM_REVISION
          && candidate.operation_id === item.operation_id) merged.delete(id);
      }
    }
    const existing = merged.get(item.id);
    merged.set(item.id, existing ? mergeItem(existing, item) : item);
  }
  const tasksWithFormalCandidates = new Set([...merged.values()].flatMap((item) =>
    item.type === 'candidate' && item.task_id ? [item.task_id] : []));
  return sortItems([...merged.values()].filter((item) =>
    item.type !== 'structured_preview'
    || !item.task_id
    || !tasksWithFormalCandidates.has(item.task_id)));
}

function mergeToolViews(
  current: readonly SessionToolView[], incoming: readonly SessionToolView[], sessionId: string,
): SessionToolView[] {
  const merged = new Map(current.map((view) => [view.tool_call_id, view]));
  for (const view of incoming) {
    if (view.session_id !== sessionId) continue;
    const existing = merged.get(view.tool_call_id);
    if (!existing || view.version > existing.version) merged.set(view.tool_call_id, view);
  }
  return [...merged.values()];
}

export function sessionMessageToChatItem(message: SessionMessageDto): ChatItem {
  const createdAt = Date.parse(message.created_at);
  return {
    schema_version: 1,
    id: message.role === 'assistant' && message.task_id
      ? chatItemIds.taskAssistant(message.task_id)
      : chatItemIds.message(message.id),
    type: 'message',
    status: sessionMessageStatusToChatItemStatus(message.status),
    collapsed: false,
    created_at: createdAt,
    updated_at: createdAt,
    revision: message.revision,
    sequence: message.sequence,
    session_id: message.session_id,
    task_id: message.task_id,
    operation_id: message.operation_id,
    message_id: message.id,
    payload: {
      role: message.role,
      content: message.content,
      format: message.role === 'assistant' ? 'markdown' : 'text',
      model_config_id: message.model_config_id,
      reasoning_level: message.reasoning_level,
    },
  };
}

function sessionMessageToChatItems(message: SessionMessageDto): ChatItem[] {
  const item = sessionMessageToChatItem(message);
  if (message.role !== 'assistant' || !message.task_id || !message.thinking_summary?.trim()) {
    return [item];
  }
  const createdAt = Date.parse(message.created_at);
  return [{
    schema_version: 1, id: chatItemIds.taskThinking(message.task_id), type: 'thinking',
    status: sessionMessageStatusToChatItemStatus(message.status), collapsed: true,
    created_at: createdAt, updated_at: createdAt, revision: message.revision,
    sequence: message.sequence, session_id: message.session_id, task_id: message.task_id,
    operation_id: message.operation_id, message_id: message.id,
    payload: { text: message.thinking_summary, display: 'summary' },
  }, item];
}

function itemsToMessages(items: readonly ChatItem[]): ChatMessage[] {
  return items.flatMap((item): ChatMessage[] => {
    if (item.type === 'message') return [{
      id: item.id, role: item.payload.role, content: item.payload.content,
      format: item.payload.format,
      createdAt: new Date(item.created_at).toISOString(),
    }];
    if (item.type === 'tool') return [{
      id: item.id, role: 'tool', content: item.payload.output_summary ?? item.payload.input_summary ?? '正在执行',
      tool: item.payload.tool, toolCallId: item.tool_call_id,
      toolSuccess: item.status === 'completed' ? true : item.status === 'failed' ? false : undefined,
    }];
    if (item.type === 'system' || item.type === 'error') return [{
      id: item.id, role: 'system', content: item.payload.message,
    }];
    return [];
  });
}

function itemScopeMatches(item: ChatItem, state: ChatState): boolean {
  return (!item.session_id || item.session_id === state.sessionId)
    && (!item.task_id || !state.activeTaskId || item.task_id === state.activeTaskId)
    && (!item.operation_id || !state.activeOperationId || item.operation_id === state.activeOperationId);
}

const baseStore = create<ChatState>((set) => ({
  ...INITIAL_CHAT_STATE,
  selectSession: (sessionId, sessionPersisted) => set((state) => ({
    ...INITIAL_CHAT_STATE, sessionId, sessionPersisted, sessionRevision: state.sessionRevision + 1,
  })),
  setSessionId: (sessionId) => set({ sessionId }),
  setSessionPersisted: (sessionPersisted) => set({ sessionPersisted }),
  setActiveTaskId: (activeTaskId) => set({ activeTaskId }),
  setActiveOperationId: (activeOperationId) => set({ activeOperationId }),
  setTaskTodos: (taskId, taskTodos) => set((state) => {
    if (state.activeTaskId && taskId !== state.activeTaskId) return state;
    const visible = taskTodos.length > 0
      && taskTodos.some((item) => item.status !== 'completed');
    return visible ? { todoTaskId: taskId, taskTodos } : { todoTaskId: undefined, taskTodos: [] };
  }),
  clearTaskTodos: () => set({ todoTaskId: undefined, taskTodos: [] }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  beginTask: () => set({ activeTaskId: undefined, activeOperationId: undefined,
    todoTaskId: undefined, taskTodos: [],
    isStreaming: true, isThinking: true, taskStatus: 'queued', privacyDecision: undefined }),
  setTaskStatus: (taskStatus) => {
    let accepted = false;
    set((state) => {
      const mergedStatus = mergeChatTaskStatus(state.taskStatus, taskStatus);
      accepted = mergedStatus === taskStatus;
      if (mergedStatus === state.taskStatus) return state;
      return { taskStatus: mergedStatus,
        ...(mergedStatus === 'waiting_privacy_decision' ? {} : { privacyDecision: undefined }) };
    });
    return accepted;
  },
  setPrivacyDecision: (privacyDecision) => set({ privacyDecision }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setThinking: (isThinking) => set({ isThinking }),
  upsertItem: (item) => set((state) =>
    itemScopeMatches(item, state) ? { items: mergeItems(state.items, [item]) } : state),
  mergeSnapshot: (items, toolViews) => set((state) => ({
    items: mergeItems(
      state.items.filter((item) => item.type !== 'structured_preview' && item.type !== 'candidate'),
      items.filter((item) => item.session_id === state.sessionId),
    ),
    toolViews: mergeToolViews(state.toolViews, toolViews, state.sessionId),
  })),
  mergeSessionMessages: (messages) => set((state) => ({
    items: mergeItems(state.items, messages
      .filter((message) => message.session_id === state.sessionId)
      .flatMap(sessionMessageToChatItems)),
  })),
  addMessage: (message) => set((state) => {
    const now = message.createdAt ? Date.parse(message.createdAt) : Date.now();
    const item: ChatItem = {
      schema_version: 1, id: message.id, type: 'message', status: 'streaming',
      collapsed: message.role !== 'assistant', created_at: now, updated_at: now,
      revision: LOCAL_ITEM_REVISION, session_id: state.sessionId || undefined,
      task_id: state.activeTaskId, operation_id: state.activeOperationId,
      payload: { role: message.role === 'tool' ? 'system' : message.role,
        content: message.content, format: 'text' },
    };
    const withoutSameLocal = state.items.filter((current) => current.id !== item.id);
    return { items: sortItems([...withoutSameLocal, item]) };
  }),
  bindOptimisticMessageId: (optimisticId, stableMessageId) => set((state) => {
    const stableItemId = chatItemIds.message(stableMessageId);
    const optimistic = state.items.find((item) => item.id === optimisticId
      && item.type === 'message' && item.payload.role === 'user' && item.revision === LOCAL_ITEM_REVISION);
    if (!optimistic) return state;
    const existingStable = state.items.find((item) => item.id === stableItemId);
    const items = existingStable
      ? state.items.filter((item) => item.id !== optimisticId)
      : state.items.map((item) => item.id === optimisticId
        ? { ...item, id: stableItemId, message_id: stableMessageId } as ChatItem : item);
    return { items: sortItems(items) };
  }),
  clearSubmissionNotice: (operationId) => set((state) => ({
    items: state.items.filter((item) => item.id !== submissionUnknownNoticeId(operationId)),
  })),
  resetChat: () => set((state) => ({ ...INITIAL_CHAT_STATE, sessionRevision: state.sessionRevision + 1 })),
}));

function projectState(state: ChatState): ChatStateView {
  return Object.assign({}, state, { messages: itemsToMessages(state.items) });
}

type ChatStoreHook = {
  <T>(selector: (state: ChatStateView) => T): T;
  getState: () => ChatStateView;
  setState: StoreApi<ChatState>['setState'];
  subscribe: StoreApi<ChatState>['subscribe'];
};

const projectedHook = (<T>(selector: (state: ChatStateView) => T) =>
  baseStore((state) => selector(projectState(state)))) as ChatStoreHook;
projectedHook.getState = () => projectState(baseStore.getState());
projectedHook.setState = baseStore.setState;
projectedHook.subscribe = baseStore.subscribe;
export const useChatStore = projectedHook;

export function applyTextDeltaToStore(input: TextDeltaInput): DeltaApplyResult {
  const state = baseStore.getState();
  const existing = state.items.find((item) => item.id === input.itemId);
  if (existing && input.itemRevision <= existing.revision) return 'ignored';
  if (existing && (existing.type !== 'message' || existing.message_id !== input.messageId)) {
    return 'recovery_required';
  }
  const content = existing?.type === 'message' ? existing.payload.content : '';
  if (content.length !== input.textOffset) return 'recovery_required';
  const item: ChatItem = {
    schema_version: 1, id: input.itemId, type: 'message', status: 'streaming', collapsed: false,
    created_at: existing?.created_at ?? input.timestamp, updated_at: input.timestamp,
    revision: input.itemRevision, sequence: existing?.sequence,
    session_id: input.sessionId, task_id: input.taskId, operation_id: input.operationId,
    message_id: input.messageId,
    payload: { role: 'assistant', content: `${content}${input.data}`, format: 'markdown',
      ...(existing?.type === 'message' ? {
        model_config_id: existing.payload.model_config_id,
        reasoning_level: existing.payload.reasoning_level,
      } : {}) },
  };
  if (!itemScopeMatches(item, state)) return 'ignored';
  baseStore.setState({ items: mergeItems(state.items, [item]) });
  return 'applied';
}

export function applyThinkingDeltaToStore(input: ThinkingDeltaInput): DeltaApplyResult {
  const state = baseStore.getState();
  const existing = state.items.find((item) => item.id === input.itemId);
  if (existing && input.itemRevision <= existing.revision) return 'ignored';
  if (existing && existing.type !== 'thinking') return 'recovery_required';
  const text = existing?.type === 'thinking' ? existing.payload.text ?? '' : '';
  if (text.length !== input.textOffset) return 'recovery_required';
  const item: ChatItem = {
    schema_version: 1, id: input.itemId, type: 'thinking', status: 'streaming', collapsed: true,
    created_at: existing?.created_at ?? input.timestamp, updated_at: input.timestamp,
    revision: input.itemRevision, sequence: existing?.sequence,
    session_id: input.sessionId, task_id: input.taskId, operation_id: input.operationId,
    payload: { text: `${text}${input.data}`, display: 'progress' },
  };
  if (!itemScopeMatches(item, state)) return 'ignored';
  baseStore.setState({ items: mergeItems(state.items, [item]) });
  return 'applied';
}

export function findSessionToolViewForItem(
  toolViews: readonly SessionToolView[], item: ChatItem,
): SessionToolView | undefined {
  if (item.type !== 'tool' && item.type !== 'approval') return undefined;
  return toolViews.find((view) => view.tool_call_id === item.tool_call_id);
}

export function submissionUnknownNoticeId(operationId: string): string {
  return `submission-unknown:${operationId}`;
}
