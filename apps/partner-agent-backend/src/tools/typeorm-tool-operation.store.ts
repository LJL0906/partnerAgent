import type { DataSource } from 'typeorm';
import { ToolAuditEntity } from '../database/entities/tool-audit.entity.js';
import { ToolConfirmationEntity } from '../database/entities/tool-confirmation.entity.js';
import { ToolExecutionReceiptEntity } from '../database/entities/tool-execution-receipt.entity.js';
import {
  ToolOperationStore,
  type ToolAuditRecord,
  type ToolConfirmationRecord,
  type ToolExecutionReceipt,
} from './tool-operation.store.js';

export class TypeOrmToolOperationStore extends ToolOperationStore {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async saveConfirmation(record: ToolConfirmationRecord): Promise<void> {
    await this.dataSource.getRepository(ToolConfirmationEntity).insert({
      ...record,
      argumentsJson: JSON.stringify(record.arguments),
      resultSummary: record.resultSummary ?? null,
    });
  }

  async findConfirmation(
    id: string,
  ): Promise<ToolConfirmationRecord | undefined> {
    const record = await this.dataSource
      .getRepository(ToolConfirmationEntity)
      .findOneBy({ id });
    return record
      ? {
          ...record,
          arguments: JSON.parse(record.argumentsJson),
          resultSummary: record.resultSummary ?? undefined,
        }
      : undefined;
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
      argumentsJson:
        updates.arguments === undefined
          ? undefined
          : JSON.stringify(updates.arguments),
    };
    delete (entityUpdates as { arguments?: unknown }).arguments;
    await this.dataSource
      .getRepository(ToolConfirmationEntity)
      .update({ id }, entityUpdates);
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

  async claimReceiptForUndo(id: string): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(ToolExecutionReceiptEntity)
      .update({ id, status: 'applied' }, { status: 'undoing' });
    return result.affected === 1;
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
