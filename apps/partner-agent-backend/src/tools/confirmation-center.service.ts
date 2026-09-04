import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ToolOperationStore,
  type ConfirmationStatus,
  type ToolConfirmationRecord,
} from './tool-operation.store.js';
import { ToolExecutionService } from './tool-execution.service.js';
import { ToolRegistryService } from './tool-registry.service.js';
import type {
  ToolExecutionContext,
  ToolExecutionOutcome,
} from './tool.types.js';

export interface ExternalToolControlResult {
  tool: string;
  toolCallId: string;
  taskId?: string;
  operationId?: string;
}

export interface ExternalToolPendingContext extends ExternalToolControlResult {
  status: ConfirmationStatus;
  expiresAt: Date;
}

export interface ExternalToolDecisionResult extends ExternalToolControlResult {
  decision: 'confirmed' | 'dismissed';
  replayed: boolean;
  outcome: ToolExecutionOutcome;
}

export interface RecoverableExternalToolDecision extends ExternalToolDecisionResult {
  confirmationId: string;
  ownerId: string;
  sessionId: string;
  taskId: string;
  operationId: string;
}

export interface ExpiredExternalToolApproval extends ExternalToolControlResult {
  confirmationId: string;
  ownerId: string;
  sessionId: string;
  taskId: string;
  operationId: string;
}

export interface ReconciledExternalToolApproval extends ExternalToolControlResult {
  confirmationId: string;
  ownerId: string;
  sessionId: string;
  taskId: string;
  operationId: string;
  status: 'failed' | 'expired' | 'indeterminate';
}

