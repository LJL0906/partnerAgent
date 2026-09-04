import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { ChatTaskEntity } from '../database/entities/chat-task.entity.js';
import { SessionMessageEntity } from '../database/entities/session-message.entity.js';
import type { StoredChatTask } from './chat-task.store.js';

type LoadStoredTask = (
  manager: EntityManager,
  task: ChatTaskEntity,
) => Promise<StoredChatTask>;

export class TypeOrmChatTaskRuntime {
  constructor(
    private readonly dataSource: DataSource,
    private readonly loadStored: LoadStoredTask,
  ) {}

  async listWaitingPrivacyTasks() {
    const tasks = await this.dataSource.getRepository(ChatTaskEntity).find({
      where: { state: 'waiting_privacy_decision' },
      order: { createdAt: 'ASC' },
    });
    return Promise.all(
      tasks.map((task) => this.loadStored(this.dataSource.manager, task)),
    );
  }

  async failWaitingPrivacyDecision(
    taskId: string,
    ownerId: string,
    code: string,
    message: string,
  ) {
    return this.finishWaiting(
      taskId,
      ownerId,
      'waiting_privacy_decision',
      undefined,
      code,
      message,
    );
  }

  async markRunning(taskId: string, ownerId: string) {
    return this.dataSource.transaction(async (manager) => {
      const task = await manager.getRepository(ChatTaskEntity).findOne({
        where: { id: taskId, ownerId, state: 'queued' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task) return false;
      await this.lockSession(manager, task.sessionId);
      const blockers = await manager
        .getRepository(ChatTaskEntity)
        .createQueryBuilder('task')
        .where('task.session_id = :sessionId', { sessionId: task.sessionId })
        .andWhere('task.id <> :taskId', { taskId })
        .andWhere(
          "task.state in ('running','waiting_privacy_decision','waiting_tool_approval')",
        )
        .getCount();
      if (blockers > 0) return false;
      this.startLease(task, 'legacy-direct-claim', 30_000);
      await manager.getRepository(ChatTaskEntity).save(task);
      return true;
    });
  }

  async recoverExpiredLeases(now = new Date()) {
    return this.dataSource.transaction((manager) =>
      this.recoverExpiredLeasesWithManager(manager, now),
    );
  }

  async claimNextRunnable(leaseOwner: string, leaseDurationMs: number) {
    return this.dataSource.transaction(async (manager) => {
      await this.recoverExpiredLeasesWithManager(manager);
      const candidate = await manager
        .getRepository(ChatTaskEntity)
        .createQueryBuilder('task')
        .where('task.state = :queued', { queued: 'queued' })
        .andWhere(
          `not exists (
            select 1 from chat_tasks active
            where active.session_id = task.session_id
              and active.state in (
                'running','waiting_privacy_decision','waiting_tool_approval'
              )
          )`,
        )
        .orderBy('task.created_at', 'ASC')
        .addOrderBy('task.id', 'ASC')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getOne();
      if (!candidate) return undefined;

      await this.lockSession(manager, candidate.sessionId);
      const running = await manager.getRepository(ChatTaskEntity).count({
        where: { sessionId: candidate.sessionId, state: 'running' },
      });
      if (running > 0) return undefined;
      this.startLease(candidate, leaseOwner, leaseDurationMs);
      await manager.getRepository(ChatTaskEntity).save(candidate);
      return this.loadStored(manager, candidate);
    });
  }

  async renewLease(
    taskId: string,
    ownerId: string,
    leaseOwner: string,
    leaseDurationMs: number,
  ) {
    const now = new Date();
    const result = await this.dataSource.getRepository(ChatTaskEntity).update(
      { id: taskId, ownerId, state: 'running', leaseOwner },
      {
        leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
        updatedAt: now,
      },
    );
    return Boolean(result.affected);
  }

  async releaseLeases(leaseOwner: string) {
    const releasedState = leaseOwner.startsWith('tool-decision:')
      ? 'waiting_tool_approval'
      : 'queued';
    const waitingToolConfirmationId =
      this.toolConfirmationIdFromLeaseOwner(leaseOwner);
    const result = await this.dataSource.getRepository(ChatTaskEntity).update(
      { state: 'running', leaseOwner },
      {
        state: releasedState,
        waitingToolConfirmationId: waitingToolConfirmationId ?? null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      },
    );
    return result.affected ?? 0;
  }

  async claimPrivacyResume(taskId: string, ownerId: string) {
    return this.claimWaitingTask(taskId, ownerId, 'waiting_privacy_decision');
  }

  async claimToolResume(
    taskId: string,
    ownerId: string,
    confirmationId: string,
    leaseOwner: string,
    leaseDurationMs: number,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const task = await manager.getRepository(ChatTaskEntity).findOne({
        where: {
          id: taskId,
          ownerId,
          state: 'waiting_tool_approval',
          waitingToolConfirmationId: confirmationId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task) return undefined;
      await this.lockSession(manager, task.sessionId);
      const running = await manager.getRepository(ChatTaskEntity).count({
        where: { sessionId: task.sessionId, state: 'running' },
      });
      if (running > 0) return undefined;
      this.startLease(task, leaseOwner, leaseDurationMs);
      await manager.getRepository(ChatTaskEntity).save(task);
      return this.loadStored(manager, task);
    });
  }

  async markWaiting(taskId: string, ownerId: string, leaseOwner?: string) {
    return this.updateWaitingState(
      taskId,
      ownerId,
      'waiting_privacy_decision',
      undefined,
      leaseOwner,
    );
  }

  async markWaitingToolApproval(
    taskId: string,
    ownerId: string,
    confirmationId: string,
    leaseOwner?: string,
  ) {
    return this.updateWaitingState(
      taskId,
      ownerId,
      'waiting_tool_approval',
      confirmationId,
      leaseOwner,
    );
  }

  async failWaitingToolApproval(
    taskId: string,
    ownerId: string,
    confirmationId: string,
    code: string,
    message: string,
  ) {
    return this.finishWaiting(
      taskId,
      ownerId,
      'waiting_tool_approval',
      confirmationId,
      code,
      message,
    );
  }

  private async finishWaiting(
    taskId: string,
    ownerId: string,
    waitingState: 'waiting_privacy_decision' | 'waiting_tool_approval',
    confirmationId: string | undefined,
    code: string,
    message: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const task = await manager.getRepository(ChatTaskEntity).findOne({
        where: { id: taskId, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task) return undefined;
      if (
        task.state !== waitingState ||
        (confirmationId !== undefined &&
          task.waitingToolConfirmationId !== confirmationId)
      ) {
        return undefined;
      }
      task.state = 'failed';
      task.waitingToolConfirmationId = null;
      task.errorCode = code;
      task.errorMessage = message;
      task.completedAt = new Date();
      task.updatedAt = task.completedAt;
      await manager.getRepository(ChatTaskEntity).save(task);
      return this.loadStored(manager, task);
    });
  }

  async markCompleted(taskId: string, ownerId: string, leaseOwner?: string) {
    return this.finish(
      taskId,
      ownerId,
      'completed',
      undefined,
      undefined,
      leaseOwner,
    );
  }

  async markFailed(
    taskId: string,
    ownerId: string,
    code: string,
    message: string,
    leaseOwner?: string,
  ) {
    return this.finish(taskId, ownerId, 'failed', code, message, leaseOwner);
  }

  private async finish(
    taskId: string,
    ownerId: string,
    state: 'completed' | 'failed',
    errorCode?: string,
    errorMessage?: string,
    leaseOwner?: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const task = await manager.getRepository(ChatTaskEntity).findOne({
        where: { id: taskId, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task) return undefined;
      if (['completed', 'failed', 'cancelled'].includes(task.state)) {
        return this.loadStored(manager, task);
      }
      if (
        leaseOwner !== undefined &&
        (task.state !== 'running' || task.leaseOwner !== leaseOwner)
      ) {
        return this.loadStored(manager, task);
      }
      if (state === 'completed') {
        const message = await manager
          .getRepository(SessionMessageEntity)
          .findOne({
            where: {
              ownerId,
              sessionId: task.sessionId,
              role: 'assistant',
              taskId: IsNull(),
            },
            order: { sequence: 'DESC' },
          });
        if (message) {
          message.taskId = task.id;
          await manager.getRepository(SessionMessageEntity).save(message);
          task.resultMessageId = message.id;
        }
      }
      task.state = state;
      task.waitingToolConfirmationId = null;
      task.leaseOwner = null;
      task.leaseExpiresAt = null;
      task.errorCode = errorCode ?? null;
      task.errorMessage = errorMessage ?? null;
      task.completedAt = new Date();
      task.updatedAt = task.completedAt;
      await manager.getRepository(ChatTaskEntity).save(task);
      return this.loadStored(manager, task);
    });
  }

  private async claimWaitingTask(
    taskId: string,
    ownerId: string,
    waitingState: 'waiting_privacy_decision' | 'waiting_tool_approval',
  ) {
    const claimed = await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(ChatTaskEntity)
        .set({
          state: 'queued',
          waitingToolConfirmationId: null,
          updatedAt: () => 'CURRENT_TIMESTAMP',
        })
        .where(
          'id = :taskId and owner_id = :ownerId and state = :waitingState',
          { taskId, ownerId, waitingState },
        )
        .returning('*')
        .execute();
      return result.raw[0] as ChatTaskEntity | undefined;
    });
    if (!claimed) return undefined;
    const task = await this.dataSource
      .getRepository(ChatTaskEntity)
      .findOneBy({ id: taskId, ownerId });
    return task ? this.loadStored(this.dataSource.manager, task) : undefined;
  }

