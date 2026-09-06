import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatTaskRevision1788521000000 implements MigrationInterface {
  name = 'AddChatTaskRevision1788521000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table chat_tasks
        add column revision integer not null default 1,
        add constraint chat_tasks_revision_positive_check
          check (revision > 0)
    `);
    const rows = await legacyOutboxRows(queryRunner);
    const positions = new Map<string, number>();
    const taskRevisions = new Map<string, LegacyTaskRevision>();
    for (const row of rows) {
      if (!isLegacyEvent(row)) continue;
      const key = taskKey(row.owner_id, row.task_id);
      const position = (positions.get(key) ?? 0) + 1;
      positions.set(key, position);
      if (row.delivered_at !== null) continue;

      const data = eventData(row.event_data);
      const revision = isPositiveInteger(data.revision)
        ? data.revision
        : position;
      if (!isPositiveInteger(data.revision)) {
        await queryRunner.query(
          `update chat_task_lifecycle_outbox
           set event_data = $2::jsonb
           where event_id = $1 and delivered_at is null`,
          [row.event_id, JSON.stringify({ ...data, revision })],
        );
      }
      const current = taskRevisions.get(key);
      if (!current || current.revision < revision) {
        taskRevisions.set(key, {
          ownerId: row.owner_id,
          taskId: row.task_id,
          revision,
        });
      }
    }
    for (const task of taskRevisions.values()) {
      await queryRunner.query(
        `update chat_tasks
         set revision = greatest(revision, $3)
         where owner_id = $1 and id = $2`,
        [task.ownerId, task.taskId, task.revision],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await legacyOutboxRows(queryRunner);
    for (const row of rows) {
      if (!isLegacyEvent(row)) continue;
      const data = eventData(row.event_data);
      if (!Object.hasOwn(data, 'revision')) continue;
      const restored = { ...data };
      delete restored.revision;
      await queryRunner.query(
        `update chat_task_lifecycle_outbox
         set event_data = $2::jsonb
         where event_id = $1`,
        [row.event_id, JSON.stringify(restored)],
      );
    }
    await queryRunner.query(`
      alter table chat_tasks
        drop constraint if exists chat_tasks_revision_positive_check,
        drop column if exists revision
    `);
  }
}

interface LegacyOutboxRow {
  event_id: string;
  event_key: string;
  owner_id: string;
  task_id: string;
  event_data: unknown;
  delivered_at: unknown | null;
}

interface LegacyTaskRevision {
  ownerId: string;
  taskId: string;
  revision: number;
}

async function legacyOutboxRows(
  queryRunner: QueryRunner,
): Promise<LegacyOutboxRow[]> {
  return queryRunner.query(`
    select event_id, event_key, owner_id, task_id, event_data, delivered_at
    from chat_task_lifecycle_outbox
    order by owner_id, task_id, created_at, event_id
  `) as Promise<LegacyOutboxRow[]>;
}

function eventData(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const parsed: unknown = JSON.parse(value);
    return eventData(parsed);
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isLegacyEvent(row: LegacyOutboxRow): boolean {
  return (
    row.event_key.toLowerCase() ===
    `chat-task:${row.task_id}:${row.event_id}`.toLowerCase()
  );
}

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 2_147_483_647
  );
}

function taskKey(ownerId: string, taskId: string): string {
  return `${ownerId}\u0000${taskId}`;
}
