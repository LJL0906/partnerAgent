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

export type ChatConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

interface ChatState {
  sessionId: string;
  activeTaskId?: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  isThinking: boolean;
  connectionStatus: ChatConnectionStatus;
  setSessionId: (sessionId: string) => void;
  setActiveTaskId: (activeTaskId?: string) => void;
  setConnectionStatus: (connectionStatus: ChatConnectionStatus) => void;
  setStreaming: (isStreaming: boolean) => void;
  setThinking: (isThinking: boolean) => void;
  addMessage: (message: ChatMessage) => void;
  appendAssistantContent: (id: string, content: string) => void;
  completeTool: (toolCallId: string, success: boolean) => void;
  replaceMessages: (messages: ChatMessage[]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: '',
  messages: [],
  isStreaming: false,
  isThinking: false,
  connectionStatus: 'idle',
  setSessionId: (sessionId) => set({ sessionId }),
  setActiveTaskId: (activeTaskId) => set({ activeTaskId }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setThinking: (isThinking) => set({ isThinking }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
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
  replaceMessages: (messages) => set({ messages, isStreaming: false, isThinking: false }),
}));
