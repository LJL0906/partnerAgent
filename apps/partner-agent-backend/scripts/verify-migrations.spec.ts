import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import {
  MIGRATION_VERIFY_CONFIRMATION,
  MigrationVerifySafetyError,
  assertEmptyVerifyDatabase,
  formatMigrationVerificationError,
  parseMigrationVerifyEnvironment,
  verifyMigrationCycle,
} from './verify-migrations.js';

describe('migration verification CLI', () => {
  it('requires a dedicated, explicitly confirmed PostgreSQL verify database', () => {
    expect(() => parseMigrationVerifyEnvironment({})).toThrow(
      '必须显式提供 MIGRATION_VERIFY_DATABASE_URL',
    );
    expect(() =>
      parseMigrationVerifyEnvironment({
        MIGRATION_VERIFY_DATABASE_URL:
          'postgresql://user:secret@localhost/partner_agent_migration_verify',
      }),
    ).toThrow('必须显式确认使用可丢弃的空验迁数据库');
    expect(() =>
      parseMigrationVerifyEnvironment({
        MIGRATION_VERIFY_DATABASE_URL:
          'postgresql://user:secret@localhost/partner_agent',
        MIGRATION_VERIFY_CONFIRM: MIGRATION_VERIFY_CONFIRMATION,
      }),
    ).toThrow('验迁数据库名称必须明确包含 migration_verify 标识');

    expect(
      parseMigrationVerifyEnvironment({
        MIGRATION_VERIFY_DATABASE_URL:
          'postgresql://user:secret@localhost/partner_agent_migration_verify',
        MIGRATION_VERIFY_CONFIRM: MIGRATION_VERIFY_CONFIRMATION,
      }),
    ).toEqual({
      databaseUrl:
        'postgresql://user:secret@localhost/partner_agent_migration_verify',
    });
  });

  it('rejects a non-empty verification database without exposing relation names', async () => {
    const dataSource = {
      query: vi.fn().mockResolvedValue([{ relname: 'private_table' }]),
    } as unknown as DataSource;

    await expect(assertEmptyVerifyDatabase(dataSource)).rejects.toThrow(
      '验迁数据库必须为空（检测到 1 个已有关系）',
    );
    await assertEmptyVerifyDatabase(dataSource).catch((error: unknown) => {
      expect(String(error)).not.toContain('private_table');
    });
  });

  it('never exposes unexpected driver errors or connection credentials', () => {
    expect(
      formatMigrationVerificationError(
        new Error(
          'connection failed: postgresql://user:secret@localhost/database',
        ),
      ),
    ).toBe('迁移验证失败（底层错误详情已隐藏）');
    expect(
      formatMigrationVerificationError(
        new MigrationVerifySafetyError('验迁数据库必须为空'),
      ),
    ).toBe('验迁数据库必须为空');
  });

  it('runs every migration up, down and up again', async () => {
    const migrations = [{ name: 'first' }, { name: 'second' }];
    const dataSource = {
      runMigrations: vi
        .fn()
        .mockResolvedValueOnce(migrations)
        .mockResolvedValueOnce(migrations),
      undoLastMigration: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(false),
      query: vi.fn().mockResolvedValue([]),
    } as unknown as DataSource;

    await expect(verifyMigrationCycle(dataSource, 2)).resolves.toEqual({
      firstUp: 2,
      down: 2,
      secondUp: 2,
    });
    expect(dataSource.undoLastMigration).toHaveBeenCalledTimes(2);
    expect(dataSource.runMigrations).toHaveBeenCalledTimes(2);
    expect(dataSource.showMigrations).toHaveBeenCalledTimes(2);
  });
});
