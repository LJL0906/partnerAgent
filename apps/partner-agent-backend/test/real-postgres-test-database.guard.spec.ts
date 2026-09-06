import { describe, expect, it } from 'vitest';
import {
  REAL_POSTGRES_TEST_CONFIRMATION,
  assertDedicatedRealPostgresTestDatabase,
} from './real-postgres-test-database.guard.js';

describe('real PostgreSQL test database guard', () => {
  it('rejects a production-like database even with explicit confirmation', () => {
    expect(() =>
      assertDedicatedRealPostgresTestDatabase(
        'postgresql://localhost/partner_agent',
        REAL_POSTGRES_TEST_CONFIRMATION,
      ),
    ).toThrow('专用测试数据库');
  });

  it('rejects a test-named database without the exact confirmation', () => {
    expect(() =>
      assertDedicatedRealPostgresTestDatabase(
        'postgresql://localhost/partner_agent_test',
        undefined,
      ),
    ).toThrow('REAL_POSTGRES_TEST_CONFIRM');
  });

  it('accepts an explicitly confirmed test or verification database', () => {
    expect(
      assertDedicatedRealPostgresTestDatabase(
        'postgresql://localhost/partner_agent_migration_verify',
        REAL_POSTGRES_TEST_CONFIRMATION,
      ),
    ).toBe('postgresql://localhost/partner_agent_migration_verify');
  });
});
