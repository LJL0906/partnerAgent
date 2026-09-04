import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EGRESS_DECISION_STORE,
  EgressDecisionConflictError,
  EgressDecisionExpiredError,
  EgressDecisionIdempotencyConflictError,
  EgressDecisionNotFoundError,
  type EgressDecisionStore,
  type PrivacyDecision,
  type StoredEgressDecision,
  type SubmitEgressDecisionResult,
} from '../model-gateway/egress-decision.store.js';
import { ChatTaskEventBus } from './chat-task-event.bus.js';
import { ChatTaskScheduler } from './chat-task-scheduler.js';
import { ChatTaskStore, type StoredChatTask } from './chat-task.store.js';
import type { LocalCoreCommandRequest } from './local-core-api.types.js';

@Injectable()
export class PrivacyDecisionService implements OnModuleInit, OnModuleDestroy {
  private scanTimer?: ReturnType<typeof setInterval>;
  private maintaining = false;

  constructor(
    @Inject(EGRESS_DECISION_STORE)
    private readonly decisions: EgressDecisionStore,
    private readonly tasks: ChatTaskStore,
    private readonly scheduler: ChatTaskScheduler,
    private readonly events: ChatTaskEventBus,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.maintain();
    const intervalMs = this.positiveInteger(
      this.config.get<string>('PRIVACY_DECISION_SCAN_INTERVAL_MS'),
      5_000,
    );
    this.scanTimer = setInterval(() => void this.maintain(), intervalMs);
    this.scanTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = undefined;
  }

