import { pathToFileURL } from 'node:url';
import type { DataSource } from 'typeorm';
import {
  DATABASE_MIGRATIONS,
  createDatabaseDataSource,
} from '../src/database/database-definition.js';

export const MIGRATION_VERIFY_CONFIRMATION =
  'I_ACKNOWLEDGE_EMPTY_MIGRATION_VERIFY_DATABASE';

export interface MigrationVerifyConfig {
  databaseUrl: string;
}

export class MigrationVerifySafetyError extends Error {}

type MigrationRunner = Pick<
  DataSource,
  'query' | 'runMigrations' | 'undoLastMigration' | 'showMigrations'
>;

export function parseMigrationVerifyEnvironment(
  environment: NodeJS.ProcessEnv,
): MigrationVerifyConfig {
  const databaseUrl = environment.MIGRATION_VERIFY_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new MigrationVerifySafetyError(
      '必须显式提供 MIGRATION_VERIFY_DATABASE_URL',
    );
  }
  if (environment.MIGRATION_VERIFY_CONFIRM !== MIGRATION_VERIFY_CONFIRMATION) {
    throw new MigrationVerifySafetyError(
      '必须显式确认使用可丢弃的空验迁数据库',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new MigrationVerifySafetyError(
      'MIGRATION_VERIFY_DATABASE_URL 格式无效',
    );
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new MigrationVerifySafetyError('验迁数据库必须使用 PostgreSQL');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/(?:migration[-_]verify|verify[-_]migration)/i.test(databaseName)) {
    throw new MigrationVerifySafetyError(
      '验迁数据库名称必须明确包含 migration_verify 标识',
    );
  }
  return { databaseUrl };
}

export async function assertEmptyVerifyDatabase(
  dataSource: MigrationRunner,
): Promise<void> {
  const relations = (await dataSource.query(`
    select relation.relname
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname not in ('pg_catalog', 'information_schema')
      and namespace.nspname not like 'pg_toast%'
      and relation.relkind in ('r','p','v','m','S')
  `)) as Array<{ relname: string }>;
  if (relations.length > 0) {
    throw new MigrationVerifySafetyError(
      `验迁数据库必须为空（检测到 ${relations.length} 个已有关系）`,
    );
  }
}

export async function verifyMigrationCycle(
  dataSource: MigrationRunner,
  migrationCount = DATABASE_MIGRATIONS.length,
): Promise<{ firstUp: number; down: number; secondUp: number }> {
  const firstUp = await dataSource.runMigrations({ transaction: 'all' });
  if (
    firstUp.length !== migrationCount ||
    (await dataSource.showMigrations())
  ) {
    throw new MigrationVerifySafetyError('首次 migration up 未完整应用');
  }

  for (let index = 0; index < migrationCount; index += 1) {
    await dataSource.undoLastMigration({ transaction: 'all' });
  }
  await assertOnlyMigrationMetadataRemains(dataSource);

  const secondUp = await dataSource.runMigrations({ transaction: 'all' });
  if (
    secondUp.length !== migrationCount ||
    (await dataSource.showMigrations())
  ) {
    throw new MigrationVerifySafetyError('第二次 migration up 未完整应用');
  }
  return {
    firstUp: firstUp.length,
    down: migrationCount,
    secondUp: secondUp.length,
  };
}

export async function runMigrationVerification(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const config = parseMigrationVerifyEnvironment(environment);
  const dataSource = createDatabaseDataSource(config.databaseUrl);
  try {
    await dataSource.initialize();
    await assertEmptyVerifyDatabase(dataSource);
    return await verifyMigrationCycle(dataSource);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

export function formatMigrationVerificationError(error: unknown): string {
  return error instanceof MigrationVerifySafetyError
    ? error.message
    : '迁移验证失败（底层错误详情已隐藏）';
}

async function assertOnlyMigrationMetadataRemains(
  dataSource: MigrationRunner,
): Promise<void> {
  const unexpected = (await dataSource.query(`
    select relation.relname
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname not in ('pg_catalog', 'information_schema')
      and namespace.nspname not like 'pg_toast%'
      and relation.relkind in ('r','p','v','m','S')
      and relation.relname not in ('migrations','migrations_id_seq')
  `)) as Array<{ relname: string }>;
  if (unexpected.length > 0) {
    throw new MigrationVerifySafetyError(
      `migration down 后仍有 ${unexpected.length} 个项目关系残留`,
    );
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runMigrationVerification()
    .then((result) => {
      process.stdout.write(
        `Migration verification passed: up=${result.firstUp}, down=${result.down}, up=${result.secondUp}\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(`${formatMigrationVerificationError(error)}\n`);
      process.exitCode = 1;
    });
}
