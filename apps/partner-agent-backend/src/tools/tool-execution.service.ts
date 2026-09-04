import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { ConfigService } from '@nestjs/config';
import { RedactionService } from './redaction.service.js';
import { ToolOperationStore } from './tool-operation.store.js';
import { ToolRegistryService } from './tool-registry.service.js';
import type {
  RegisteredTool,
  ToolExecutionContext,
  ToolExecutionOutcome,
} from './tool.types.js';

const DEFAULT_EXTERNAL_TOOL_APPROVAL_TTL_MS = 10 * 60 * 1000;
const DEFAULT_EXTERNAL_TOOL_UNDO_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class ToolExecutionService {
  private readonly externalToolApprovalTtlMs: number;
  private readonly externalToolUndoTtlMs: number;

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly store: ToolOperationStore,
    private readonly redaction: RedactionService,
    configService: ConfigService,
  ) {
    this.externalToolApprovalTtlMs = Number(
      configService.get<string>('EXTERNAL_TOOL_APPROVAL_TTL_MS') ??
        configService.get<string>('TOOL_CONFIRMATION_TTL_MS') ??
        DEFAULT_EXTERNAL_TOOL_APPROVAL_TTL_MS,
    );
    this.externalToolUndoTtlMs = Number(
      configService.get<string>('EXTERNAL_TOOL_UNDO_TTL_MS') ??
        configService.get<string>('TOOL_UNDO_TTL_MS') ??
        DEFAULT_EXTERNAL_TOOL_UNDO_TTL_MS,
    );
  }

  createAgentTools(context: ToolExecutionContext): AgentTool[] {
    return this.registry
      .list()
      .filter((definition) => this.hasPermissions(definition, context))
      .map((definition) =>
        this.registry.toPublicTool(definition, (toolCallId, args, signal) =>
          this.executeOrStage(definition, toolCallId, args, context, signal),
        ),
      );
  }

  async executeConfirmed(
    confirmationId: string,
    definition: RegisteredTool,
    toolCallId: string,
    args: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutcome> {
    if (definition.effect !== 'external_side_effect') {
      throw new Error('Tool Approval 只能执行已审批的外部系统副作用工具');
    }
    await this.assertPermissions(definition, context, toolCallId);
    return this.executeNow(
      definition,
      toolCallId,
      args,
      context,
      confirmationId,
    );
  }

  private async executeOrStage(
    definition: RegisteredTool,
    toolCallId: string,
    args: unknown,
    context: ToolExecutionContext,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<unknown>> {
    await this.assertPermissions(definition, context, toolCallId);
    const requestSummary = this.redaction.summarize(args);
    if (definition.effect === 'formal_business_data') {
      const rawResult = await definition.createCandidateBatch!(
        structuredClone(args),
        context,
        toolCallId,
      );
      this.assertCandidateBatchResult(rawResult.details);
      const result = this.sanitizeResult(rawResult);
      await this.audit(definition, toolCallId, context, 'candidate_staged', {
        requestSummary,
        resultSummary: this.redaction.summarize(result.details),
      });
      return result;
    }

    if (definition.requiresToolApproval) {
      const confirmationId = randomUUID();
      const expiresAt = new Date(Date.now() + this.externalToolApprovalTtlMs);
      await this.store.saveConfirmation({
        id: confirmationId,
        ownerId: context.ownerId,
        sessionId: context.sessionId,
        toolCallId,
        toolName: definition.tool.name,
        riskLevel: definition.riskLevel,
        status: 'pending',
        arguments: structuredClone(args),
        requestSummary,
        createdAt: new Date(),
        expiresAt,
      });
      await this.audit(definition, toolCallId, context, 'staged', {
        confirmationId,
        requestSummary,
      });
      return {
        content: [{ type: 'text', text: '外部工具调用等待用户审批。' }],
        details: {
          status: 'pending_tool_approval',
          confirmationId,
          requestSummary,
          expiresAt: expiresAt.toISOString(),
        },
        terminate: true,
      };
    }

    return (
      await this.executeNow(
        definition,
        toolCallId,
        args,
        context,
        undefined,
        signal,
      )
    ).result;
  }

  private async executeNow(
    definition: RegisteredTool,
    toolCallId: string,
    args: unknown,
    context: ToolExecutionContext,
    confirmationId?: string,
    signal?: AbortSignal,
  ): Promise<ToolExecutionOutcome> {
    try {
      const rawResult = await definition.tool.execute(
        toolCallId,
        args as never,
        signal,
      );
      const result = this.sanitizeResult(rawResult);
      const resultSummary = this.redaction.summarize(result.details);
      const outcome: ToolExecutionOutcome = { result };

      if (definition.undo && definition.createUndoPayload && confirmationId) {
        const executionId = randomUUID();
        const undoExpiresAt = new Date(Date.now() + this.externalToolUndoTtlMs);
        await this.store.saveReceipt({
          id: executionId,
          confirmationId,
          ownerId: context.ownerId,
          sessionId: context.sessionId,
          toolName: definition.tool.name,
          undoPayload: definition.createUndoPayload(args, rawResult),
          status: 'applied',
          appliedAt: new Date(),
          undoExpiresAt,
        });
        outcome.executionId = executionId;
        outcome.externalUndoExpiresAt = undoExpiresAt;
      }

      await this.audit(definition, toolCallId, context, 'executed', {
        confirmationId,
        executionId: outcome.executionId,
        requestSummary: this.redaction.summarize(args),
        resultSummary,
      });
      return outcome;
    } catch (error) {
      await this.audit(definition, toolCallId, context, 'failed', {
        confirmationId,
        requestSummary: this.redaction.summarize(args),
        resultSummary: this.redaction.summarize({
          error: error instanceof Error ? error.message : '工具执行失败',
        }),
      });
      throw error;
    }
  }

  private sanitizeResult(
    rawResult: AgentToolResult<unknown>,
  ): AgentToolResult<unknown> {
    const sanitizedDetails = this.redaction.sanitize(rawResult.details);
    return {
      content: [
        { type: 'text', text: this.redaction.summarize(sanitizedDetails) },
      ],
      details: sanitizedDetails,
      terminate: rawResult.terminate,
    };
  }

  private async assertPermissions(
    definition: RegisteredTool,
    context: ToolExecutionContext,
    toolCallId: string,
  ): Promise<void> {
    const granted = new Set(context.permissions ?? []);
    const missing = definition.requiredPermissions.filter(
      (permission) => !granted.has(permission),
    );
    if (missing.length === 0) return;
    await this.audit(definition, toolCallId, context, 'denied', {
      resultSummary: this.redaction.summarize({ missing_permissions: missing }),
    });
    throw new Error('工具权限不足');
  }

  private hasPermissions(
    definition: RegisteredTool,
    context: ToolExecutionContext,
  ): boolean {
    const granted = new Set(context.permissions ?? []);
    return definition.requiredPermissions.every((permission) =>
      granted.has(permission),
    );
  }

  private assertCandidateBatchResult(details: unknown): void {
    if (
      !details ||
      typeof details !== 'object' ||
      (details as { status?: unknown }).status !== 'candidate_staged' ||
      typeof (details as { batch_id?: unknown }).batch_id !== 'string' ||
      !Array.isArray((details as { candidate_ids?: unknown }).candidate_ids)
    ) {
      throw new Error('正式业务工具必须返回 Candidate/Batch 引用');
    }
  }

  async audit(
    definition: RegisteredTool,
    toolCallId: string,
    context: ToolExecutionContext,
    action: Parameters<ToolOperationStore['saveAudit']>[0]['action'],
    details: {
      confirmationId?: string;
      executionId?: string;
      requestSummary?: string;
      resultSummary?: string;
    } = {},
  ): Promise<void> {
    await this.store.saveAudit({
      id: randomUUID(),
      ownerId: context.ownerId,
      sessionId: context.sessionId,
      toolCallId,
      toolName: definition.tool.name,
      riskLevel: definition.riskLevel,
      action,
      ...details,
      createdAt: new Date(),
    });
  }
}