  async submit(request: LocalCoreCommandRequest): Promise<unknown> {
    const payload = this.payload(request);
    const egressId = this.requiredString(payload, 'egress_id');
    const decision = payload.decision;
    if (!['allow', 'redact', 'block'].includes(String(decision))) {
      throw new HttpException(
        {
          code: 'VALIDATION_001',
          message: 'decision 必须是 allow、redact 或 block',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const submitted = await this.persistDecision({
      ownerId: request.userId,
      egressId,
      decision: decision as PrivacyDecision,
      commandOperationId: this.requiredString(request.envelope, 'operation_id'),
      commandRequestFingerprint: this.requiredString(
        request.envelope,
        'request_fingerprint',
      ),
    });

    const task = await this.tasks.getTask(
      submitted.record.ownerId,
      submitted.record.taskId,
    );
    if (!task) {
      throw new NotFoundException({ code: 'AUTH_002', message: '资源不存在' });
    }
    if (submitted.record.state === 'blocked') {
      await this.failWaitingTask(task, '用户已阻止本次外发');
      return submitted.result;
    }
    if (submitted.result.status === 'duplicate') return submitted.result;
    if (task.state === 'cancelled') {
      await this.decisions.cancelPendingForTask(task.taskId, task.ownerId);
      throw new HttpException(
        { code: 'TASK_001', message: '任务已取消' },
        HttpStatus.CONFLICT,
      );
    }
    if (task.state !== 'waiting_privacy_decision') {
      throw new HttpException(
        { code: 'EGRESS_001', message: '隐私请求与当前任务状态不匹配' },
        HttpStatus.CONFLICT,
      );
    }
    this.scheduler.resumeAfterPrivacyDecision(task);
    return submitted.result;
  }

  private async persistDecision(input: {
    ownerId: string;
    egressId: string;
    decision: PrivacyDecision;
    commandOperationId: string;
    commandRequestFingerprint: string;
  }): Promise<SubmitEgressDecisionResult> {
    try {
      return await this.decisions.submitDecision(input);
    } catch (error) {
      return this.mapSubmitError(error, input.ownerId, input.egressId);
    }
  }

  async currentForTask(taskId: string, ownerId: string) {
    const record = await this.decisions.findCurrentForTask(taskId, ownerId);
    return record ? this.summary(record) : undefined;
  }

  async cancelForTask(taskId: string, ownerId: string): Promise<void> {
    await this.decisions.cancelPendingForTask(taskId, ownerId);
  }

  private async maintain(): Promise<void> {
    if (this.maintaining) return;
    this.maintaining = true;
    try {
      await this.sweepExpired();
      await this.reconcileWaitingTasks();
    } finally {
      this.maintaining = false;
    }
  }

  private async reconcileWaitingTasks(): Promise<void> {
    for (const task of await this.tasks.listWaitingPrivacyTasks()) {
      const record = await this.decisions.findLatestForTask(
        task.taskId,
        task.ownerId,
      );
      if (!record) continue;
      if (record.state === 'ready_allow' || record.state === 'ready_redact') {
        this.scheduler.resumeAfterPrivacyDecision(task);
      } else if (record.state === 'blocked') {
        await this.failWaitingTask(task, '用户已阻止本次外发');
      } else if (record.state === 'expired') {
        await this.failWaitingTask(task, '隐私决定已过期');
      }
    }
  }

  private async sweepExpired(): Promise<void> {
    for (const record of await this.decisions.expireDue()) {
      const task = await this.tasks.getTask(record.ownerId, record.taskId);
      if (task) await this.failWaitingTask(task, '隐私决定已过期');
    }
  }

  private async failWaitingTask(
    task: StoredChatTask,
    message: string,
  ): Promise<void> {
    if (task.state !== 'waiting_privacy_decision') return;
    const failed = await this.tasks.failWaitingPrivacyDecision(
      task.taskId,
      task.ownerId,
      'EGRESS_001',
      message,
    );
    if (failed?.state === 'failed') this.publishTerminal(failed);
  }

  private publishTerminal(task: StoredChatTask): void {
    if (this.tasks.lifecycleOutbox) return;
    this.events.publish({
      ownerId: task.ownerId,
      taskId: task.taskId,
      operationId: task.operationId,
      sessionId: task.sessionId,
      state: 'failed',
      type: 'state_changed',
      data: { code: 'EGRESS_001', message: task.errorMessage },
    });
  }

  private summary(record: StoredEgressDecision) {
    return {
      egress_id: record.id,
      categories: [...record.categories],
      provider: record.provider,
      model_id: record.modelId,
      expires_at: record.expiresAt.toISOString(),
    };
  }

  private async mapSubmitError(
    error: unknown,
    ownerId: string,
    egressId: string,
  ): Promise<never> {
    if (error instanceof EgressDecisionNotFoundError) {
      throw new NotFoundException({ code: 'AUTH_002', message: '资源不存在' });
    }
    if (error instanceof EgressDecisionIdempotencyConflictError) {
      throw new HttpException(
        { code: 'IDEMPOTENCY_001', message: '幂等标识对应的请求不一致' },
        HttpStatus.CONFLICT,
      );
    }
    if (error instanceof EgressDecisionExpiredError) {
      const record = await this.decisions.findByIdForOwner(egressId, ownerId);
      if (record) {
        const task = await this.tasks.getTask(ownerId, record.taskId);
        if (task) await this.failWaitingTask(task, '隐私决定已过期');
      }
      throw new HttpException(
        { code: 'EGRESS_001', message: '隐私决定已过期' },
        HttpStatus.FORBIDDEN,
      );
    }
    if (error instanceof EgressDecisionConflictError) {
      throw new HttpException(
        { code: 'EGRESS_001', message: '隐私请求当前不可决定' },
        HttpStatus.CONFLICT,
      );
    }
    throw error;
  }

  private payload(request: LocalCoreCommandRequest): Record<string, unknown> {
    const payload = request.envelope.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new HttpException(
        { code: 'VALIDATION_001', message: 'payload 必须是对象' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return payload as Record<string, unknown>;
  }

  private requiredString(input: Record<string, unknown>, field: string) {
    const value = input[field];
    if (typeof value !== 'string' || !value.trim()) {
      throw new HttpException(
        {
          code: 'VALIDATION_002',
          message: `缺少 ${field}`,
          details: { field },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return value;
  }

  private positiveInteger(value: string | undefined, fallback: number) {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error('PRIVACY_DECISION_SCAN_INTERVAL_MS 必须是正整数');
    }
    return parsed;
  }
}
