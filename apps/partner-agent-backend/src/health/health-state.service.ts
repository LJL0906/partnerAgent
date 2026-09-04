import {
  Injectable,
  type BeforeApplicationShutdown,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DATABASE_MIGRATIONS } from '../database/database-definition.js';
import { SessionStore } from '../database/session-store.js';
import { TypeOrmSessionStore } from '../database/typeorm-session.store.js';

const EXPECTED_MIGRATIONS = DATABASE_MIGRATIONS.map(
  (Migration) => new Migration().name,
);

@Injectable()
export class HealthStateService
  implements BeforeApplicationShutdown, OnModuleDestroy
{
  private draining = false;

  constructor(private readonly sessionStore: SessionStore) {}

  beginDraining(): void {
    this.draining = true;
  }

  onModuleDestroy(): void {
    this.beginDraining();
  }

  beforeApplicationShutdown(): void {
    this.beginDraining();
  }

  async isReady(): Promise<boolean> {
    if (this.draining) return false;
    if (!(this.sessionStore instanceof TypeOrmSessionStore)) return true;

    const dataSource = this.sessionStore.getDataSource();
    if (!dataSource.isInitialized) return false;
    try {
      await dataSource.query('select 1');
      const registeredMigrations = new Set(
        dataSource.migrations.map((migration) => migration.name),
      );
      if (
        EXPECTED_MIGRATIONS.some(
          (migration) => !registeredMigrations.has(migration),
        )
      ) {
        return false;
      }
      return !(await dataSource.showMigrations());
    } catch {
      return false;
    }
  }
}
