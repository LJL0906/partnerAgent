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
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table chat_tasks
        drop constraint if exists chat_tasks_revision_positive_check,
        drop column if exists revision
    `);
  }
}
