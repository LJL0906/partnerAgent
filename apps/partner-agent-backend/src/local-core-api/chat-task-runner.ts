import { PiAgentService } from '../agent/pi-agent.service.js';
import type { EgressDecisionStore } from '../model-gateway/egress-decision.store.js';
import { ChatTaskEventBus } from './chat-task-event.bus.js';
import {
  chatTaskEventErrorCode,
  chatTaskEventErrorMessage,
  safeChatTaskErrorMessage,
  thrownChatTaskErrorCode,
} from './chat-task-errors.js';
import { ChatTaskStore, type AcceptedChatTask } from './chat-task.store.js';
import type { ChatPreviewV1 } from '@partner-agent/contracts';

export type ChatTaskAgentEvent = {
  type: string;
  data?: unknown;
  timestamp: number;
};

interface AssistantOutputData {
  content: string;
  chatPreviews: ChatPreviewV1[];
  contextMessages: unknown[];
}

function assistantOutputData(value: unknown): AssistantOutputData | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Partial<AssistantOutputData>;
  return typeof data.content === 'string' &&
    Array.isArray(data.chatPreviews) &&
    Array.isArray(data.contextMessages)
    ? (data as AssistantOutputData)
    : undefined;
}

export class ChatTaskRunner {
  constructor(
    private readonly agent: PiAgentService,
    private readonly store: ChatTaskStore,
    private readonly events: ChatTaskEventBus,
    private readonly decisions: EgressDecisionStore,
    private readonly leaseMs: number,
    private readonly isStopping: () => boolean,
    private readonly isCancelled: (taskId: string) => boolean,
    private readonly onLeaseLost: (taskId: string) => void,
  ) {}

