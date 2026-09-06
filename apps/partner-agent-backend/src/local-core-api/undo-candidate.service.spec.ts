import { ConfigService } from '@nestjs/config';
import { parseCreateUndoObjectCandidateCommandResult } from '@partner-agent/contracts';
import type { EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { TypeOrmSessionStore } from '../database/typeorm-session.store.js';
import type { ChatTaskStore } from './chat-task.store.js';
import { UndoCandidateService } from './undo-candidate.service.js';

const actionId = '10000000-0000-4000-8000-000000000001';
const batchId = '20000000-0000-4000-8000-000000000001';
const objectId = '30000000-0000-4000-8000-000000000001';
const operationId = '40000000-0000-4000-8000-000000000001';

describe('UndoCandidateService', () => {
  it('revalidates the whole original batch and only creates unapplied undo candidates', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from confirmation_actions')) return [{ id: actionId, batch_id: batchId, action_type: 'confirm' }];
      if (sql.includes('from object_versions')) return [{
        object_id: objectId, object_version: '2', change_type: 'create',
        kind: 'action', current_version: '2', lifecycle_status: 'active',
      }];
      if (sql.includes('from confirmation_batches')) return [{ source_record_id: null, source_analysis_id: null }];
      return [];
    });
    const manager = { query } as unknown as EntityManager;
    const tasks = {
      executeIdempotentCommand: vi.fn(async (_command, execute) => execute(manager)),
    } as unknown as ChatTaskStore;
    const sessions = new TypeOrmSessionStore(
      new ConfigService(),
      { query } as never,
    );
    const service = new UndoCandidateService(tasks, sessions);
    const result = await service.create({
      userId: 'owner', input: {}, envelope: {
        operation_id: operationId, client_source: 'web', request_fingerprint: 'fp',
        payload: {
          original_confirmation_action_id: actionId,
          original_confirmation_batch_id: batchId,
          observed_versions: { [objectId]: '2' },
        },
      },
    });

    expect(() => parseCreateUndoObjectCandidateCommandResult(result, operationId)).not.toThrow();
    expect(query.mock.calls.map(([sql]) => sql).join('\n')).toContain('insert into candidate_items');
    expect(JSON.stringify(result)).not.toContain('object_refs');
  });

  it('rejects stale observed versions before creating a batch', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from confirmation_actions')) return [{ id: actionId, batch_id: batchId, action_type: 'confirm' }];
      if (sql.includes('from object_versions')) return [{
        object_id: objectId, object_version: '2', change_type: 'create',
        kind: 'action', current_version: '3', lifecycle_status: 'active',
      }];
      return [];
    });
    const manager = { query } as unknown as EntityManager;
    const tasks = { executeIdempotentCommand: vi.fn(async (_command, execute) => execute(manager)) } as unknown as ChatTaskStore;
    const service = new UndoCandidateService(tasks, new TypeOrmSessionStore(new ConfigService(), {} as never));
    await expect(service.create({
      userId: 'owner', input: {}, envelope: {
        operation_id: operationId, client_source: 'web', request_fingerprint: 'fp',
        payload: {
          original_confirmation_action_id: actionId,
          original_confirmation_batch_id: batchId,
          observed_versions: { [objectId]: '2' },
        },
      },
    })).rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls.some(([sql]) => sql.includes('insert into confirmation_batches'))).toBe(false);
  });
});
