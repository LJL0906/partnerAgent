import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSessionMessageModelMetadata1788516000000 implements MigrationInterface {
  name = 'AddSessionMessageModelMetadata1788516000000';
  async up(q: QueryRunner) {
    await q.query(`alter table session_messages add column metadata_json jsonb`);
    await q.query(`alter table session_messages add column model_config_id text`);
    await q.query(`alter table session_messages add column reasoning_level text`);
    await q.query(`alter table session_messages add constraint session_messages_reasoning_level_check check (reasoning_level is null or reasoning_level in ('minimal','low','medium','high','xhigh','max'))`);
  }
  async down(q: QueryRunner) {
    await q.query(`alter table session_messages drop constraint if exists session_messages_reasoning_level_check`);
    await q.query(`alter table session_messages drop column if exists metadata_json`);
    await q.query(`alter table session_messages drop column if exists reasoning_level`);
    await q.query(`alter table session_messages drop column if exists model_config_id`);
  }
}