  async run(
    task: AcceptedChatTask,
    stream: AsyncGenerator<ChatTaskAgentEvent>,
    leaseOwner: string,
  ): Promise<void> {
    let leaseLost = false;
    let renewing = false;
    const heartbeat = setInterval(
      () => {
        if (renewing || leaseLost) return;
        renewing = true;
        void this.renew(task, leaseOwner)
          .then((renewed) => {
            if (!renewed) {
              leaseLost = true;
              this.onLeaseLost(task.taskId);
              return this.agent.cancel(task.sessionId, task.ownerId);
            }
            return undefined;
          })
          .catch(() => {
            leaseLost = true;
            this.onLeaseLost(task.taskId);
            return this.agent
              .cancel(task.sessionId, task.ownerId)
              .catch(() => false);
          })
          .finally(() => {
            renewing = false;
          });
      },
      Math.max(100, Math.floor(this.leaseMs / 3)),
    );
    heartbeat.unref?.();

    this.publishState(task, 'running');
    try {
      const priorMessage = (await this.store.listSessionMessages(
        task.ownerId,
        task.sessionId,
      )).find(
        (message) => message.role === 'assistant' && message.task_id === task.taskId,
      );
      let expectedRevision = priorMessage?.revision ?? 0;
      let persistedContent = priorMessage?.content ?? '';
      let generatedContent = '';
      let outputCommitted = false;
      let failure: { code: string; message: string } | undefined;
      let waitingToolConfirmationId: string | undefined;
      for await (const event of stream) {
        if (this.shouldStop(task.taskId, leaseLost)) return;
        if (event.type === 'privacy_decision_required') {
          const decision = await this.decisions.findCurrentForTask(
            task.taskId,
            task.ownerId,
          );
          if (!decision || decision.state !== 'pending') {
            throw new Error('隐私等待记录未持久化');
          }
          if (
            !(await this.store.markWaiting(
              task.taskId,
              task.ownerId,
              leaseOwner,
              {
                egress_id: decision.id,
                categories: [...decision.categories],
                provider: decision.provider,
                model_id: decision.modelId,
                expires_at: decision.expiresAt.toISOString(),
              },
            ))
          ) {
            return;
          }
          this.publishState(task, 'waiting_privacy_decision', {
            egress_id: decision.id,
            categories: [...decision.categories],
            provider: decision.provider,
            model_id: decision.modelId,
            expires_at: decision.expiresAt.toISOString(),
          });
          return;
        }
        if (event.type === 'tool_confirmation_pending') {
          const data = event.data as { confirmationId?: unknown } | undefined;
          if (typeof data?.confirmationId !== 'string') {
            throw new Error('工具审批事件缺少 confirmationId');
          }
          waitingToolConfirmationId = data.confirmationId;
        }
        if (event.type === 'error') {
          failure = {
            code: chatTaskEventErrorCode(event.data),
            message: safeChatTaskErrorMessage(
              chatTaskEventErrorMessage(event.data),
            ),
          };
        }
        if (event.type === 'text_delta' && typeof event.data === 'string') {
          generatedContent += event.data;
          const delta = generatedContent.startsWith(persistedContent)
            ? generatedContent.slice(persistedContent.length)
            : '';
          if (delta.length > 0) {
            const written = await this.store.appendAssistantProgress({
              ownerId: task.ownerId,
              sessionId: task.sessionId,
              taskId: task.taskId,
              operationId: task.operationId,
              leaseToken: leaseOwner,
              expectedRevision,
              textOffset: persistedContent.length,
              delta,
            });
            if (written.outcome !== 'committed') return;
            expectedRevision = written.message.revision;
            persistedContent = written.message.content;
            this.events.publish({
              ...this.base(task),
              state: 'running',
              type: 'agent_event',
              eventType: event.type,
              data: delta,
            });
          }
          continue;
        }
        if (event.type === 'assistant_output_complete') {
          const output = assistantOutputData(event.data);
          if (!output) throw new Error('Agent 完成载荷无效');
          const completed = await this.store.completeAssistantOutput({
            ownerId: task.ownerId,
            sessionId: task.sessionId,
            taskId: task.taskId,
            operationId: task.operationId,
            leaseToken: leaseOwner,
            expectedRevision,
            content: output.content,
            chatPreviews: output.chatPreviews,
            contextMessages: output.contextMessages,
          });
          if (completed.outcome === 'committed') {
            outputCommitted = true;
            this.publishState(task, 'completed');
          }
          if (completed.outcome !== 'committed') return;
          continue;
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

      if (this.shouldStop(task.taskId, leaseLost)) return;
      if (waitingToolConfirmationId) {
        if (
          await this.store.markWaitingToolApproval(
            task.taskId,
            task.ownerId,
            waitingToolConfirmationId,
            leaseOwner,
          )
        ) {
          this.publishState(task, 'waiting_tool_approval');
        }
        return;
      }
      if (failure) {
        const failed = await this.store.markFailed(
          task.taskId,
          task.ownerId,
          failure.code,
          failure.message,
          leaseOwner,
        );
        if (failed?.state === 'failed')
          this.publishState(task, 'failed', failure);
        return;
      }
      if (outputCommitted) return;
      if (task.outputMode === 'structured_preview') {
        const failed = await this.store.markFailed(
          task.taskId,
          task.ownerId,
          'STRUCTURED_PREVIEW_MISSING',
          '结构化预览任务未产生 emit_chat_preview 输出。',
          leaseOwner,
        );
        if (failed?.state === 'failed') {
          this.publishState(task, 'failed', {
            code: 'STRUCTURED_PREVIEW_MISSING',
            message: '结构化预览任务未产生 emit_chat_preview 输出。',
          });
        }
        return;
      }
      const completed = await this.store.markCompleted(
        task.taskId,
        task.ownerId,
        leaseOwner,
      );
      if (completed?.state === 'completed') this.publishState(task, 'completed');
    } catch (error) {
      if (this.shouldStop(task.taskId, leaseLost)) return;
      const message = safeChatTaskErrorMessage(
        error instanceof Error ? error.message : '聊天任务执行失败',
      );
      const code = thrownChatTaskErrorCode(error);
      const failed = await this.store.markFailed(
        task.taskId,
        task.ownerId,
        code,
        message,
        leaseOwner,
      );
      if (failed?.state === 'failed') {
        this.publishState(task, 'failed', { code, message });
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  publishState(
    task: AcceptedChatTask,
    state:
      | 'running'
      | 'waiting_privacy_decision'
      | 'waiting_tool_approval'
      | 'completed'
      | 'failed'
      | 'cancelled',
    data?: unknown,
  ) {
    if (this.store.lifecycleOutbox) return;
    this.events.publish({
      ...this.base(task),
      state,
      type: 'state_changed',
      data,
    });
  }

  private shouldStop(taskId: string, leaseLost: boolean) {
    return this.isStopping() || leaseLost || this.isCancelled(taskId);
  }

  private renew(task: AcceptedChatTask, leaseOwner: string) {
    return this.store.renewLease(
      task.taskId,
      task.ownerId,
      leaseOwner,
      this.leaseMs,
    );
  }

  private base(task: AcceptedChatTask) {
    return {
      ownerId: task.ownerId,
      taskId: task.taskId,
      operationId: task.operationId,
      sessionId: task.sessionId,
    };
  }
}
