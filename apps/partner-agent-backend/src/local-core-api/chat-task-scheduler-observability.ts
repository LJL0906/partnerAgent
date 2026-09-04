import type { PiAgentService } from '../agent/pi-agent.service.js';
import type { AcceptedChatTask, ChatTaskStore } from './chat-task.store.js';
import type { ChatTaskAgentEvent } from './chat-task-runner.js';
import {
  NoopObservabilitySink,
  safelyRecord,
  type ObservabilityEvent,
  type ObservabilitySink,
} from '../observability/observability.types.js';

export class ChatTaskSchedulerObservability {
  constructor(
    private readonly sink: ObservabilitySink = new NoopObservabilitySink(),
  ) {}

  async recoverExpired(store: ChatTaskStore): Promise<void> {
    const count = await store.recoverExpiredLeases();
    if (count > 0) this.record({ kind: 'chat_task_lease_expired', count });
  }

  async claim(store: ChatTaskStore, leaseOwner: string, leaseMs: number) {
    await this.observeDepth(store);
    try {
      const task = await store.claimNextRunnable(leaseOwner, leaseMs);
      this.record({
        kind: 'chat_task_claim',
        result: task ? 'claimed' : 'empty',
      });
      await this.observeDepth(store);
      return task;
    } catch (error) {
      this.record({ kind: 'chat_task_claim', result: 'error' });
      throw error;
    }
  }

  private async observeDepth(store: ChatTaskStore): Promise<void> {
    try {
      this.record({
        kind: 'chat_task_queue_depth',
        depth: await store.countRunnable(),
      });
    } catch {
      // Metrics sampling is best-effort and never blocks task execution.
    }
  }

  async renew(
    store: ChatTaskStore,
    taskId: string,
    ownerId: string,
    leaseOwner: string,
    leaseMs: number,
  ): Promise<boolean> {
    const renewed = await store.renewLease(
      taskId,
      ownerId,
      leaseOwner,
      leaseMs,
    );
    if (!renewed) {
      this.record({
        kind: 'chat_task_fence_rejected',
        operation: 'renew',
      });
    }
    return renewed;
  }

  private record(event: ObservabilityEvent): void {
    safelyRecord(this.sink, event);
  }
}

export function chatTaskStream(
  agent: PiAgentService,
  task: AcceptedChatTask,
): AsyncGenerator<ChatTaskAgentEvent> {
  return agent.resumeTask(task.sessionId, task.text, task.ownerId, {
    taskId: task.taskId,
    operationId: task.operationId,
    source: 'submit_text_input',
  });
}

export function positiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
