import { Injectable } from '@nestjs/common';
import type { ChatTaskState } from '../database/entities/chat-task.entity.js';

interface ChatTaskEventBase {
  ownerId: string;
  taskId: string;
  operationId: string;
  sessionId: string;
  state: ChatTaskState;
  eventType?: string;
  data?: unknown;
  /** Stable key present only for persisted lifecycle outbox delivery. */
  eventKey?: string;
}

export type ChatTaskEvent = ChatTaskEventBase &
  (
    | { type: 'state_changed'; revision: number }
    | { type: 'agent_event'; revision?: never }
  );

type Listener = (event: ChatTaskEvent) => void | Promise<void>;

@Injectable()
export class ChatTaskEventBus {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: ChatTaskEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 推送观察者失败不能反向改变已持久化的任务状态。
      }
    }
  }

  async publishDurable(event: ChatTaskEvent): Promise<void> {
    if (this.listeners.size === 0) throw new Error('OUTBOX_NO_SUBSCRIBER');
    await Promise.all([...this.listeners].map((listener) => listener(event)));
  }
}
