import { DataType, newDb } from 'pg-mem';
import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolConfirmationEntity } from '../database/entities/tool-confirmation.entity.js';
import { ToolReconciliationAuditEntity } from '../database/entities/tool-reconciliation-audit.entity.js';
import { buildToolReconciliationPhrase } from './tool-operation.store.js';
import { ToolReconciliationService } from './tool-reconciliation.service.js';
import { TypeOrmToolOperationStore } from './typeorm-tool-operation.store.js';

describe('TypeOrmToolOperationStore reconciliation transaction', () => {
  let dataSource: DataSource;
  let store: TypeOrmToolOperationStore;
  const confirmationId = '10000000-0000-4000-8000-000000000001';
  const ownerId = 'owner-a';

  beforeEach(async () => {
    const database = newDb();
    database.public.registerFunction({
      name: 'version',
      returns: DataType.text,
      implementation: () => 'PostgreSQL 16.0',
    });
    database.public.registerFunction({
      name: 'current_database',
      returns: DataType.text,
      implementation: () => 'partner_agent_test',
    });
    database.public.registerFunction({
      name: 'quote_ident',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (value) => `"${value}"`,
    });
    database.public.registerFunction({
      name: 'obj_description',
      args: [DataType.regclass, DataType.text],
      returns: DataType.text,
      implementation: () => null,
    });
    dataSource = database.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [ToolConfirmationEntity, ToolReconciliationAuditEntity],
      synchronize: true,
    }) as DataSource;
    await dataSource.initialize();
    store = new TypeOrmToolOperationStore(dataSource);
    const capturedAt = new Date('2026-09-05T00:00:00.000Z');
    await store.saveConfirmation({
      id: confirmationId,
      ownerId,
      sessionId: 'session-a',
      taskId: '20000000-0000-4000-8000-000000000001',
      operationId: 'operation-a',
      toolCallId: 'tool-call-a',
      toolName: 'external-write',
      riskLevel: 'high',
      status: 'indeterminate',
      arguments: { apiKey: 'must-not-leak' },
      requestSummary: '{"apiKey":"[已脱敏]"}',
      reconciliationSnapshot: {
        confirmationId,
        ownerId,
        sessionId: 'session-a',
        taskId: '20000000-0000-4000-8000-000000000001',
        operationId: 'operation-a',
        toolCallId: 'tool-call-a',
        toolName: 'external-write',
        requestSummary: '{"apiKey":"[已脱敏]"}',
        capturedAt,
      },
      version: 1,
      createdAt: capturedAt,
      expiresAt: capturedAt,
    });
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('persists the fixed audit and version bump without changing state', async () => {
    const service = new ToolReconciliationService(store);
    const input = {
      confirmationId,
      ownerId,
      expectedVersion: 1,
      expectedStatus: 'indeterminate' as const,
      outcome: 'verified_applied' as const,
      operatorLabel: 'local-operator',
      confirmationPhrase: '',
    };
    input.confirmationPhrase = buildToolReconciliationPhrase(input);

    await expect(service.reconcile(input)).resolves.toMatchObject({
      replayed: false,
      audit: { outcome: 'verified_applied', confirmationVersionAfter: 2 },
    });
    await expect(service.reconcile(input)).resolves.toMatchObject({
      replayed: true,
    });
    await expect(store.findConfirmation(confirmationId)).resolves.toMatchObject(
      {
        status: 'indeterminate',
        version: 2,
      },
    );
    await expect(service.list(ownerId)).resolves.toEqual([]);
    const [audit] = (await dataSource.query(
      'select snapshot_json from tool_reconciliation_audits',
    )) as Array<{ snapshot_json: unknown }>;
    expect(JSON.stringify(audit.snapshot_json)).not.toContain('must-not-leak');
  });

  it('rolls back the version bump when the audit insert fails', async () => {
    await dataSource.query('drop table tool_reconciliation_audits');
    const input = {
      confirmationId,
      ownerId,
      expectedVersion: 1,
      expectedStatus: 'indeterminate' as const,
      outcome: 'abandoned' as const,
      operatorLabel: 'local-operator',
      confirmationPhrase: '',
    };
    input.confirmationPhrase = buildToolReconciliationPhrase(input);

    await expect(
      new ToolReconciliationService(store).reconcile(input),
    ).rejects.toBeDefined();
    await expect(store.findConfirmation(confirmationId)).resolves.toMatchObject(
      {
        status: 'indeterminate',
        version: 1,
      },
    );
  });
});
