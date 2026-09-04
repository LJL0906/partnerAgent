import type { EntityManager } from 'typeorm';
import { ChatTaskEntity } from '../database/entities/chat-task.entity.js';
import { ChatTaskLifecycleOutboxWriter } from './chat-task-lifecycle-outbox.js';

export class TypeOrmChatTaskRecovery {
  static async recover(manager: EntityManager, now = new Date()) {
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
      .returning('*')
      .execute();
    await this.append(manager, toolDecision.raw as Array<{ id: string }>);

    const pendingTool = await manager
      .createQueryBuilder()
      .update(ChatTaskEntity)
      .set({
        state: 'waiting_tool_approval',
        waitingToolConfirmationId: () => `(
          select confirmation.id from tool_confirmation_requests confirmation
          where confirmation.owner_id = chat_tasks.owner_id
            and confirmation.task_id = chat_tasks.id
            and confirmation.status = 'pending'
          order by confirmation.created_at desc, confirmation.id desc limit 1
        )`,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where('state = :running', { running: 'running' })
      .andWhere('(lease_expires_at is null or lease_expires_at <= :now)', {
        now,
      })
      .andWhere(`exists (
        select 1 from tool_confirmation_requests confirmation
        where confirmation.owner_id = chat_tasks.owner_id
          and confirmation.task_id = chat_tasks.id
          and confirmation.status = 'pending'
      )`)
      .returning('*')
      .execute();
    await this.append(manager, pendingTool.raw as Array<{ id: string }>);

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
      .returning('*')
      .execute();
    await this.append(manager, queued.raw as Array<{ id: string }>);
    return (
      (toolDecision.affected ?? 0) +
      (pendingTool.affected ?? 0) +
      (queued.affected ?? 0)
    );
  }

  private static async append(
    manager: EntityManager,
    rows: Array<{ id: string }>,
  ): Promise<void> {
    for (const row of rows) {
      const task = await manager
        .getRepository(ChatTaskEntity)
        .findOneByOrFail({ id: row.id });
      await ChatTaskLifecycleOutboxWriter.append(manager, task);
    }
  }
}
