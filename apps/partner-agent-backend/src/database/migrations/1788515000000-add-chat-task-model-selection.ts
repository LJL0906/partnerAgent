import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatTaskModelSelection1788515000000 implements MigrationInterface {
  name = 'AddChatTaskModelSelection1788515000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`alter table chat_tasks add column model_config_id text`);
    await queryRunner.query(`alter table chat_tasks add column reasoning_level text`);
    await queryRunner.query(`update chat_tasks set model_config_id = concat('deepseek:', coalesce(nullif(current_setting('app.default_model', true), ''), 'deepseek-v4-flash')) where model_config_id is null`);
    await queryRunner.query(`update chat_tasks set reasoning_level = 'medium' where reasoning_level is null`);
    await queryRunner.query(`alter table chat_tasks alter column model_config_id set not null`);
    await queryRunner.query(`alter table chat_tasks alter column reasoning_level set not null`);
    await queryRunner.query(`alter table chat_tasks add constraint chat_tasks_reasoning_level_check check (reasoning_level in ('minimal','low','medium','high','xhigh','max'))`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`alter table chat_tasks drop constraint if exists chat_tasks_reasoning_level_check`);
    await queryRunner.query(`alter table chat_tasks drop column if exists reasoning_level`);
    await queryRunner.query(`alter table chat_tasks drop column if exists model_config_id`);
  }
}
