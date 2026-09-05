import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccountTables1788514000000 implements MigrationInterface {
  name = 'CreateAccountTables1788514000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`create table account_credentials (
      user_id text primary key references users(id) on delete cascade,
      username text not null unique check (username ~ '^[a-z0-9_]{3,32}$'),
      password_hash text not null,
      created_at timestamptz not null default now()
    )`);
    await runner.query(`create table account_sessions (
      id uuid primary key,
      user_id text not null references account_credentials(user_id) on delete cascade,
      refresh_hash text not null check (refresh_hash ~ '^[a-f0-9]{64}$'),
      created_at timestamptz not null default now(),
      expires_at timestamptz not null,
      revoked_at timestamptz,
      check (expires_at > created_at)
    )`);
    await runner.query(
      'create index account_sessions_user_idx on account_sessions(user_id)',
    );
    await runner.query(
      'create index account_sessions_expiry_idx on account_sessions(expires_at)',
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('drop table account_sessions');
    await runner.query('drop table account_credentials');
  }
}
