import { parseChatItem } from '@partner-agent/contracts';

import type { RecoverableChatSession } from '@/api/chat-api';
import { useChatStore } from '@/store/chat-store';

/** Both REST recovery paths validate the complete snapshot before mutating the store. */
export function applyChatSessionSnapshot(snapshot: RecoverableChatSession, expectedSessionId: string): void {
  if (!snapshot || snapshot.id !== expectedSessionId) {
    throw new Error('会话标识不匹配。');
  }

  // Present-but-empty is authoritative. Only an absent field is a legacy response.
  if (snapshot.items !== undefined) {
    if (!Array.isArray(snapshot.items)) throw new Error('会话消息快照格式无效。');
    const items = snapshot.items.map((value) => {
      let item;
      try {
        item = parseChatItem(value);
      } catch {
        // Do not include response content in errors/logs.
        throw new Error('会话消息快照格式无效。');
      }
      if (item.session_id !== undefined && item.session_id !== expectedSessionId) {
        throw new Error('会话消息归属不匹配。');
      }
      return { ...item, session_id: expectedSessionId };
    });
    useChatStore.getState().replaceItems(items);
    return;
  }

  if (!Array.isArray(snapshot.messages)) throw new Error('会话消息快照格式无效。');
  const messages = snapshot.messages.map((message) => {
    if (!message || typeof message.id !== 'string' || !message.id.trim()
      || !['user', 'assistant', 'system'].includes(message.role)
      || typeof message.content !== 'string' || typeof message.created_at !== 'string') {
      throw new Error('会话消息快照格式无效。');
    }
    return { id: message.id, role: message.role, content: message.content, createdAt: message.created_at };
  });
  useChatStore.getState().reconcileMessages(messages);
}
