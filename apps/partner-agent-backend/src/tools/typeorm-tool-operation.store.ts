import { randomUUID } from 'node:crypto';
import { In, IsNull, LessThanOrEqual, Not, type DataSource } from 'typeorm';
import { ToolAuditEntity } from '../database/entities/tool-audit.entity.js';
import { ChatTaskEntity } from '../database/entities/chat-task.entity.js';
import { ToolConfirmationEntity } from '../database/entities/tool-confirmation.entity.js';
import { ToolExecutionReceiptEntity } from '../database/entities/tool-execution-receipt.entity.js';
import { ToolReconciliationAuditEntity } from '../database/entities/tool-reconciliation-audit.entity.js';
import {
  ToolOperationStore,
  ToolReconciliationError,
  assertToolReconciliationInput,
  type ExpiredToolConfirmationRecord,
  type ReconciledToolConfirmationRecord,
  type RecoverableToolConfirmationRecord,
  type ToolAuditRecord,
  type ToolConfirmationRecord,
  type ToolExecutionReceipt,
  type PendingToolReconciliation,
  type ReconcileIndeterminateToolInput,
  type ToolReconciliationAuditRecord,
  type ToolReconciliationResult,
} from './tool-operation.store.js';
import {
  createToolReconciliationSnapshot,
  pendingToolReconciliationFrom,
  requireToolReconciliationSnapshot,
  toolReconciliationSnapshotFrom,
} from './tool-reconciliation-snapshot.js';

export class TypeOrmToolOperationStore extends ToolOperationStore {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async saveConfirmation(record: ToolConfirmationRecord): Promise<void> {
    await this.dataSource.getRepository(ToolConfirmationEntity).insert({
      ...record,
      taskId: record.taskId ?? null,
      operationId: record.operationId ?? null,
      argumentsJson: JSON.stringify(record.arguments),
      resultSummary: record.resultSummary ?? null,
      resultJson: record.result ? { ...record.result } : undefined,
      reconciliationSnapshotJson: record.reconciliationSnapshot,
      version: record.version ?? 1,
    });
  }

  async findConfirmation(
    id: string,
  ): Promise<ToolConfirmationRecord | undefined> {
    const record = await this.dataSource
      .getRepository(ToolConfirmationEntity)
      .findOneBy({ id });
    return record ? this.confirmationFrom(record) : undefined;
  }

