import { randomUUID } from 'node:crypto';
import type { ServerPushEventTypeV1 } from '@partner-agent/contracts';
import type { DataSource, EntityManager } from 'typeorm';

export const TOOL_CONTROL_OUTBOX_MAX_ATTEMPTS = 8;

export type ToolControlEventType = Extract<
  ServerPushEventTypeV1,
  | 'tool_confirmation_confirmed'
  | 'tool_confirmation_dismissed'
  | 'tool_execution_start'
  | 'tool_execution_end'
  | 'tool_undo_available'
  | 'tool_undo_completed'
>;

export interface ToolControlOutboxRoute {
  id: string;
  ownerId: string;
  sessionId: string;
  taskId?: string | null;
  operationId?: string | null;
}

export interface ToolControlEventIntent {
  key: string;
  type: ToolControlEventType;
  data: Record<string, unknown>;
}

export interface ClaimedToolControlEvent {
  eventId: string;
  eventKey: string;
  ownerId: string;
  sessionId: string;
  taskId: string;
  operationId: string;
  eventType: ToolControlEventType;
  data: Record<string, unknown>;
  attemptCount: number;
  leaseOwner: string;
  leaseToken: string;
}

export class ToolControlOutboxWriter {
  static async append(
    manager: EntityManager,
    route: ToolControlOutboxRoute,
    intents: readonly ToolControlEventIntent[],
  ): Promise<void> {
    if (!route.taskId || !route.operationId || intents.length === 0) return;
    await manager.query('select pg_advisory_xact_lock(hashtext($1))', [
      `tool-control-outbox:${route.sessionId}`,
    ]);
    const sequenceRows = (await manager.query(
      `select coalesce(max(sequence_no)::bigint, -1) + 1 as next_sequence
       from tool_control_outbox where session_id = $1`,
      [route.sessionId],
    )) as Array<{ next_sequence: number | string }>;
    const nextSequence = Number(sequenceRows[0]?.next_sequence ?? 0);
    if (
      !Number.isSafeInteger(nextSequence) ||
      nextSequence < 0 ||
      nextSequence + intents.length - 1 > 2_147_483_647
    ) {
      throw new Error('TOOL_CONTROL_OUTBOX_SEQUENCE_EXHAUSTED');
    }
    const now = new Date();
    for (const [offset, intent] of intents.entries()) {
      await manager.query(
        `insert into tool_control_outbox
          (event_id,event_key,owner_id,session_id,task_id,operation_id,
           event_type,event_data,sequence_no,attempt_count,available_at,
           lease_owner,lease_token,lease_expires_at,delivered_at,last_error_code,
           created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,null,0,null,null,null,$10,$10)
         on conflict (event_key) do nothing`,
        [
          randomUUID(),
          `tool-control:${route.id}:${intent.key}`,
          route.ownerId,
          route.sessionId,
          route.taskId,
          route.operationId,
          intent.type,
          intent.data,
          nextSequence + offset,
          now,
        ],
      );
    }
  }
}

export class TypeOrmToolControlOutbox {
  constructor(private readonly dataSource: DataSource) {}

  async claim(
    leaseOwner: string,
    batchSize: number,
    leaseMs: number,
  ): Promise<ClaimedToolControlEvent[]> {
    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `select event.* from tool_control_outbox event
         where event.delivered_at is null and event.attempt_count < $1
           and event.available_at <= now()
           and (event.lease_expires_at is null or event.lease_expires_at <= now())
           and not exists (
             select 1 from tool_control_outbox earlier
             where earlier.session_id = event.session_id
               and earlier.delivered_at is null
               and (earlier.sequence_no, earlier.event_id) <
                   (event.sequence_no, event.event_id)
           )
         order by event.created_at, event.sequence_no, event.event_id
         limit $2 for update skip locked`,
        [TOOL_CONTROL_OUTBOX_MAX_ATTEMPTS, batchSize],
      )) as Array<Record<string, unknown>>;
      const claimed: ClaimedToolControlEvent[] = [];
      for (const row of rows) {
        const updated = mutationRows(
          await manager.query(
            `update tool_control_outbox
             set lease_owner = $2, lease_token = lease_token + 1,
                 lease_expires_at = now() + ($3::bigint * interval '1 millisecond'),
                 attempt_count = attempt_count + 1, updated_at = now()
             where event_id = $1 and delivered_at is null returning *`,
            [row.event_id, leaseOwner, leaseMs],
          ),
        );
        if (updated[0]) claimed.push(this.map(updated[0]));
      }
      return claimed;
    });
  }

  async acknowledge(event: ClaimedToolControlEvent): Promise<boolean> {
    const rows = mutationRows(
      await this.dataSource.query(
        `update tool_control_outbox
         set delivered_at = now(), lease_owner = null, lease_expires_at = null,
             last_error_code = null, updated_at = now()
         where event_id = $1 and lease_owner = $2 and lease_token = $3
           and delivered_at is null returning event_id`,
        [event.eventId, event.leaseOwner, event.leaseToken],
      ),
    );
    return rows.length === 1;
  }

  async fail(
    event: ClaimedToolControlEvent,
    retryDelayMs: number,
  ): Promise<boolean> {
    const rows = mutationRows(
      await this.dataSource.query(
        `update tool_control_outbox
         set lease_owner = null, lease_expires_at = null,
             available_at = now() + ($4::bigint * interval '1 millisecond'),
             last_error_code = 'OUTBOX_RELAY_FAILED', updated_at = now()
         where event_id = $1 and lease_owner = $2 and lease_token = $3
           and delivered_at is null returning event_id`,
        [event.eventId, event.leaseOwner, event.leaseToken, retryDelayMs],
      ),
    );
    return rows.length === 1;
  }

  private map(row: Record<string, unknown>): ClaimedToolControlEvent {
    return {
      eventId: String(row.event_id),
      eventKey: String(row.event_key),
      ownerId: String(row.owner_id),
      sessionId: String(row.session_id),
      taskId: String(row.task_id),
      operationId: String(row.operation_id),
      eventType: String(row.event_type) as ToolControlEventType,
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
