import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import * as Crypto from 'expo-crypto';

import { subscribeAgentStream, type AgentStreamEvent } from '@/api/agent-stream';
import { cancelTask, submitTextInput } from '@/api/chat-api';
import { useChatStore } from '@/store/chat-store';

export function useChat() {
  const sessionId = useChatStore((state) => state.sessionId);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const assistantMessageIdRef = useRef<string | undefined>(undefined);

  const handleAgentEvent = useCallback((event: AgentStreamEvent) => {
    applyAgentEvent(event, assistantMessageIdRef);
  }, []);

  useEffect(() => {
    if (sessionId) return;
    useChatStore.getState().setSessionId(Crypto.randomUUID());
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    return subscribeAgentStream({
      sessionId,
      onEvent: handleAgentEvent,
      onStatusChange: (status) => useChatStore.getState().setConnectionStatus(status),
    });
  }, [handleAgentEvent, sessionId]);

  const sendMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return false;

    const state = useChatStore.getState();
    if (!state.sessionId || state.isStreaming) return false;

    state.addMessage({ id: Crypto.randomUUID(), role: 'user', content: message });
    state.setStreaming(true);
    state.setThinking(true);
    assistantMessageIdRef.current = undefined;

    try {
      const result = await submitTextInput({ text: message, sessionId: state.sessionId });
      const taskId = result.data?.chat_task.task_id ?? result.task_refs?.[0]?.task_id;
      state.setActiveTaskId(taskId);
      return true;
    } catch (error) {
      state.setStreaming(false);
      state.setThinking(false);
      state.addMessage({
        id: Crypto.randomUUID(),
        role: 'system',
        content: error instanceof Error ? error.message : '消息提交失败，请稍后重试。',
      });
      return true;
    }
  }, []);

  const stopStreaming = useCallback(async () => {
    const state = useChatStore.getState();
    if (!state.activeTaskId) return;
    try {
      await cancelTask(state.activeTaskId);
    } catch (error) {
      state.addMessage({
        id: Crypto.randomUUID(),
        role: 'system',
        content: error instanceof Error ? error.message : '取消失败，请稍后重试。',
      });
    }
  }, []);

  return { sendMessage, stopStreaming, isStreaming };
}

function applyAgentEvent(
  event: AgentStreamEvent,
  assistantIdRef: MutableRefObject<string | undefined>,
) {
  const state = useChatStore.getState();

  switch (event.type) {
    case 'history':
      state.replaceMessages(
        event.data.messages.map((message) => ({
          id: Crypto.randomUUID(),
          role: message.role,
          content: message.content,
        })),
      );
      return;
    case 'text_delta': {
      let assistantId = assistantIdRef.current;
      if (!assistantId) {
        assistantId = Crypto.randomUUID();
        assistantIdRef.current = assistantId;
        state.addMessage({ id: assistantId, role: 'assistant', content: '' });
      }
      state.setThinking(false);
      state.appendAssistantContent(assistantId, event.data);
      return;
    }
    case 'thinking_delta':
      state.setThinking(true);
      return;
    case 'tool_execution_start':
      state.addMessage({
        id: Crypto.randomUUID(),
        role: 'tool',
        content: `正在执行 ${event.data.tool}`,
        tool: event.data.tool,
        toolCallId: event.data.toolCallId,
      });
      return;
    case 'tool_execution_end':
      state.completeTool(event.data.toolCallId, event.data.success);
      return;
    case 'done':
      finishStream(assistantIdRef);
      return;
    case 'cancelled':
      finishStream(assistantIdRef);
      state.addMessage({ id: Crypto.randomUUID(), role: 'system', content: '已取消本次回复。' });
      return;
    case 'error':
      finishStream(assistantIdRef);
      state.addMessage({ id: Crypto.randomUUID(), role: 'system', content: event.data.message });
  }
}

function finishStream(assistantIdRef: MutableRefObject<string | undefined>) {
  const state = useChatStore.getState();
  state.setStreaming(false);
  state.setThinking(false);
  state.setActiveTaskId(undefined);
  assistantIdRef.current = undefined;
}
