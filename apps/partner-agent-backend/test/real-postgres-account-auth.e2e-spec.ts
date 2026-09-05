import { describe, it } from 'vitest';
import { createDatabaseDataSource } from '../src/database/database-definition.js';
import { AccountStore } from '../src/auth/账户存储.js';
import { accountContract } from './账户契约.js';

const url = process.env.REAL_POSTGRES_DATABASE_URL;
if (!url)
  describe.skip('username/password accounts (PostgreSQL)', () => {
    it('requires a dedicated migrated verification database', () => {});
  });
else
  accountContract('username/password accounts (PostgreSQL)', async () => {
    const database = createDatabaseDataSource(url);
    await database.initialize();
    return {
      store: new AccountStore(database),
      close: () => database.destroy(),
    };
  });