  private async updateWaitingState(
    taskId: string,
    ownerId: string,
    state: 'waiting_privacy_decision' | 'waiting_tool_approval',
    confirmationId: string | undefined,
    leaseOwner?: string,
  ) {
    const query = this.dataSource
      .createQueryBuilder()
      .update(ChatTaskEntity)
      .set({
        state,
        waitingToolConfirmationId: confirmationId ?? null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where('id = :taskId and owner_id = :ownerId and state = :runningState', {
        taskId,
        ownerId,
        runningState: 'running',
      });
    if (leaseOwner !== undefined) {
      query.andWhere('lease_owner = :leaseOwner', { leaseOwner });
    }
    const result = await query.execute();
    return Boolean(result.affected);
  }

  private async recoverExpiredLeasesWithManager(
    manager: EntityManager,
    now = new Date(),
  ) {
    const toolDecision = await manager
      .createQueryBuilder()
      .update(ChatTaskEntity)
      .set({
        state: 'waiting_tool_approval',
        waitingToolConfirmationId: () =>
          "regexp_replace(lease_owner, '^tool-decision:[^:]+:[^:]+:', '')::uuid",
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where('state = :running', { running: 'running' })
      .andWhere("lease_owner like 'tool-decision:%'")
      .andWhere('(lease_expires_at is null or lease_expires_at <= :now)', {
        now,
      })
      .execute();

    const pendingTool = await manager
      .createQueryBuilder()
      .update(ChatTaskEntity)
      .set({
        state: 'waiting_tool_approval',
        waitingToolConfirmationId: () => `(
          select confirmation.id
          from tool_confirmation_requests confirmation
          where confirmation.owner_id = chat_tasks.owner_id
            and confirmation.task_id = chat_tasks.id
            and confirmation.status = 'pending'
          order by confirmation.created_at desc, confirmation.id desc
          limit 1
        )`,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where('state = :running', { running: 'running' })
      .andWhere('(lease_expires_at is null or lease_expires_at <= :now)', {
        now,
      })
      .andWhere(
        `exists (
        select 1
        from tool_confirmation_requests confirmation
        where confirmation.owner_id = chat_tasks.owner_id
          and confirmation.task_id = chat_tasks.id
          and confirmation.status = 'pending'
      )`,
      )
      .execute();

    const queued = await manager
      .createQueryBuilder()
      .update(ChatTaskEntity)
      .set({
        state: 'queued',
        waitingToolConfirmationId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where('state = :running', { running: 'running' })
      .andWhere('(lease_expires_at is null or lease_expires_at <= :now)', {
        now,
      })
      .execute();
    return (
      (toolDecision.affected ?? 0) +
      (pendingTool.affected ?? 0) +
      (queued.affected ?? 0)
    );
  }

  private startLease(
    task: ChatTaskEntity,
    leaseOwner: string,
    leaseDurationMs: number,
  ) {
    const now = new Date();
    task.state = 'running';
    task.waitingToolConfirmationId = null;
    task.leaseOwner = leaseOwner;
    task.leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
    task.attemptCount += 1;
    task.startedAt ??= now;
    task.updatedAt = now;
  }

  private lockSession(manager: EntityManager, sessionId: string) {
    return manager.query('select pg_advisory_xact_lock(hashtext($1))', [
      `chat-task-session:${sessionId}`,
    ]);
  }

  private toolConfirmationIdFromLeaseOwner(leaseOwner: string) {
    if (!leaseOwner.startsWith('tool-decision:')) return undefined;
    return leaseOwner.slice(leaseOwner.lastIndexOf(':') + 1);
  }
}
