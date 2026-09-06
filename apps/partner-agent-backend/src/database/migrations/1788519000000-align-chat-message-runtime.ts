import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignChatMessageRuntime1788519000000 implements MigrationInterface {
  name = 'AlignChatMessageRuntime1788519000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table session_messages
        add column revision integer not null default 1,
        add constraint session_messages_revision_check check (revision > 0)
    `);
    await queryRunner.query(`
      create unique index session_messages_owner_task_assistant_key
      on session_messages (owner_id, task_id)
      where role = 'assistant' and task_id is not null
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'drop index if exists session_messages_owner_task_assistant_key',
    );
    await queryRunner.query(`
      alter table session_messages
        drop constraint if exists session_messages_revision_check,
        drop column if exists revision
    `);
  }
}
