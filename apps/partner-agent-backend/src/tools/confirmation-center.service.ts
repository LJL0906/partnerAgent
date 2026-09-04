import { Injectable, NotFoundException } from '@nestjs/common';
import { ToolOperationStore } from './tool-operation.store.js';
import { ToolExecutionService } from './tool-execution.service.js';
import { ToolRegistryService } from './tool-registry.service.js';
import type {
  ToolExecutionContext,
  ToolExecutionOutcome,
} from './tool.types.js';

@Injectable()
export class ExternalToolApprovalService {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly execution: ToolExecutionService,
    private readonly store: ToolOperationStore,
  ) {}

  async confirm(
    confirmationId: string,
    context: ToolExecutionContext,
    onConfirmed?: (details: { tool: string; toolCallId: string }) => void,
  ): Promise<{
    tool: string;
    toolCallId: string;
    outcome: ToolExecutionOutcome;
  }> {
    const record = await this.requireConfirmation(confirmationId, context);
    if (record.expiresAt.getTime() <= Date.now()) {
      await this.store.updateConfirmation(record.id, { status: 'expired' });
      const definition = this.registry.get(record.toolName);
      await this.execution.audit(
        definition,
        record.toolCallId,
        context,
        'expired',
        {
          confirmationId,
        },
      );
      throw new Error('确认请求已过期');
    }
    if (!(await this.store.claimConfirmation(record.id))) {
      throw new Error('确认请求已处理');
    }

    const definition = this.registry.get(record.toolName);
    if (definition.effect !== 'external_side_effect') {
      throw new Error('该记录不是外部 Tool Approval');
    }
    await this.execution.audit(
      definition,
      record.toolCallId,
      context,
      'confirmed',
      {
        confirmationId,
      },
    );
    onConfirmed?.({ tool: record.toolName, toolCallId: record.toolCallId });
    try {
      const outcome = await this.execution.executeConfirmed(
        confirmationId,
        definition,
        record.toolCallId,
        record.arguments,
        context,
      );
      await this.store.updateConfirmation(record.id, {
        status: 'succeeded',
        resultSummary: this.summaryFrom(outcome.result.details),
      });
      return { tool: record.toolName, toolCallId: record.toolCallId, outcome };
    } catch (error) {
      await this.store.updateConfirmation(record.id, { status: 'failed' });
      throw error;
    }
  }

  async dismiss(
    confirmationId: string,
    context: ToolExecutionContext,
  ): Promise<{ tool: string; toolCallId: string }> {
    const record = await this.requireConfirmation(confirmationId, context);
    if (!(await this.store.claimConfirmation(record.id))) {
      throw new Error('确认请求已处理');
    }
    await this.store.updateConfirmation(record.id, { status: 'dismissed' });
    const definition = this.registry.get(record.toolName);
    await this.execution.audit(
      definition,
      record.toolCallId,
      context,
      'dismissed',
      {
        confirmationId,
      },
    );
    return { tool: record.toolName, toolCallId: record.toolCallId };
  }

  async undo(
    executionId: string,
    context: ToolExecutionContext,
  ): Promise<{ tool: string }> {
    const receipt = await this.store.findReceipt(executionId);
    if (
      !receipt ||
      receipt.ownerId !== context.ownerId ||
      receipt.sessionId !== context.sessionId
    ) {
      throw new NotFoundException('执行记录不存在');
    }
    if (receipt.undoExpiresAt.getTime() <= Date.now()) {
      throw new Error('外部工具副作用撤销期限已过');
    }
    const definition = this.registry.get(receipt.toolName);
    if (!definition.undo) throw new Error('该工具不可撤销');
    if (!(await this.store.claimReceiptForUndo(receipt.id))) {
      throw new Error('执行记录已撤销或正在撤销');
    }

    try {
      await definition.undo(receipt.undoPayload);
      await this.store.updateReceipt(receipt.id, { status: 'undone' });
      await this.store.updateConfirmation(receipt.confirmationId, {
        status: 'undone',
      });
      await this.execution.audit(definition, '', context, 'undone', {
        confirmationId: receipt.confirmationId,
        executionId,
      });
      return { tool: receipt.toolName };
    } catch (error) {
      await this.store.updateReceipt(receipt.id, { status: 'undo_failed' });
      await this.execution.audit(definition, '', context, 'undo_failed', {
        confirmationId: receipt.confirmationId,
        executionId,
      });
      throw error;
    }
  }

  private async requireConfirmation(
    confirmationId: string,
    context: ToolExecutionContext,
  ) {
    const record = await this.store.findConfirmation(confirmationId);
    if (
      !record ||
      record.ownerId !== context.ownerId ||
      record.sessionId !== context.sessionId
    ) {
      throw new NotFoundException('确认请求不存在');
    }
    return record;
  }

  private summaryFrom(value: unknown): string {
    return JSON.stringify(value).slice(0, 2_000);
  }
}

/** @deprecated 旧名称；该服务只处理外部系统副作用审批，不处理正式业务确认。 */
export { ExternalToolApprovalService as ConfirmationCenterService };
