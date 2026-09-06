import { describe, it } from 'vitest';
import { createDatabaseDataSource } from '../src/database/database-definition.js';
import { AccountStore } from '../src/auth/account-store.js';
import { accountContract } from './account-contract.js';

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
