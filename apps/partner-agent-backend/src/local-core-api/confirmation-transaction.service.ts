import { Injectable } from '@nestjs/common';
import { SessionStore } from '../database/session-store.js';
import { TypeOrmSessionStore } from '../database/typeorm-session.store.js';
import { confirmationError } from './confirmation-transaction.errors.js';
import type { StoredCommandResult } from './confirmation-transaction.types.js';
import type { LocalCoreCommandRequest } from './local-core-api.types.js';
import { executeConfirmationTransaction } from './confirmation-transaction.executor.js';

@Injectable()
export class ConfirmationTransactionService {
  constructor(private readonly sessionStore: SessionStore) {}

  async submit(request: LocalCoreCommandRequest): Promise<StoredCommandResult> {
    const runner = this.dataSource().createQueryRunner();
    let committed = false;

    await runner.connect();
    await runner.startTransaction();
    try {
      const execution = await executeConfirmationTransaction(runner, request);
      if (execution.outcome === 'duplicate') {
        await runner.rollbackTransaction();
        return execution.result;
      }
      if (execution.outcome === 'expired') {
        await runner.commitTransaction();
        committed = true;
        throw execution.error;
      }
      await runner.commitTransaction();
      committed = true;
      return execution.result;
    } catch (error) {
      if (!committed) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  private dataSource() {
    if (!(this.sessionStore instanceof TypeOrmSessionStore)) {
      throw confirmationError(
        'INTERNAL_000',
        '正式确认需要 PostgreSQL 存储',
        503,
      );
    }
    return this.sessionStore.getDataSource();
  }
}
