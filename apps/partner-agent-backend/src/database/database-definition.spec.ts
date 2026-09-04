import { describe, expect, it } from 'vitest';
import {
  DATABASE_MIGRATIONS,
  createDatabaseDataSource,
} from './database-definition.js';
import { AddToolReconciliation1788512000000 } from './migrations/1788512000000-add-tool-reconciliation.js';

describe('database definition', () => {
  it('registers the latest reversible migration exactly once', () => {
    expect(DATABASE_MIGRATIONS.at(-1)).toBe(
      AddToolReconciliation1788512000000,
    );
    expect(
      DATABASE_MIGRATIONS.filter(
        (migration) => migration === AddToolReconciliation1788512000000,
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