@Injectable()
export class ExternalToolApprovalService {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly execution: ToolExecutionService,
    private readonly store: ToolOperationStore,
  ) {}

  /** 只返回 WS 路由所需元数据，不暴露工具参数或结果。 */
  async getPendingContext(
    confirmationId: string,
    context: ToolExecutionContext,
  ): Promise<ExternalToolPendingContext> {
    const record = await this.requireConfirmation(confirmationId, context);
    return {
      ...this.controlResult(record),
      status: record.status,
      expiresAt: record.expiresAt,
    };
  }

  async confirm(
    confirmationId: string,
    context: ToolExecutionContext,
    onConfirmed?: (details: { tool: string; toolCallId: string }) => void,
  ): Promise<ExternalToolDecisionResult> {
    const record = await this.requireConfirmation(confirmationId, context);
    if (record.status === 'succeeded') {
      return this.recoverDecision(record);
    }
    if (record.status !== 'pending') throw new Error('确认请求已处理');
    this.assertNotExpired(record);
    if (!(await this.store.claimConfirmation(record.id, 'confirm'))) {
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
        result: structuredClone(outcome.result),
      });
      return {
        ...this.controlResult(record),
        decision: 'confirmed',
        replayed: false,
        outcome,
      };
    } catch (error) {
      await this.store.updateConfirmation(record.id, { status: 'failed' });
      throw error;
    }
  }

  async dismiss(
    confirmationId: string,
    context: ToolExecutionContext,
  ): Promise<ExternalToolDecisionResult> {
    const record = await this.requireConfirmation(confirmationId, context);
    if (record.status === 'dismissed') {
      return this.recoverDecision(record);
    }
    if (record.status !== 'pending') throw new Error('确认请求已处理');
    this.assertNotExpired(record);
    if (!(await this.store.claimConfirmation(record.id, 'dismiss'))) {
      throw new Error('确认请求已处理');
    }
    const result = this.dismissedResult();
    await this.store.updateConfirmation(record.id, {
      status: 'dismissed',
      result,
      resultSummary: this.summaryFrom(result.details),
    });
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
    return {
      ...this.controlResult(record),
      decision: 'dismissed',
      replayed: false,
      outcome: { result },
    };
  }

  async recover(
    confirmationId: string,
    context: ToolExecutionContext,
  ): Promise<ExternalToolDecisionResult> {
    return this.recoverDecision(
      await this.requireConfirmation(confirmationId, context),
    );
  }

  async listRecoverableDecisions(
    limit = 100,
  ): Promise<RecoverableExternalToolDecision[]> {
    const records = await this.store.listRecoverableConfirmations(limit);
    return Promise.all(
      records.map(async (record) => ({
        ...(await this.recoverDecision(record)),
        confirmationId: record.id,
        ownerId: record.ownerId,
        sessionId: record.sessionId,
        taskId: record.taskId,
        operationId: record.operationId,
      })),
    );
  }

  async expirePendingConfirmations(
    now = new Date(),
    limit = 100,
  ): Promise<ExpiredExternalToolApproval[]> {
    const records = await this.store.expirePendingConfirmations(now, limit);
    await Promise.allSettled(
      records.map(async (record) => {
        const definition = this.registry.get(record.toolName);
        await this.execution.audit(
          definition,
          record.toolCallId,
          { ownerId: record.ownerId, sessionId: record.sessionId },
          'expired',
          { confirmationId: record.id },
        );
      }),
    );
    return records.map((record) => ({
      ...this.controlResult(record),
      confirmationId: record.id,
      ownerId: record.ownerId,
      sessionId: record.sessionId,
      taskId: record.taskId,
      operationId: record.operationId,
    }));
  }

  async reconcileStaleConfirmations(
    now = new Date(),
    limit = 100,
  ): Promise<ReconciledExternalToolApproval[]> {
    const records = await this.store.reconcileStaleConfirmations(now, limit);
    return records.map((record) => ({
      ...this.controlResult(record),
      confirmationId: record.id,
      ownerId: record.ownerId,
      sessionId: record.sessionId,
      taskId: record.taskId,
      operationId: record.operationId,
      status: record.status,
    }));
  }

  async undo(
    executionId: string,
    context: ToolExecutionContext,
  ): Promise<ExternalToolControlResult> {
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
      await this.store.completeUndo(receipt.id);
      await this.execution.audit(definition, '', context, 'undone', {
        confirmationId: receipt.confirmationId,
        executionId,
      });
      const confirmation = await this.requireConfirmation(
        receipt.confirmationId,
        context,
      );
      return this.controlResult(confirmation);
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

  private async recoverDecision(
    record: ToolConfirmationRecord,
  ): Promise<ExternalToolDecisionResult> {
    if (record.status === 'dismissed') {
      return {
        ...this.controlResult(record),
        decision: 'dismissed',
        replayed: true,
        outcome: { result: record.result ?? this.dismissedResult() },
      };
    }
    if (record.status !== 'succeeded' || !record.result) {
      throw new Error('确认请求不可恢复');
    }
    const receipt = await this.store.findReceiptByConfirmationId(record.id);
    return {
      ...this.controlResult(record),
      decision: 'confirmed',
      replayed: true,
      outcome: {
        result: structuredClone(record.result),
        ...(receipt?.status === 'applied'
          ? {
              executionId: receipt.id,
              externalUndoExpiresAt: receipt.undoExpiresAt,
            }
          : {}),
      },
    };
  }

  private dismissedResult() {
    return {
      content: [
        { type: 'text' as const, text: '用户拒绝了这次外部工具调用。' },
      ],
      details: { status: 'user_dismissed' },
    };
  }

  private assertNotExpired(record: ToolConfirmationRecord): void {
    if (record.expiresAt.getTime() <= Date.now()) throw new Error('TOOL_002');
  }

  private controlResult(record: {
    toolName: string;
    toolCallId: string;
    taskId?: string;
    operationId?: string;
  }): ExternalToolControlResult {
    return {
      tool: record.toolName,
      toolCallId: record.toolCallId,
      ...(record.taskId ? { taskId: record.taskId } : {}),
      ...(record.operationId ? { operationId: record.operationId } : {}),
    };
  }
}

/** @deprecated 旧名称；该服务只处理外部系统副作用审批，不处理正式业务确认。 */
export { ExternalToolApprovalService as ConfirmationCenterService };
