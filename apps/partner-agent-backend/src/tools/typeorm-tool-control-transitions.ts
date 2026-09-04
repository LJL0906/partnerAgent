import type { DataSource } from 'typeorm';
import { ToolConfirmationEntity } from '../database/entities/tool-confirmation.entity.js';
import { ToolExecutionReceiptEntity } from '../database/entities/tool-execution-receipt.entity.js';
import { ToolControlOutboxWriter } from './tool-control-outbox.js';
import type { ToolApprovalDecision } from './tool-operation.store.js';

export async function claimConfirmationWithOutbox(
  dataSource: DataSource,
  id: string,
  decision: ToolApprovalDecision = 'confirm',
): Promise<boolean> {
  return dataSource.transaction(async (manager) => {
    const repository = manager.getRepository(ToolConfirmationEntity);
    const record = await repository
      .createQueryBuilder('confirmation')
      .setLock('pessimistic_write')
      .where('confirmation.id = :id', { id })
      .getOne();
    if (!record || record.status !== 'pending') return false;
    record.status = 'executing';
    await repository.save(record);
    if (decision === 'confirm') {
      await ToolControlOutboxWriter.append(manager, record, [
        {
          key: 'confirmation-confirmed',
          type: 'tool_confirmation_confirmed',
          data: {
            confirmation_id: record.id,
            tool: record.toolName,
            tool_call_id: record.toolCallId,
          },
        },
        {
          key: 'execution-start',
          type: 'tool_execution_start',
          data: { tool: record.toolName, tool_call_id: record.toolCallId },
        },
      ]);
    }
    return true;
  });
}

export async function updateConfirmationWithOutbox(
  dataSource: DataSource,
  id: string,
  updates: Partial<ToolConfirmationEntity>,
): Promise<void> {
  await dataSource.transaction(async (manager) => {
    const repository = manager.getRepository(ToolConfirmationEntity);
    const record = await repository
      .createQueryBuilder('confirmation')
      .setLock('pessimistic_write')
      .where('confirmation.id = :id', { id })
      .getOne();
    if (!record) return;
    const previousStatus = record.status;
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        (record as unknown as Record<string, unknown>)[key] = value;
      }
    }
    await repository.save(record);
    if (previousStatus === record.status) return;
    if (record.status === 'dismissed') {
      await ToolControlOutboxWriter.append(manager, record, [
        {
          key: 'confirmation-dismissed',
          type: 'tool_confirmation_dismissed',
          data: {
            confirmation_id: record.id,
            tool: record.toolName,
            tool_call_id: record.toolCallId,
            reason: 'user_dismissed',
          },
        },
      ]);
      return;
    }
    if (record.status !== 'succeeded' && record.status !== 'failed') return;
    const receipt = await manager
      .getRepository(ToolExecutionReceiptEntity)
      .findOneBy({ confirmationId: record.id });
    await ToolControlOutboxWriter.append(manager, record, [
      {
        key: `execution-end-${record.status}`,
        type: 'tool_execution_end',
        data: {
          tool: record.toolName,
          tool_call_id: record.toolCallId,
          success: record.status === 'succeeded',
          ...(receipt
            ? { execution_id: receipt.id, undo_available: true }
            : {}),
          ...(receipt
            ? { undo_expires_at: receipt.undoExpiresAt.getTime() }
            : {}),
        },
      },
      ...(receipt
        ? [
            {
              key: `undo-available-${receipt.id}`,
              type: 'tool_undo_available' as const,
              data: {
                execution_id: receipt.id,
                tool: record.toolName,
                expires_at: receipt.undoExpiresAt.getTime(),
              },
            },
          ]
        : []),
    ]);
  });
}

export async function completeUndoWithOutbox(
  dataSource: DataSource,
  executionId: string,
): Promise<void> {
  await dataSource.transaction(async (manager) => {
    const receiptRepository = manager.getRepository(ToolExecutionReceiptEntity);
    const receipt = await receiptRepository
      .createQueryBuilder('receipt')
      .setLock('pessimistic_write')
      .where('receipt.id = :executionId', { executionId })
      .getOne();
    if (!receipt || receipt.status !== 'undoing') {
      throw new Error('执行记录不存在或状态已变化');
    }
    const confirmationRepository = manager.getRepository(
      ToolConfirmationEntity,
    );
    const confirmation = await confirmationRepository
      .createQueryBuilder('confirmation')
      .setLock('pessimistic_write')
      .where('confirmation.id = :id', { id: receipt.confirmationId })
      .getOne();
    if (!confirmation) throw new Error('确认请求不存在');
    receipt.status = 'undone';
    confirmation.status = 'undone';
    await receiptRepository.save(receipt);
    await confirmationRepository.save(confirmation);
    await ToolControlOutboxWriter.append(manager, confirmation, [
      {
        key: `undo-completed-${executionId}`,
        type: 'tool_undo_completed',
        data: {
          execution_id: executionId,
          tool: confirmation.toolName,
          success: true,
        },
      },
    ]);
  });
}