  async claimConfirmation(id: string): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(ToolConfirmationEntity)
      .update({ id, status: 'pending' }, { status: 'executing' });
    return result.affected === 1;
  }

  async updateConfirmation(
    id: string,
    updates: Partial<ToolConfirmationRecord>,
  ): Promise<void> {
    const entityUpdates: Partial<ToolConfirmationEntity> = {
      ...updates,
      taskId:
        updates.taskId === undefined ? undefined : (updates.taskId ?? null),
      operationId:
        updates.operationId === undefined
          ? undefined
          : (updates.operationId ?? null),
      resultJson: updates.result ? { ...updates.result } : undefined,
      reconciliationSnapshotJson: updates.reconciliationSnapshot,
      argumentsJson:
        updates.arguments === undefined
          ? undefined
          : JSON.stringify(updates.arguments),
    };
    delete (entityUpdates as { arguments?: unknown }).arguments;
    delete (entityUpdates as { result?: unknown }).result;
    delete (entityUpdates as { reconciliationSnapshot?: unknown })
      .reconciliationSnapshot;
    await this.dataSource
      .getRepository(ToolConfirmationEntity)
      .update({ id }, entityUpdates);
  }

  async listRecoverableConfirmations(
    limit: number,
  ): Promise<RecoverableToolConfirmationRecord[]> {
    const records = await this.dataSource
      .getRepository(ToolConfirmationEntity)
      .createQueryBuilder('confirmation')
      .innerJoin(
        ChatTaskEntity,
        'task',
        'task.id = confirmation.taskId AND task.ownerId = confirmation.ownerId AND task.state = :waitingState AND task.waitingToolConfirmationId = confirmation.id',
        { waitingState: 'waiting_tool_approval' },
      )
      .where('confirmation.status IN (:...statuses)', {
        statuses: ['succeeded', 'dismissed'],
      })
      .andWhere('confirmation.result_json IS NOT NULL')
      .andWhere("jsonb_typeof(confirmation.result_json->'content') = 'array'")
      .orderBy('confirmation.createdAt', 'ASC')
      .take(this.safeLimit(limit))
      .getMany();
    return records.map(
      (record) =>
        this.confirmationFrom(record) as RecoverableToolConfirmationRecord,
    );
  }

  async expirePendingConfirmations(
    now: Date,
    limit: number,
  ): Promise<ExpiredToolConfirmationRecord[]> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ToolConfirmationEntity);
      const records = await repository
        .createQueryBuilder('confirmation')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where({
          status: 'pending',
          expiresAt: LessThanOrEqual(now),
          taskId: Not(IsNull()),
          operationId: Not(IsNull()),
        })
        .orderBy('confirmation.expiresAt', 'ASC')
        .take(this.safeLimit(limit))
        .getMany();
      if (records.length === 0) return [];
      await repository.update(
        { id: In(records.map((record) => record.id)), status: 'pending' },
        { status: 'expired' },
      );
      return records.map(
        (record) =>
          this.confirmationFrom({
            ...record,
            status: 'expired',
          }) as ExpiredToolConfirmationRecord,
      );
    });
  }

  async reconcileStaleConfirmations(
    now: Date,
    limit: number,
  ): Promise<ReconciledToolConfirmationRecord[]> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ToolConfirmationEntity);
      const records = await repository
        .createQueryBuilder('confirmation')
        .innerJoin(
          ChatTaskEntity,
          'task',
          'task.id = confirmation.taskId AND task.ownerId = confirmation.ownerId AND task.state = :waitingState AND task.waitingToolConfirmationId = confirmation.id',
          { waitingState: 'waiting_tool_approval' },
        )
        .setLock('pessimistic_write', undefined, ['confirmation'])
        .setOnLocked('skip_locked')
        .where(
          '(confirmation.status IN (:...terminalStatuses) OR (confirmation.status = :executingStatus AND confirmation.expiresAt <= :now))',
          {
            terminalStatuses: ['failed', 'expired'],
            executingStatus: 'executing',
            now,
          },
        )
        .orderBy('confirmation.createdAt', 'ASC')
        .take(this.safeLimit(limit))
        .getMany();
      const executingIds = records
        .filter((record) => record.status === 'executing')
        .map((record) => record.id);
      if (executingIds.length > 0) {
        const auditRepository = manager.getRepository(ToolAuditEntity);
        for (const record of records.filter(
          (candidate) => candidate.status === 'executing',
        )) {
          const confirmation = this.confirmationFrom(record);
          const snapshot = createToolReconciliationSnapshot(confirmation, now);
          await auditRepository.insert({
            id: randomUUID(),
            ownerId: record.ownerId,
            sessionId: record.sessionId,
            toolCallId: record.toolCallId,
            toolName: record.toolName,
            riskLevel: record.riskLevel,
            action: 'indeterminate',
            confirmationId: record.id,
            executionId: null,
            requestSummary: record.requestSummary,
            resultSummary: record.resultSummary,
            createdAt: now,
          });
          const updated = await repository.update(
            { id: record.id, status: 'executing' },
            {
              status: 'indeterminate',
              reconciliationSnapshotJson: snapshot,
            },
          );
          if (updated.affected !== 1) {
            throw new ToolReconciliationError('核对记录状态已变化');
          }
          record.reconciliationSnapshotJson = snapshot;
        }
      }
      return records.map(
        (record) =>
          this.confirmationFrom({
            ...record,
            status:
              record.status === 'executing' ? 'indeterminate' : record.status,
          }) as ReconciledToolConfirmationRecord,
      );
    });
  }

  async listIndeterminateConfirmations(
    ownerId: string,
    limit: number,
  ): Promise<PendingToolReconciliation[]> {
    const records = await this.dataSource
      .getRepository(ToolConfirmationEntity)
      .createQueryBuilder('confirmation')
      .leftJoin(
        ToolReconciliationAuditEntity,
        'reconciliation',
        'reconciliation.confirmationId = confirmation.id AND reconciliation.ownerId = confirmation.ownerId',
      )
      .where('confirmation.ownerId = :ownerId', { ownerId })
      .andWhere('confirmation.status = :status', { status: 'indeterminate' })
      .andWhere('reconciliation.id IS NULL')
      .orderBy('confirmation.createdAt', 'ASC')
      .take(this.safeLimit(limit))
      .getMany();
    return records.map((record) =>
      pendingToolReconciliationFrom(this.confirmationFrom(record)),
    );
  }

  async reconcileIndeterminateConfirmation(
    input: ReconcileIndeterminateToolInput,
  ): Promise<ToolReconciliationResult> {
    assertToolReconciliationInput(input);
    return this.dataSource.transaction(async (manager) => {
      const confirmationRepository = manager.getRepository(
        ToolConfirmationEntity,
      );
      const auditRepository = manager.getRepository(
        ToolReconciliationAuditEntity,
      );
      const entity = await confirmationRepository
        .createQueryBuilder('confirmation')
        .setLock('pessimistic_write')
        .where('confirmation.id = :confirmationId', {
          confirmationId: input.confirmationId,
        })
        .andWhere('confirmation.ownerId = :ownerId', {
          ownerId: input.ownerId,
        })
        .getOne();
      if (!entity) throw new ToolReconciliationError('核对记录不存在');

      const existing = await auditRepository.findOneBy({
        confirmationId: entity.id,
      });
      if (existing) return this.replayedReconciliation(existing, input);
      if (entity.status !== input.expectedStatus) {
        throw new ToolReconciliationError('核对记录状态已变化');
      }
      if (entity.version !== input.expectedVersion) {
        throw new ToolReconciliationError('核对记录版本已变化');
      }
      const snapshot = requireToolReconciliationSnapshot(
        this.confirmationFrom(entity),
      );
      const audit: ToolReconciliationAuditRecord = {
        id: randomUUID(),
        confirmationId: entity.id,
        ownerId: entity.ownerId,
        expectedVersion: input.expectedVersion,
        confirmationVersionAfter: input.expectedVersion + 1,
        expectedStatus: input.expectedStatus,
        outcome: input.outcome,
        operatorLabel: input.operatorLabel.trim(),
        confirmationPhrase: input.confirmationPhrase,
        snapshot,
        createdAt: new Date(),
      };
      await auditRepository.insert({
        ...audit,
        snapshotJson: audit.snapshot,
      });
      const updated = await confirmationRepository.update(
        {
          id: entity.id,
          ownerId: entity.ownerId,
          status: 'indeterminate',
          version: input.expectedVersion,
        },
        { version: audit.confirmationVersionAfter },
      );
      if (updated.affected !== 1) {
        throw new ToolReconciliationError('核对记录版本或状态已变化');
      }
      return { audit, replayed: false };
    });
  }

  async saveAudit(record: ToolAuditRecord): Promise<void> {
    await this.dataSource.getRepository(ToolAuditEntity).insert({
      ...record,
      confirmationId: record.confirmationId ?? null,
      executionId: record.executionId ?? null,
      requestSummary: record.requestSummary ?? null,
      resultSummary: record.resultSummary ?? null,
    });
  }

  async listAudits(): Promise<ToolAuditRecord[]> {
    const records = await this.dataSource
      .getRepository(ToolAuditEntity)
      .find({ order: { createdAt: 'ASC' } });
    return records.map((record) => ({
      ...record,
      confirmationId: record.confirmationId ?? undefined,
      executionId: record.executionId ?? undefined,
      requestSummary: record.requestSummary ?? undefined,
      resultSummary: record.resultSummary ?? undefined,
    }));
  }

  async saveReceipt(receipt: ToolExecutionReceipt): Promise<void> {
    await this.dataSource.getRepository(ToolExecutionReceiptEntity).insert({
      ...receipt,
      undoPayloadJson: JSON.stringify(receipt.undoPayload),
    });
  }

  async findReceipt(id: string): Promise<ToolExecutionReceipt | undefined> {
    const receipt = await this.dataSource
      .getRepository(ToolExecutionReceiptEntity)
      .findOneBy({ id });
    return receipt
      ? { ...receipt, undoPayload: JSON.parse(receipt.undoPayloadJson) }
      : undefined;
  }

  async findReceiptByConfirmationId(
    confirmationId: string,
  ): Promise<ToolExecutionReceipt | undefined> {
    const receipt = await this.dataSource
      .getRepository(ToolExecutionReceiptEntity)
      .findOneBy({ confirmationId });
    return receipt
      ? { ...receipt, undoPayload: JSON.parse(receipt.undoPayloadJson) }
      : undefined;
  }

  async claimReceiptForUndo(id: string): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(ToolExecutionReceiptEntity)
      .update({ id, status: 'applied' }, { status: 'undoing' });
    return result.affected === 1;
  }

  private resultFrom(value: unknown): ToolConfirmationRecord['result'] {
    if (
      !value ||
      typeof value !== 'object' ||
      !Array.isArray((value as { content?: unknown }).content)
    ) {
      return undefined;
    }
    return value as ToolConfirmationRecord['result'];
  }

  private confirmationFrom(
    record: ToolConfirmationEntity,
  ): ToolConfirmationRecord {
    return {
      ...record,
      taskId: record.taskId ?? undefined,
      operationId: record.operationId ?? undefined,
      arguments: JSON.parse(record.argumentsJson),
      resultSummary: record.resultSummary ?? undefined,
      result: this.resultFrom(record.resultJson),
      reconciliationSnapshot: toolReconciliationSnapshotFrom(
        record.reconciliationSnapshotJson,
      ),
      version: record.version,
    };
  }

  private safeLimit(limit: number): number {
    return Math.max(1, Math.min(Math.trunc(limit) || 1, 100));
  }

  private replayedReconciliation(
    entity: ToolReconciliationAuditEntity,
    input: ReconcileIndeterminateToolInput,
  ): ToolReconciliationResult {
    if (
      entity.expectedVersion !== input.expectedVersion ||
      entity.expectedStatus !== input.expectedStatus ||
      entity.outcome !== input.outcome ||
      entity.operatorLabel !== input.operatorLabel.trim() ||
      entity.confirmationPhrase !== input.confirmationPhrase
    ) {
      throw new ToolReconciliationError('核对记录已由其他结论处理');
    }
    const snapshot = toolReconciliationSnapshotFrom(entity.snapshotJson);
    if (!snapshot) throw new ToolReconciliationError('核对安全快照缺失');
    return {
      audit: {
        ...entity,
        snapshot,
      },
      replayed: true,
    };
  }

  async updateReceipt(
    id: string,
    updates: Partial<ToolExecutionReceipt>,
  ): Promise<void> {
    const entityUpdates: Partial<ToolExecutionReceiptEntity> = {
      ...updates,
      undoPayloadJson:
        updates.undoPayload === undefined
          ? undefined
          : JSON.stringify(updates.undoPayload),
    };
    delete (entityUpdates as { undoPayload?: unknown }).undoPayload;
    await this.dataSource
      .getRepository(ToolExecutionReceiptEntity)
      .update({ id }, entityUpdates);
  }
}
