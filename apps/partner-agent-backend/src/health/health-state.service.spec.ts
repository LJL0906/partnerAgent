import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { DATABASE_MIGRATIONS } from '../database/database-definition.js';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { TypeOrmSessionStore } from '../database/typeorm-session.store.js';
import { HealthStateService } from './health-state.service.js';

function createPostgresStore(dataSource: Partial<DataSource>) {
  const store = Object.create(
    TypeOrmSessionStore.prototype,
  ) as TypeOrmSessionStore;
  store.getDataSource = () => dataSource as DataSource;
  return store;
}

const registeredMigrations = DATABASE_MIGRATIONS.map(
  (Migration) => new Migration(),
);

describe('HealthStateService', () => {
  it('reports memory mode ready without probing a provider', async () => {
    const service = new HealthStateService(new MemorySessionStore());

    await expect(service.isReady()).resolves.toBe(true);
  });

  it('requires an initialized reachable database with no pending migrations', async () => {
    const query = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const showMigrations = vi.fn().mockResolvedValue(false);
    const service = new HealthStateService(
      createPostgresStore({
        isInitialized: true,
        migrations: registeredMigrations,
        query,
        showMigrations,
      }),
    );

    await expect(service.isReady()).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith('select 1');
    expect(showMigrations).toHaveBeenCalledOnce();

    showMigrations.mockResolvedValueOnce(true);
    await expect(service.isReady()).resolves.toBe(false);
  });

  it('returns not ready without exposing database failures', async () => {
    const service = new HealthStateService(
      createPostgresStore({
        isInitialized: true,
        migrations: registeredMigrations,
        query: vi.fn().mockRejectedValue(new Error('secret database failure')),
        showMigrations: vi.fn(),
      }),
    );

    await expect(service.isReady()).resolves.toBe(false);
  });

  it('stops reporting ready as soon as draining begins', async () => {
    const query = vi.fn();
    const service = new HealthStateService(
      createPostgresStore({ isInitialized: true, query }),
    );

    service.beginDraining();

    await expect(service.isReady()).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
