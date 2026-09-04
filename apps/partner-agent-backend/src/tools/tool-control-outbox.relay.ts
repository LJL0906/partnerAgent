import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RedactionService } from './redaction.service.js';
import { ToolOperationStore } from './tool-operation.store.js';
import {
  TOOL_CONTROL_OUTBOX_MAX_ATTEMPTS,
  type ClaimedToolControlEvent,
} from './tool-control-outbox.js';
import { WsV1EventStore } from '../ws-v1/ws-v1-event.store.js';

const BATCH_SIZE = 50;
const LEASE_MS = 30_000;
const RETRY_DELAY_MS = 1_000;
const POLL_MS = 500;

@Injectable()
export class ToolControlOutboxRelay {
  private readonly logger = new Logger(ToolControlOutboxRelay.name);
  private readonly relayId = randomUUID();
  private timer?: ReturnType<typeof setInterval>;
  private relaying = false;

  constructor(
    private readonly tools: ToolOperationStore,
    private readonly events: WsV1EventStore,
    private readonly redaction: RedactionService,
  ) {}

  start(): void {
    if (!this.tools.controlOutbox || this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), POLL_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.relaying)
      await new Promise((resolve) => setTimeout(resolve, 5));
  }

  async runOnce(): Promise<number> {
    const outbox = this.tools.controlOutbox;
    if (!outbox || this.relaying) return 0;
    this.relaying = true;
    let delivered = 0;
    try {
      const claimed = await outbox.claim(this.relayId, BATCH_SIZE, LEASE_MS);
      for (const event of claimed) {
        if (await this.relay(event)) delivered += 1;
      }
      return delivered;
    } finally {
      this.relaying = false;
    }
  }

  private async relay(event: ClaimedToolControlEvent): Promise<boolean> {
    const outbox = this.tools.controlOutbox;
    if (!outbox) return false;
    try {
      const common = {
        session_id: event.sessionId,
        task_id: event.taskId,
        operation_id: event.operationId,
        event_type: event.eventType,
        data: this.redaction.sanitize(event.data),
      } as const;
      for (const channel of [
        `session:${event.sessionId}`,
        `task:${event.taskId}`,
        `operation:${event.operationId}`,
      ] as const) {
        const stored = await this.events.append(
          {
            channel,
            ...common,
            idempotency_key: `${event.eventKey}:${channel}`,
          },
          channel,
        );
        await this.events.dispatchStored(stored);
      }
      return await outbox.acknowledge(event);
    } catch {
      await outbox.fail(event, RETRY_DELAY_MS);
      if (event.attemptCount >= TOOL_CONTROL_OUTBOX_MAX_ATTEMPTS) {
        this.logger.error('Tool control outbox event exhausted attempts');
      }
      return false;
    }
  }
}
