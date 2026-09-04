import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PiAgentService } from '../agent/pi-agent.service.js';
import { ExternalToolApprovalService } from '../tools/confirmation-center.service.js';
import {
  EGRESS_DECISION_STORE,
  type EgressDecisionStore,
} from '../model-gateway/egress-decision.store.js';
import { ChatTaskEventBus } from './chat-task-event.bus.js';
import { ChatTaskNotifier } from './chat-task-notifier.js';
import { ChatTaskStore, type AcceptedChatTask } from './chat-task.store.js';
import { ChatTaskRunner, type ChatTaskAgentEvent } from './chat-task-runner.js';
import {
  ChatTaskScheduler,
  type PiToolDecision,
  type ToolDecisionClaim,
} from './chat-task-scheduler.contract.js';
export {
  ChatTaskScheduler,
  type PiToolDecision,
  type ToolDecisionClaim,
} from './chat-task-scheduler.contract.js';
import { safeChatTaskErrorMessage } from './chat-task-errors.js';
import {
  NoopObservabilitySink,
  ObservabilitySink,
} from '../observability/observability.types.js';
import {
  ChatTaskSchedulerObservability,
  chatTaskStream,
  positiveInteger,
} from './chat-task-scheduler-observability.js';

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_POLL_MS = 1_000;
const DEFAULT_CONCURRENCY = 4;
@Injectable()
export class PiChatTaskScheduler
  extends ChatTaskScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PiChatTaskScheduler.name);
  private readonly workerId = randomUUID();
  private readonly toolLeaseOwnerPrefix = `tool-decision:${this.workerId}`;
  private readonly cancelledTasks = new Set<string>();
  private readonly activeTasks = new Map<
    string,
    { task: AcceptedChatTask; leaseOwner: string }
  >();
  private readonly pendingToolClaims = new Map<
    string,
    {
      task: AcceptedChatTask;
      confirmationId: string;
      leaseOwner: string;
      heartbeat: ReturnType<typeof setInterval>;
    }
  >();
  private readonly leaseMs: number;
  private readonly pollMs: number;
  private readonly concurrency: number;
  private readonly runner: ChatTaskRunner;
  private readonly metrics: ChatTaskSchedulerObservability;
  private pollTimer?: ReturnType<typeof setInterval>;
  private activeCount = 0;
  private pumping = false;
  private maintainingTools = false;
  private stopping = false;

  constructor(
    private readonly agent: PiAgentService,
    private readonly store: ChatTaskStore,
    private readonly events: ChatTaskEventBus,
    @Inject(EGRESS_DECISION_STORE)
    private readonly decisions: EgressDecisionStore,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly toolApprovals?: ExternalToolApprovalService,
    @Optional() private readonly notifier?: ChatTaskNotifier,
    @Optional()
    private readonly observability: ObservabilitySink = new NoopObservabilitySink(),
  ) {
    super();
    this.leaseMs = positiveInteger(
      config?.get<string>('CHAT_TASK_LEASE_MS'),
      DEFAULT_LEASE_MS,
    );
    this.pollMs = positiveInteger(
      config?.get<string>('CHAT_TASK_POLL_MS'),
      DEFAULT_POLL_MS,
    );
    this.concurrency = positiveInteger(
      config?.get<string>('CHAT_TASK_WORKER_CONCURRENCY'),
      DEFAULT_CONCURRENCY,
    );
    this.metrics = new ChatTaskSchedulerObservability(observability);
    this.runner = new ChatTaskRunner(
      agent,
      store,
      events,
      decisions,
      this.leaseMs,
      () => this.stopping,
      (taskId) => this.cancelledTasks.has(taskId),
      (taskId) => this.cancelledTasks.add(taskId),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.notifier?.start(() => void this.pump());
    await this.metrics.recoverExpired(this.store);
    await this.maintainToolApprovals();
    await this.pump();
    this.pollTimer = setInterval(() => void this.tick(), this.pollMs);
    this.pollTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.notifier?.stop();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    const activeClaims = [...this.activeTasks.values()];
    const activeLeaseOwners = new Set(
      activeClaims.map(({ leaseOwner }) => leaseOwner),
    );
    await Promise.allSettled(
      activeClaims.map(({ task }) =>
        this.agent.cancel(task.sessionId, task.ownerId),
      ),
    );
    const toolLeaseOwners = new Set<string>();
    for (const claim of this.pendingToolClaims.values()) {
      clearInterval(claim.heartbeat);
      toolLeaseOwners.add(claim.leaseOwner);
    }
    this.pendingToolClaims.clear();
    await Promise.all(
      [...activeLeaseOwners].map((owner) => this.store.releaseLeases(owner)),
    );
    await Promise.all(
      [...toolLeaseOwners].map((owner) => this.store.releaseLeases(owner)),
    );
  }

  schedule(task: AcceptedChatTask): void {
    void this.notifier?.notify(task.taskId);
    void this.pump();
  }

  resumeAfterPrivacyDecision(task: AcceptedChatTask): void {
    void this.queuePrivacyResume(task);
  }
  async claimToolDecision(
    task: AcceptedChatTask,
    confirmationId: string,
    toolCallId: string,
    toolName: string,
  ): Promise<ToolDecisionClaim | undefined> {
    if (this.pendingToolClaims.has(task.taskId)) return undefined;
    const leaseOwner = `${this.toolLeaseOwnerPrefix}:${randomUUID()}:${confirmationId}`;
    const claimed = await this.store.claimToolResume(
      task.taskId,
      task.ownerId,
      confirmationId,
      leaseOwner,
      this.leaseMs,
    );
    if (!claimed) return undefined;
    try {
      if (
        !(await this.agent.hasToolDecisionContext(
          claimed.sessionId,
          claimed.ownerId,
          toolCallId,
          toolName,
        ))
      ) {
        await this.failUnrecoverableToolClaim(claimed, leaseOwner);
        return undefined;
      }
    } catch {
      await this.failUnrecoverableToolClaim(claimed, leaseOwner);
      return undefined;
    }
    const heartbeat = this.startLeaseHeartbeat(
      claimed,
      confirmationId,
      leaseOwner,
    );
    this.pendingToolClaims.set(task.taskId, {
      task: claimed,
      confirmationId,
      leaseOwner,
      heartbeat,
    });
    return { confirmationId, leaseToken: leaseOwner };
  }

  resumeClaimedToolDecision(
    task: AcceptedChatTask,
    claim: ToolDecisionClaim,
    decision: PiToolDecision,
  ): void {
    const claimed = this.takeToolClaim(task.taskId, claim);
    if (!claimed) return;
    this.startClaimed(
      claimed.task,
      this.agent.continueAfterToolDecision(
        claimed.task.sessionId,
        claimed.task.ownerId,
        decision,
        {
          taskId: claimed.task.taskId,
          operationId: claimed.task.operationId,
          source: 'tool_approval_resume',
        },
      ),
      claimed.leaseOwner,
    );
  }

  async failClaimedToolDecision(
    task: AcceptedChatTask,
    claim: ToolDecisionClaim,
    error: unknown,
  ): Promise<void> {
    const claimed = this.takeToolClaim(task.taskId, claim);
    if (!claimed) return;
    const message = safeChatTaskErrorMessage(
      error instanceof Error ? error.message : '工具审批执行失败',
    );
    const failed = await this.store.markFailed(
      claimed.task.taskId,
      claimed.task.ownerId,
      'TOOL_001',
      message,
      claimed.leaseOwner,
    );
    if (failed?.state === 'failed') {
      this.runner.publishState(claimed.task, 'failed', {
        code: 'TOOL_001',
        message,
      });
    }
    void this.pump();
  }

  async expireToolDecision(
    task: AcceptedChatTask,
    confirmationId: string,
  ): Promise<boolean> {
    return this.failWaitingToolDecision(
      task,
      confirmationId,
      'TOOL_002',
      '工具审批已过期',
    );
  }

  async failIndeterminateToolDecision(
    task: AcceptedChatTask,
    confirmationId: string,
  ): Promise<boolean> {
    return this.failWaitingToolDecision(
      task,
      confirmationId,
      'TOOL_003',
      '工具执行结果不确定，需要人工核对',
    );
  }
  private async failWaitingToolDecision(
    task: AcceptedChatTask,
    confirmationId: string,
    code: string,
    message: string,
  ): Promise<boolean> {
    const failed = await this.store.failWaitingToolApproval(
      task.taskId,
      task.ownerId,
      confirmationId,
      code,
      message,
    );
    if (failed?.state !== 'failed') return false;
    this.runner.publishState(task, 'failed', {
      code,
      message,
    });
    void this.pump();
    return true;
  }

  async cancel(task: AcceptedChatTask): Promise<void> {
    this.cancelledTasks.add(task.taskId);
    this.takeToolClaim(task.taskId);
    try {
      await this.agent.cancel(task.sessionId, task.ownerId);
    } catch {
      // 持久任务状态是权威源；执行任务可能位于另一进程或已经结束。
    } finally {
      this.runner.publishState(task, 'cancelled');
      void this.pump();
    }
  }

  private async queuePrivacyResume(task: AcceptedChatTask): Promise<void> {
    const queued = await this.store.claimPrivacyResume(
      task.taskId,
      task.ownerId,
    );
    if (queued) {
      void this.notifier?.notify(task.taskId);
      await this.pump();
    }
  }

  private startLeaseHeartbeat(
    task: AcceptedChatTask,
    confirmationId: string,
    leaseOwner: string,
  ): ReturnType<typeof setInterval> {
    let renewing = false;
    const heartbeat = setInterval(
      () => {
        if (renewing) return;
        renewing = true;
        void this.renew(task, leaseOwner)
          .then((renewed) => {
            if (!renewed) {
              this.takeToolClaim(task.taskId, {
                confirmationId,
                leaseToken: leaseOwner,
              });
            }
          })
          .catch(() =>
            this.takeToolClaim(task.taskId, {
              confirmationId,
              leaseToken: leaseOwner,
            }),
          )
          .finally(() => {
            renewing = false;
          });
      },
      Math.max(100, Math.floor(this.leaseMs / 3)),
    );
    heartbeat.unref?.();
    return heartbeat;
  }

  private takeToolClaim(taskId: string, handle?: ToolDecisionClaim) {
    const claim = this.pendingToolClaims.get(taskId);
    if (!claim) return undefined;
    if (
      handle &&
      (handle.leaseToken !== claim.leaseOwner ||
        handle.confirmationId !== claim.confirmationId)
    ) {
      return undefined;
    }
    clearInterval(claim.heartbeat);
    this.pendingToolClaims.delete(taskId);
    return claim;
  }

  private async failUnrecoverableToolClaim(
    task: AcceptedChatTask,
    leaseOwner: string,
  ) {
    const message = '工具审批上下文不可恢复';
    const failed = await this.store.markFailed(
      task.taskId,
      task.ownerId,
      'TOOL_001',
      message,
      leaseOwner,
    );
    if (failed?.state === 'failed') {
      this.runner.publishState(task, 'failed', { code: 'TOOL_001', message });
    }
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.stopping) return;
    this.pumping = true;
    try {
      await this.metrics.recoverExpired(this.store);
      while (!this.stopping && this.activeCount < this.concurrency) {
        const leaseOwner = `worker:${this.workerId}:${randomUUID()}`;
        const task = await this.metrics.claim(
          this.store,
          leaseOwner,
          this.leaseMs,
        );
        if (!task) break;
        this.startClaimed(task, chatTaskStream(this.agent, task), leaseOwner);
      }
    } catch (error) {
      this.logger.error(
        `ChatTask worker pump failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.pumping = false;
    }
  }

  private async tick(): Promise<void> {
    await this.maintainToolApprovals();
    await this.pump();
  }

  private async maintainToolApprovals(): Promise<void> {
    if (!this.toolApprovals || this.maintainingTools || this.stopping) return;
    this.maintainingTools = true;
    try {
      const expired = await this.toolApprovals.expirePendingConfirmations();
      for (const item of expired) {
        const task = await this.store.getTask(item.ownerId, item.taskId);
        if (task && task.sessionId === item.sessionId) {
          await this.expireToolDecision(task, item.confirmationId);
        }
      }
      const stale = await this.toolApprovals.reconcileStaleConfirmations();
      for (const item of stale) {
        const task = await this.store.getTask(item.ownerId, item.taskId);
        if (!task || task.sessionId !== item.sessionId) continue;
        if (item.status === 'expired') {
          await this.expireToolDecision(task, item.confirmationId);
        } else if (item.status === 'indeterminate') {
          await this.failIndeterminateToolDecision(task, item.confirmationId);
        } else {
          await this.failWaitingToolDecision(
            task,
            item.confirmationId,
            'TOOL_001',
            '工具执行失败',
          );
        }
      }
      const recoverable = await this.toolApprovals.listRecoverableDecisions();
      for (const item of recoverable) {
        const task = await this.store.getTask(item.ownerId, item.taskId);
        if (!task || task.sessionId !== item.sessionId) continue;
        const claim = await this.claimToolDecision(
          task,
          item.confirmationId,
          item.toolCallId,
          item.tool,
        );
        if (!claim) continue;
        this.resumeClaimedToolDecision(task, claim, {
          toolCallId: item.toolCallId,
          toolName: item.tool,
          result: item.outcome.result,
          isError: item.decision === 'dismissed',
        });
      }
    } catch (error) {
      this.logger.error(
        `Tool approval maintenance failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.maintainingTools = false;
    }
  }
  private startClaimed(
    task: AcceptedChatTask,
    stream: AsyncGenerator<ChatTaskAgentEvent>,
    leaseOwner: string,
  ): void {
    this.activeCount += 1;
    this.activeTasks.set(task.taskId, { task, leaseOwner });
    void this.runner.run(task, stream, leaseOwner).finally(() => {
      this.activeCount -= 1;
      this.activeTasks.delete(task.taskId);
      this.cancelledTasks.delete(task.taskId);
      queueMicrotask(() => void this.pump());
    });
  }

  private renew(task: AcceptedChatTask, leaseOwner: string) {
    return this.metrics.renew(
      this.store,
      task.taskId,
      task.ownerId,
      leaseOwner,
      this.leaseMs,
    );
  }
}
