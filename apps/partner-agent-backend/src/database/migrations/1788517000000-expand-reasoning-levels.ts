import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandReasoningLevels1788517000000 implements MigrationInterface {
  name = 'ExpandReasoningLevels1788517000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`alter table chat_tasks drop constraint if exists chat_tasks_reasoning_level_check`);
    await queryRunner.query(`alter table chat_tasks add constraint chat_tasks_reasoning_level_check check (reasoning_level in ('minimal','low','medium','high','xhigh','max'))`);
    await queryRunner.query(`alter table session_messages drop constraint if exists session_messages_reasoning_level_check`);
    await queryRunner.query(`alter table session_messages add constraint session_messages_reasoning_level_check check (reasoning_level is null or reasoning_level in ('minimal','low','medium','high','xhigh','max'))`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`alter table chat_tasks drop constraint if exists chat_tasks_reasoning_level_check`);
    await queryRunner.query(`alter table chat_tasks add constraint chat_tasks_reasoning_level_check check (reasoning_level in ('low','medium','high'))`);
    await queryRunner.query(`alter table session_messages drop constraint if exists session_messages_reasoning_level_check`);
    await queryRunner.query(`alter table session_messages add constraint session_messages_reasoning_level_check check (reasoning_level is null or reasoning_level in ('low','medium','high'))`);
  }
}
