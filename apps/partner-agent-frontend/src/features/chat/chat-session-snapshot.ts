import {
  parseChatSessionSummary,
  parseSessionMessageDto,
  type ChatSessionSummary,
} from '@partner-agent/contracts';

import { useChatStore } from '@/store/chat-store';

export function applyChatSessionSnapshot(snapshot: unknown, expectedSessionId: string): void {
  if (!snapshot || typeof snapshot !== 'object' || (snapshot as { id?: unknown }).id !== expectedSessionId) {
    throw new Error('会话标识不匹配。');
  }

  const record = snapshot as Record<string, unknown>;
  if (record.items !== undefined) {
    let parsed: ChatSessionSummary;
    try {
      parsed = parseChatSessionSummary(snapshot);
    } catch {
      throw new Error('会话消息快照格式无效。');
    }
    useChatStore.getState().mergeSnapshot(parsed.items, parsed.tool_views);
    return;
  }

  // Limited migration fallback: old REST envelopes may omit items/tool_views, but
  // their messages still use the shared SessionMessageDto and stable identity.
  if (!Array.isArray(record.messages)) throw new Error('会话消息快照格式无效。');
  try {
    const messages = record.messages.map(parseSessionMessageDto);
    if (messages.some((message) => message.session_id !== expectedSessionId)) {
      throw new Error('owner mismatch');
    }
    useChatStore.getState().mergeSessionMessages(messages);
  } catch {
    throw new Error('会话消息快照格式无效。');
  }
}
