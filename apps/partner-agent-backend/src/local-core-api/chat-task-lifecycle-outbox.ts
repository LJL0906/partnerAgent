import { randomUUID } from 'node:crypto';
import type { EntityManager, DataSource } from 'typeorm';
import { ChatTaskLifecycleOutboxEntity } from '../database/entities/chat-task-outbox.entity.js';
import type {
  ChatTaskEntity,
  ChatTaskState,
} from '../database/entities/chat-task.entity.js';

export interface ClaimedChatTaskLifecycleEvent {
  eventId: string;
  eventKey: string;
  ownerId: string;
  taskId: string;
  operationId: string;
  sessionId: string;
  state: ChatTaskState;
  data: Record<string, unknown>;
  attemptCount: number;
  leaseOwner: string;
  leaseToken: string;
}

export class ChatTaskLifecycleOutboxWriter {
  static async append(
    manager: EntityManager,
    task: ChatTaskEntity,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const eventId = randomUUID();
    const now = new Date();
    const repository = manager.getRepository(ChatTaskLifecycleOutboxEntity);
    const event = repository.create({
      eventId,
      eventKey: `chat-task:${task.id}:${eventId}`,
      ownerId: task.ownerId,
      taskId: task.id,
      operationId: task.operationId,
      sessionId: task.sessionId,
      state: task.state,
      eventData: data,
      attemptCount: 0,
      availableAt: now,
      leaseOwner: null,
      leaseToken: '0',
      leaseExpiresAt: null,
      deliveredAt: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    event.eventData = data;
    await repository.save(event);
  }
}

export class TypeOrmChatTaskLifecycleOutbox {
  constructor(private readonly dataSource: DataSource) {}

  async claim(
    leaseOwner: string,
    batchSize: number,
    leaseMs: number,
    maxAttempts: number,
  ): Promise<ClaimedChatTaskLifecycleEvent[]> {
    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `select event.* from chat_task_lifecycle_outbox event
         where event.delivered_at is null and event.attempt_count < $1
           and event.available_at <= now()
           and (event.lease_expires_at is null or event.lease_expires_at <= now())
           and not exists (
             select 1 from chat_task_lifecycle_outbox earlier
             where earlier.session_id = event.session_id and earlier.delivered_at is null
               and (earlier.created_at, earlier.event_id) <
                   (event.created_at, event.event_id)
           )
         order by event.created_at asc, event.event_id asc
         limit $2 for update skip locked`,
        [maxAttempts, batchSize],
      )) as Array<Record<string, unknown>>;
      const claimed: ClaimedChatTaskLifecycleEvent[] = [];
      for (const row of rows) {
        const updated = mutationRows(await manager.query(
          `update chat_task_lifecycle_outbox
           set lease_owner = $2, lease_token = lease_token + 1,
               lease_expires_at = now() + ($3::bigint * interval '1 millisecond'),
               attempt_count = attempt_count + 1, updated_at = now()
           where event_id = $1 and delivered_at is null
           returning *`,
          [row.event_id, leaseOwner, leaseMs],
        ));
        if (updated[0]) claimed.push(this.map(updated[0]));
      }
      return claimed;
    });
  }

  async acknowledge(event: ClaimedChatTaskLifecycleEvent): Promise<boolean> {
    const result = mutationRows(await this.dataSource.query(
      `update chat_task_lifecycle_outbox
       set delivered_at = now(), lease_owner = null, lease_expires_at = null,
           last_error_code = null, updated_at = now()
       where event_id = $1 and lease_owner = $2 and lease_token = $3
         and delivered_at is null returning event_id`,
      [event.eventId, event.leaseOwner, event.leaseToken],
    ));
    return result.length === 1;
  }

  async fail(
    event: ClaimedChatTaskLifecycleEvent,
    retryDelayMs: number,
    errorCode = 'OUTBOX_RELAY_FAILED',
  ): Promise<boolean> {
    const result = mutationRows(await this.dataSource.query(
      `update chat_task_lifecycle_outbox
       set lease_owner = null, lease_expires_at = null,
           available_at = now() + ($4::bigint * interval '1 millisecond'),
           last_error_code = $5, updated_at = now()
       where event_id = $1 and lease_owner = $2 and lease_token = $3
         and delivered_at is null returning event_id`,
      [
        event.eventId,
        event.leaseOwner,
        event.leaseToken,
        retryDelayMs,
        errorCode,
      ],
    ));
    return result.length === 1;
  }

  private map(row: Record<string, unknown>): ClaimedChatTaskLifecycleEvent {
    return {
      eventId: String(row.event_id),
      eventKey: String(row.event_key),
      ownerId: String(row.owner_id),
      taskId: String(row.task_id),
      operationId: String(row.operation_id),
      sessionId: String(row.session_id),
      state: String(row.state) as ChatTaskState,
      data: (row.event_data ?? {}) as Record<string, unknown>,
      attemptCount: Number(row.attempt_count),
      leaseOwner: String(row.lease_owner),
      leaseToken: String(row.lease_token),
    };
  }
}

function mutationRows(result: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(result)) return [];
  const rows = Array.isArray(result[0]) ? result[0] : result;
  return rows.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  );
}
