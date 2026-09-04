import { create } from 'zustand';

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
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
  activeTaskId?: string;
  activeOperationId?: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  isThinking: boolean;
  connectionStatus: ChatConnectionStatus;
  taskStatus: ChatTaskStatus;
  setSessionId: (sessionId: string) => void;
  setActiveTaskId: (activeTaskId?: string) => void;
  setActiveOperationId: (activeOperationId?: string) => void;
  setConnectionStatus: (connectionStatus: ChatConnectionStatus) => void;
  beginTask: () => void;
  setTaskStatus: (taskStatus: ChatTaskStatus) => boolean;
  setStreaming: (isStreaming: boolean) => void;
  setThinking: (isThinking: boolean) => void;
  addMessage: (message: ChatMessage) => void;
  bindOptimisticMessageId: (optimisticId: string, stableId: string) => void;
  appendAssistantContent: (id: string, content: string) => void;
  completeTool: (toolCallId: string, success: boolean) => void;
  reconcileMessages: (messages: ChatMessage[]) => void;
  replaceMessages: (messages: ChatMessage[]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: '',
  messages: [],
  isStreaming: false,
  isThinking: false,
  connectionStatus: 'idle',
  taskStatus: 'idle',
  setSessionId: (sessionId) => set({ sessionId }),
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
    }),
  setTaskStatus: (taskStatus) => {
    let accepted = false;
    set((state) => {
      const mergedStatus = mergeChatTaskStatus(state.taskStatus, taskStatus);
      accepted = mergedStatus === taskStatus;
      return mergedStatus === state.taskStatus ? state : { taskStatus: mergedStatus };
    });
    return accepted;
  },
  setStreaming: (isStreaming) => set({ isStreaming }),
  setThinking: (isThinking) => set({ isThinking }),
  addMessage: (message) =>
    set((state) => ({
      messages: state.messages.some((current) => current.id === message.id)
        ? state.messages.map((current) =>
            current.id === message.id ? { ...current, ...message } : current,
          )
        : [...state.messages, message],
    })),
  bindOptimisticMessageId: (optimisticId, stableId) =>
    set((state) => {
      const optimistic = state.messages.find(
        (message) => message.id === optimisticId && message.role === 'user',
      );
      if (!optimistic || optimisticId === stableId) return state;

      const stableMessage = state.messages.find((message) => message.id === stableId);
      return {
        messages: stableMessage
          ? state.messages.filter((message) => message.id !== optimisticId)
          : state.messages.map((message) =>
              message.id === optimisticId ? { ...message, id: stableId } : message,
            ),
      };
    }),
  appendAssistantContent: (id, content) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, content: `${message.content}${content}` } : message,
      ),
    })),
  completeTool: (toolCallId, success) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.toolCallId === toolCallId ? { ...message, toolSuccess: success } : message,
      ),
    })),
  reconcileMessages: (messages) =>
    set((state) => ({ messages: mergeChatMessages(state.messages, messages) })),
  replaceMessages: (messages) =>
    set((state) => ({ messages: mergeChatMessages(state.messages, messages) })),
}));
