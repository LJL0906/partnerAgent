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
): Promise<{
  firstUp: number;
  down: number;
  secondUp: number;
  incrementalUp: number;
  taskRevision: number;
  outboxRevision: number;
}> {
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

  const incremental = await verifyLatestMigrationUpgrade(dataSource);
  return {
    firstUp: firstUp.length,
    down: migrationCount,
    secondUp: secondUp.length,
    ...incremental,
  };
}

async function verifyLatestMigrationUpgrade(
  dataSource: MigrationRunner,
): Promise<{
  incrementalUp: number;
  taskRevision: number;
  outboxRevision: number;
}> {
  await dataSource.undoLastMigration({ transaction: 'all' });
  if (!(await dataSource.showMigrations())) {
    throw new MigrationVerifySafetyError('旧版增量验证未回退最新 migration');
  }

  const fixture = {
    ownerId: 'migration-verify-old-owner',
    sessionId: 'migration-verify-old-session',
    messageId: '10000000-0000-4000-8000-000000000001',
    recordId: '10000000-0000-4000-8000-000000000002',
    operationId: '10000000-0000-4000-8000-000000000003',
    taskId: '10000000-0000-4000-8000-000000000004',
    eventId: '10000000-0000-4000-8000-000000000005',
  };
  await seedLatestMigrationUpgradeFixture(dataSource, fixture);

  const applied = await dataSource.runMigrations({ transaction: 'all' });
  if (applied.length !== 1 || (await dataSource.showMigrations())) {
    throw new MigrationVerifySafetyError(
      '旧版数据库未仅增量应用最新 migration',
    );
  }

  const taskRows = (await dataSource.query(
    'select revision from chat_tasks where id=$1',
    [fixture.taskId],
  )) as Array<{ revision?: number }>;
  const outboxRows = (await dataSource.query(
    `select event_data->>'revision' as revision
     from chat_task_lifecycle_outbox where event_id=$1`,
    [fixture.eventId],
  )) as Array<{ revision?: string }>;
  const taskRevision = Number(taskRows[0]?.revision);
  const outboxRevision = Number(outboxRows[0]?.revision);
  if (taskRevision !== 1 || outboxRevision !== 1) {
    throw new MigrationVerifySafetyError(
      '最新 migration 未正确回填旧 task/outbox revision',
    );
  }
  return {
    incrementalUp: applied.length,
    taskRevision,
    outboxRevision,
  };
}

async function seedLatestMigrationUpgradeFixture(
  dataSource: MigrationRunner,
  fixture: {
    ownerId: string;
    sessionId: string;
    messageId: string;
    recordId: string;
    operationId: string;
    taskId: string;
    eventId: string;
  },
): Promise<void> {
  await dataSource.query(
    `insert into chat_sessions(id,owner_id,created_at,last_active_at,updated_at)
     values ($1,$2,now(),now(),now())`,
    [fixture.sessionId, fixture.ownerId],
  );
  await dataSource.query(
    `insert into session_messages(
       id,session_id,sequence,role,content,status,created_at,input_id
     ) values ($1,$2,1,'user','migration fixture','complete',now(),'old-input')`,
    [fixture.messageId, fixture.sessionId],
  );
  await dataSource.query(
    `insert into original_records(
       id,owner_id,session_id,input_id,request_fingerprint,content,created_at
     ) values ($1,$2,$3,'old-input','old-fingerprint','migration fixture',now())`,
    [fixture.recordId, fixture.ownerId, fixture.sessionId],
  );
  await dataSource.query(
    `insert into local_core_operations(
       id,owner_id,operation_id,request_fingerprint,command_name,result_json,created_at
     ) values (
       '10000000-0000-4000-8000-000000000006',$1,$2,
       'old-fingerprint','SubmitTextInput','{}',now()
     )`,
    [fixture.ownerId, fixture.operationId],
  );
  await dataSource.query(
    `insert into chat_tasks(
       id,owner_id,session_id,operation_id,input_id,original_record_id,
       user_message_id,state,created_at,updated_at,model_config_id,
       reasoning_level,output_mode,preview_kind
     ) values (
       $1,$2,$3,$4,'old-input',$5,$6,'completed',now(),now(),
       'test:model','low','chat',null
     )`,
    [
      fixture.taskId,
      fixture.ownerId,
      fixture.sessionId,
      fixture.operationId,
      fixture.recordId,
      fixture.messageId,
    ],
  );
  await dataSource.query(
    `insert into chat_task_lifecycle_outbox(
       event_id,event_key,owner_id,task_id,operation_id,session_id,state,event_data
     ) values ($1,$2,$3,$4,$5,$6,'completed','{}')`,
    [
      fixture.eventId,
      `chat-task:${fixture.taskId}:${fixture.eventId}`,
      fixture.ownerId,
      fixture.taskId,
      fixture.operationId,
      fixture.sessionId,
    ],
  );
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
        `Migration verification passed: up=${result.firstUp}, down=${result.down}, up=${result.secondUp}, incremental=${result.incrementalUp}, task_revision=${result.taskRevision}, outbox_revision=${result.outboxRevision}\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(`${formatMigrationVerificationError(error)}\n`);
      process.exitCode = 1;
    });
}
