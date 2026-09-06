import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatTaskOutputMode1788520000000 implements MigrationInterface {
  name = 'AddChatTaskOutputMode1788520000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table chat_tasks
        add column output_mode text not null default 'chat',
        add column preview_kind text,
        add constraint chat_tasks_output_mode_check
          check (output_mode in ('chat','structured_preview')),
        add constraint chat_tasks_preview_kind_check
          check (
            (output_mode = 'chat' and preview_kind is null)
            or (output_mode = 'structured_preview' and preview_kind = 'action')
          )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table chat_tasks
        drop constraint if exists chat_tasks_preview_kind_check,
        drop constraint if exists chat_tasks_output_mode_check,
        drop column if exists preview_kind,
        drop column if exists output_mode
    `);
  }
}
