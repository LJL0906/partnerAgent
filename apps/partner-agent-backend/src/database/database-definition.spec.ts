import { describe, expect, it } from 'vitest';
import {
  DATABASE_MIGRATIONS,
  createDatabaseDataSource,
} from './database-definition.js';
import { CreateWsV1Events1788507000000 } from './migrations/1788507000000-create-ws-v1-events.js';

describe('database definition', () => {
  it('registers the latest reversible migration exactly once', () => {
    expect(DATABASE_MIGRATIONS.at(-1)).toBe(CreateWsV1Events1788507000000);
    expect(
      DATABASE_MIGRATIONS.filter(
        (migration) => migration === CreateWsV1Events1788507000000,
      ),
    ).toHaveLength(1);
  });

  it('keeps schema synchronization disabled', () => {
    const dataSource = createDatabaseDataSource(
      'postgresql://user:password@localhost/partner_agent_migration_verify',
    );

    expect(dataSource.options.synchronize).toBe(false);
  });
});
