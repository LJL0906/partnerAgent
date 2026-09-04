import { createDatabaseDataSource } from './database-definition.js';

async function runMigrations(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const dataSource = createDatabaseDataSource(databaseUrl);
  try {
    await dataSource.initialize();
    const migrations = await dataSource.runMigrations({ transaction: 'all' });
    if (await dataSource.showMigrations()) {
      throw new Error('pending migrations remain');
    }
    return migrations.length;
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

runMigrations().then(
  (count) => {
    process.stdout.write(`Applied ${count} migration(s).\n`);
  },
  () => {
    process.stderr.write('Database migration failed.\n');
    process.exitCode = 1;
  },
);
