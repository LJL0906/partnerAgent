import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWsV1Events1788507000000 implements MigrationInterface {
  name = 'CreateWsV1Events1788507000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table ws_v1_event_streams (
        stream_key text primary key,
        last_position bigint not null default 0,
        constraint ws_v1_event_streams_position_check check (last_position >= 0)
      )
    `);
    await queryRunner.query(`
      create table ws_v1_events (
        event_id uuid primary key,
        stream_key text not null references ws_v1_event_streams(stream_key) on delete cascade,
        stream_position bigint not null,
        publisher_instance_id uuid not null,
        wire_payload jsonb not null,
        created_at timestamptz not null default transaction_timestamp(),
        constraint ws_v1_events_stream_position_key unique (stream_key, stream_position),
        constraint ws_v1_events_position_check check (stream_position > 0)
      )
    `);
    await queryRunner.query(`
      create index ws_v1_events_stream_created_idx
        on ws_v1_events (stream_key, created_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop table if exists ws_v1_events');
    await queryRunner.query('drop table if exists ws_v1_event_streams');
  }
}
