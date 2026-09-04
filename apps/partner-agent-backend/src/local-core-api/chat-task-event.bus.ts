import { Injectable } from '@nestjs/common';
import type { ChatTaskState } from '../database/entities/chat-task.entity.js';

export interface ChatTaskEvent {
  ownerId: string;
  taskId: string;
  operationId: string;
  sessionId: string;
  state: ChatTaskState;
  type: 'state_changed' | 'agent_event';
  eventType?: string;
  data?: unknown;
}

type Listener = (event: ChatTaskEvent) => void;

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
}
