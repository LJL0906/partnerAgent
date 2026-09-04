import type {
  AgentMessage,
  AgentToolResult,
  BeforeToolCallContext,
} from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import type { SessionMessage } from '@partner-agent/contracts';
import type { StoredSessionMessage } from '../database/session-store.js';

interface PersistedAgentContext {
  messages: StoredSessionMessage[];
  contextMessages: AgentMessage[];
  contextRevision: number;
}

export interface PiToolDecision {
  toolCallId: string;
  toolName: string;
  result: AgentToolResult<unknown>;
  isError?: boolean;
}

export function toAgentMessages(
  history: SessionMessage[],
  model: Model<any>,
): AgentMessage[] {
  return history.map((message) => {
    if (message.role === 'user') {
      return {
        role: 'user',
        content: message.content,
        timestamp: message.timestamp,
      };
    }

    return {
      role: 'assistant',
      content: [{ type: 'text', text: message.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: 'stop',
      timestamp: message.timestamp,
    };
  });
}

export function withoutAcceptedPrompt(
  messages: StoredSessionMessage[],
  prompt: string,
): StoredSessionMessage[] {
  const result = [...messages];
  const last = result.at(-1);
  if (last?.role === 'user' && last.content === prompt) result.pop();
  return result;
}

export function buildDirectChatContext(
  session: PersistedAgentContext,
  acceptedPrompt: string | undefined,
  model: Model<any>,
): AgentMessage[] {
  const persisted = acceptedPrompt
    ? withoutAcceptedPrompt(session.messages, acceptedPrompt)
    : session.messages;
  const afterSnapshot = persisted.filter(
    (entry) => entry.sequence > session.contextRevision,
  );
  return session.contextMessages.length
    ? [...session.contextMessages, ...toAgentMessages(afterSnapshot, model)]
    : toAgentMessages(persisted, model);
}

/** 裁剪只从用户回合边界开始，避免留下孤立的 toolResult/toolCall。 */
export function trimCompleteTurns(
  messages: AgentMessage[],
  maxMessages = 100,
): AgentMessage[] {
  if (messages.length <= maxMessages) return [...messages];

  const preferredStart = messages.length - maxMessages;
  const nextTurnStart = messages.findIndex(
    (message, index) => index >= preferredStart && message.role === 'user',
  );
  if (nextTurnStart >= 0) return messages.slice(nextTurnStart);

  for (let index = preferredStart - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages.slice(index);
  }
  return [...messages];
}

export function replaceToolDecision(
  source: AgentMessage[],
  decision: PiToolDecision,
): AgentMessage[] {
  const messages = [...source];
  let pendingIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (
      entry?.role === 'toolResult' &&
      entry.toolCallId === decision.toolCallId &&
      entry.toolName === decision.toolName
    ) {
      pendingIndex = index;
      break;
    }
  }
  if (pendingIndex < 0) throw new Error('等待审批的工具调用上下文不存在');

  const pendingResult = messages[pendingIndex];
  if (pendingResult?.role !== 'toolResult') {
    throw new Error('等待审批的工具调用上下文无效');
  }
  messages[pendingIndex] = {
    ...pendingResult,
    content: decision.result.content,
    details: decision.result.details,
    usage: decision.result.usage,
    addedToolNames: decision.result.addedToolNames,
    isError: decision.isError ?? false,
    timestamp: Date.now(),
  };
  return messages;
}

export function isPendingApprovalToolResult(
  message: AgentMessage | undefined,
): boolean {
  return Boolean(
    message?.role === 'toolResult' &&
    message.details &&
    typeof message.details === 'object' &&
    'status' in message.details &&
    message.details.status === 'pending_tool_approval',
  );
}

export function guardApprovalToolBatch(
  context: BeforeToolCallContext,
  isApprovalRequired: (toolName: string) => boolean,
): { block: true; reason: string } | undefined {
  const toolCalls = context.assistantMessage.content.filter(
    (content) => content.type === 'toolCall',
  );
  if (toolCalls.length <= 1) return undefined;
  const includesApproval = toolCalls.some((toolCall) => {
    try {
      return isApprovalRequired(toolCall.name);
    } catch {
      return false;
    }
  });
  if (!includesApproval) return undefined;
  return {
    block: true,
    reason: '需要用户审批的外部工具必须在单独一次工具调用中发起。',
  };
}
