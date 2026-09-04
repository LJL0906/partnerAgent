import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

export const OUTBOX_KINDS = ['chat_task', 'tool_control'] as const;
export const OUTBOX_REMEDIATION_ACTIONS = ['retry', 'discard'] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];
export type OutboxRemediationAction =
  (typeof OUTBOX_REMEDIATION_ACTIONS)[number];

export interface PoisonedOutboxEvent {
  kind: OutboxKind;
  eventId: string;
  eventKey: string;
  sessionId: string;
  taskId: string;
  operationId: string;
  attemptCount: number;
  lastErrorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RemediateOutboxInput {
  kind: OutboxKind;
  eventId: string;
  action: OutboxRemediationAction;
  expectedAttempts: number;
  operatorLabel: string;
  confirmationPhrase: string;
}

export class OutboxRemediationError extends Error {}

export function buildOutboxRemediationPhrase(
  input: Pick<
    RemediateOutboxInput,
    'kind' | 'eventId' | 'action' | 'expectedAttempts'
  >,
): string {
  return [
    'CONFIRM OUTBOX REMEDIATION',
    input.kind,
    input.eventId,
    input.action.toUpperCase(),
    'ATTEMPTS',
    String(input.expectedAttempts),
  ].join(' ');
}

export class OutboxRemediationService {
  constructor(private readonly dataSource: DataSource) {}

  async list(limit = 50): Promise<PoisonedOutboxEvent[]> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, 100));
    const rows = (await this.dataSource.query(
      `select * from (
         select 'chat_task' as kind, event_id, event_key, session_id, task_id,
                operation_id, attempt_count, last_error_code, created_at, updated_at
         from chat_task_lifecycle_outbox
         where delivered_at is null and attempt_count >= 8
           and (lease_expires_at is null or lease_expires_at <= now())
         union all
         select 'tool_control' as kind, event_id, event_key, session_id, task_id,
                operation_id, attempt_count, last_error_code, created_at, updated_at
         from tool_control_outbox
         where delivered_at is null and attempt_count >= 8
           and (lease_expires_at is null or lease_expires_at <= now())
       ) poisoned order by created_at, event_id limit $1`,
      [safeLimit],
    )) as Array<Record<string, unknown>>;
    return rows.map(mapPoisonedEvent);
  }

  async remediate(input: RemediateOutboxInput): Promise<{ auditId: string }> {
    assertRemediationInput(input);
    const table = tableFor(input.kind);
    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `select event_id, attempt_count, last_error_code
         from ${table}
         where event_id = $1 and delivered_at is null and attempt_count >= 8
           and (lease_expires_at is null or lease_expires_at <= now())
         for update`,
        [input.eventId],
      )) as Array<Record<string, unknown>>;
      const event = rows[0];
      if (!event) throw new OutboxRemediationError('毒事件不存在');
      if (Number(event.attempt_count) !== input.expectedAttempts) {
        throw new OutboxRemediationError('毒事件尝试次数已变化');
      }
      const auditId = randomUUID();
      await manager.query(
        `insert into outbox_remediation_audits
          (id, outbox_kind, event_id, action, operator_label,
           confirmation_phrase, previous_attempt_count, previous_error_code, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
        [
          auditId,
          input.kind,
          input.eventId,
          input.action,
          input.operatorLabel.trim(),
          input.confirmationPhrase,
          input.expectedAttempts,
          event.last_error_code ?? null,
        ],
      );
      const mutation =
        input.action === 'retry'
          ? `attempt_count = 0, available_at = now(), lease_owner = null,
             lease_expires_at = null, last_error_code = 'MANUAL_RETRY'`
          : `delivered_at = now(), lease_owner = null, lease_expires_at = null,
             last_error_code = 'MANUAL_DISCARD'`;
      const updated = await manager.query(
        `update ${table} set ${mutation}, updated_at = now()
         where event_id = $1 and delivered_at is null and attempt_count = $2
         returning event_id`,
        [input.eventId, input.expectedAttempts],
      );
      if (mutationRows(updated).length !== 1) {
        throw new OutboxRemediationError('毒事件状态已变化');
      }
      return { auditId };
    });
  }
}

function assertRemediationInput(input: RemediateOutboxInput): void {
  if (!(OUTBOX_KINDS as readonly string[]).includes(input.kind)) {
    throw new OutboxRemediationError('不支持的 Outbox 类型');
  }
  if (
    !(OUTBOX_REMEDIATION_ACTIONS as readonly string[]).includes(input.action)
  ) {
    throw new OutboxRemediationError('不支持的处置动作');
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.eventId,
    )
  ) {
    throw new OutboxRemediationError('event id 必须是有效 UUID');
  }
  if (
    !Number.isSafeInteger(input.expectedAttempts) ||
    input.expectedAttempts < 8
  ) {
    throw new OutboxRemediationError('expected attempts 必须大于等于 8');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(input.operatorLabel)) {
    throw new OutboxRemediationError('操作人标识无效');
  }
  if (input.confirmationPhrase !== buildOutboxRemediationPhrase(input)) {
    throw new OutboxRemediationError('显式确认短语不匹配');
  }
}

function tableFor(kind: OutboxKind): string {
  return kind === 'chat_task'
    ? 'chat_task_lifecycle_outbox'
    : 'tool_control_outbox';
}

function mapPoisonedEvent(row: Record<string, unknown>): PoisonedOutboxEvent {
  return {
    kind: String(row.kind) as OutboxKind,
    eventId: String(row.event_id),
    eventKey: String(row.event_key),
    sessionId: String(row.session_id),
    taskId: String(row.task_id),
    operationId: String(row.operation_id),
    attemptCount: Number(row.attempt_count),
    ...(row.last_error_code
      ? { lastErrorCode: String(row.last_error_code) }
      : {}),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mutationRows(result: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(result)) return [];
  const rows = Array.isArray(result[0]) ? result[0] : result;
  return rows.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  );
}
