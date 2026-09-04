import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWsV1RetentionIndex1788508000000
  implements MigrationInterface
{
  name = 'AddWsV1RetentionIndex1788508000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create index ws_v1_events_created_idx on ws_v1_events (created_at, event_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop index if exists ws_v1_events_created_idx');
  }
}
