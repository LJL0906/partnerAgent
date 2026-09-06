import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteActionWorkflow1788522000000 implements MigrationInterface {
  name = 'CompleteActionWorkflow1788522000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`alter table actions add column priority text`);
    await queryRunner.query(`alter table actions add column timezone text`);
    await queryRunner.query(`
      alter table actions add constraint actions_priority_check
        check (priority is null or priority in ('low','medium','high'))
    `);
    await queryRunner.query(`
      create index confirmation_batches_owner_created_id_idx
        on confirmation_batches (user_id,created_at desc,id desc)
    `);
    await queryRunner.query(`
      create index confirmation_actions_owner_created_id_idx
        on confirmation_actions (user_id,created_at desc,id desc)
    `);
    await queryRunner.query(`
      create index business_objects_owner_kind_created_id_idx
        on business_objects (user_id,kind,created_at desc,id desc)
    `);
    await queryRunner.query(`
      create index object_versions_owner_object_created_id_idx
        on object_versions (user_id,object_id,created_at desc,id desc)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop index if exists object_versions_owner_object_created_id_idx');
    await queryRunner.query('drop index if exists business_objects_owner_kind_created_id_idx');
    await queryRunner.query('drop index if exists confirmation_actions_owner_created_id_idx');
    await queryRunner.query('drop index if exists confirmation_batches_owner_created_id_idx');
    await queryRunner.query('alter table actions drop constraint if exists actions_priority_check');
    await queryRunner.query('alter table actions drop column if exists timezone');
    await queryRunner.query('alter table actions drop column if exists priority');
  }
}
