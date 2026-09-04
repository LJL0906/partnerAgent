import { Injectable } from '@nestjs/common';
import { PiAgentService } from '../agent/pi-agent.service.js';
import { ChatTaskEventBus } from './chat-task-event.bus.js';
import { ChatTaskStore, type AcceptedChatTask } from './chat-task.store.js';

type AgentEvent = { type: string; data?: unknown; timestamp: number };

export abstract class ChatTaskScheduler {
  abstract schedule(task: AcceptedChatTask): void;
  abstract cancel(task: AcceptedChatTask): Promise<void>;
}

@Injectable()
export class PiChatTaskScheduler extends ChatTaskScheduler {
  private readonly cancelledTasks = new Set<string>();

  constructor(
    private readonly agent: PiAgentService,
    private readonly store: ChatTaskStore,
    private readonly events: ChatTaskEventBus,
  ) {
    super();
  }

  schedule(task: AcceptedChatTask): void {
    void this.run(task);
  }

  async cancel(task: AcceptedChatTask): Promise<void> {
    this.cancelledTasks.add(task.taskId);
    try {
      await this.agent.cancel(task.sessionId, task.ownerId);
    } catch {
      // 持久任务状态是权威源；进程内 Agent 可能已经结束。
    } finally {
      this.state(task, 'cancelled');
    }
  }

  private async run(task: AcceptedChatTask): Promise<void> {
    if (!(await this.store.markRunning(task.taskId, task.ownerId))) {
      this.cancelledTasks.delete(task.taskId);
      return;
    }
    this.state(task, 'running');
    try {
      let failure: { code: string; message: string } | undefined;
      const chat = this.agent.chat as unknown as (
        sessionId: string,
        text: string,
        ownerId: string,
        context: { taskId: string; operationId: string; source: string },
      ) => AsyncGenerator<AgentEvent>;
      for await (const event of chat.call(
        this.agent,
        task.sessionId,
        task.text,
        task.ownerId,
        {
          taskId: task.taskId,
          operationId: task.operationId,
          source: 'submit_text_input',
        },
      )) {
        if (this.cancelledTasks.has(task.taskId)) return;
        if (event.type === 'privacy_decision_required') {
          await this.store.markWaiting(task.taskId, task.ownerId);
          this.state(task, 'waiting_privacy_decision');
          return;
        }
        if (event.type === 'error') {
          failure = {
            code: this.errorCode(event.data),
            message: this.safeErrorMessage(this.errorMessage(event.data)),
          };
        }
        if (event.type !== 'done') {
          this.events.publish({
            ...this.base(task),
            state: 'running',
            type: 'agent_event',
            eventType: event.type,
            data:
              event.type === 'error' && failure
                ? { code: failure.code, message: failure.message }
                : event.data,
          });
        }
      }
      if (failure) {
        await this.store.markFailed(
          task.taskId,
          task.ownerId,
          failure.code,
          failure.message,
        );
        this.state(task, 'failed', failure);
        return;
      }
      const completed = await this.store.markCompleted(
        task.taskId,
        task.ownerId,
      );
      if (completed?.state === 'cancelled') return;
      this.state(task, 'completed');
    } catch (error) {
      const message = this.safeErrorMessage(
        error instanceof Error ? error.message : '聊天任务执行失败',
      );
      const failed = await this.store.markFailed(
        task.taskId,
        task.ownerId,
        'INTERNAL_000',
        message,
      );
      if (failed?.state !== 'cancelled')
        this.state(task, 'failed', { code: 'INTERNAL_000', message });
    } finally {
      this.cancelledTasks.delete(task.taskId);
    }
  }

  private state(
    task: AcceptedChatTask,
    state:
      | 'running'
      | 'waiting_privacy_decision'
      | 'completed'
      | 'failed'
      | 'cancelled',
    data?: unknown,
  ) {
    this.events.publish({
      ...this.base(task),
      state,
      type: 'state_changed',
      data,
    });
  }
  private base(task: AcceptedChatTask) {
    return {
      ownerId: task.ownerId,
      taskId: task.taskId,
      operationId: task.operationId,
      sessionId: task.sessionId,
    };
  }
  private errorMessage(data: unknown) {
    if (
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof data.message === 'string'
    )
      return data.message;
    return '模型调用失败';
  }

  private errorCode(data: unknown) {
    return data &&
      typeof data === 'object' &&
      'result' in data &&
      data.result === 'blocked'
      ? 'EGRESS_001'
      : 'MODEL_002';
  }

  private safeErrorMessage(message: string) {
    return message
      .replace(/\b(?:sk|key)-[a-z0-9_-]{8,}\b/gi, '[REDACTED]')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/(password|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
      .slice(0, 500);
  }
}
