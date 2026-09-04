import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ChatTaskEventBus } from './chat-task-event.bus.js';
import { ChatTaskStore } from './chat-task.store.js';
import type { ClaimedChatTaskLifecycleEvent } from './chat-task-lifecycle-outbox.js';

const RELAY_BATCH_SIZE = 50;
const RELAY_LEASE_MS = 30_000;
const RELAY_MAX_ATTEMPTS = 8;
const RELAY_RETRY_DELAY_MS = 1_000;
const RELAY_POLL_MS = 500;

@Injectable()
export class ChatTaskOutboxRelay {
  private readonly logger = new Logger(ChatTaskOutboxRelay.name);
  private readonly relayId = randomUUID();
  private timer?: ReturnType<typeof setInterval>;
  private relaying = false;

  constructor(
    private readonly tasks: ChatTaskStore,
    private readonly events: ChatTaskEventBus,
  ) {}

  start(): void {
    if (!this.tasks.lifecycleOutbox || this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), RELAY_POLL_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.relaying) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  async runOnce(): Promise<number> {
    const outbox = this.tasks.lifecycleOutbox;
    if (!outbox || this.relaying) return 0;
    this.relaying = true;
    let delivered = 0;
    try {
      const claimed = await outbox.claim(
        this.relayId,
        RELAY_BATCH_SIZE,
        RELAY_LEASE_MS,
        RELAY_MAX_ATTEMPTS,
      );
      for (const event of claimed) {
        if (await this.relay(event)) delivered += 1;
      }
      return delivered;
    } finally {
      this.relaying = false;
    }
  }

  private async relay(event: ClaimedChatTaskLifecycleEvent): Promise<boolean> {
    const outbox = this.tasks.lifecycleOutbox;
    if (!outbox) return false;
    try {
      await this.events.publishDurable({
        ownerId: event.ownerId,
        taskId: event.taskId,
        operationId: event.operationId,
        sessionId: event.sessionId,
        state: event.state,
        type: 'state_changed',
        data: event.data,
        eventKey: event.eventKey,
      });
      return await outbox.acknowledge(event);
    } catch {
      await outbox.fail(event, RELAY_RETRY_DELAY_MS);
      if (event.attemptCount >= RELAY_MAX_ATTEMPTS) {
        this.logger.error('ChatTask lifecycle outbox event exhausted attempts');
      }
      return false;
    }
  }
}
