import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ToolConfirmationControlRequestV1,
  ToolControlAckV1,
  ToolControlActionV1,
  ToolUndoControlRequestV1,
} from '@partner-agent/contracts';
import type { Socket } from 'socket.io';
import {
  ChatTaskScheduler,
  type ToolDecisionClaim,
} from '../local-core-api/chat-task-scheduler.js';
import {
  ChatTaskStore,
  type StoredChatTask,
} from '../local-core-api/chat-task.store.js';
import {
  ExternalToolApprovalService,
  type ExternalToolControlResult,
  type ExternalToolDecisionResult,
  type ExternalToolPendingContext,
} from '../tools/confirmation-center.service.js';
import { ToolOperationStore } from '../tools/tool-operation.store.js';
import { WsV1Service } from './ws-v1.service.js';

@Injectable()
export class WsV1ToolControlService {
  constructor(
    private readonly approval: ExternalToolApprovalService,
    private readonly tasks: ChatTaskStore,
    private readonly scheduler: ChatTaskScheduler,
    private readonly events: WsV1Service,
    private readonly toolStore: ToolOperationStore,
  ) {}

  async confirm(
    socket: Socket,
    request: ToolConfirmationControlRequestV1,
  ): Promise<ToolControlAckV1> {
    return this.control(request?.request_id, 'confirm', async () => {
      const input = this.confirmationInput(socket, request);
      const pending = await this.approval.getPendingContext(
        input.confirmationId,
        input.context,
      );
      this.assertRecoverableStatus(pending);
      const task = await this.requireWaitingTask(
        input.context.ownerId,
        input.context.sessionId,
        pending,
      );
      if (
        pending.status === 'pending' &&
        pending.expiresAt.getTime() <= Date.now()
      ) {
        await this.scheduler.expireToolDecision(task, input.confirmationId);
        throw new Error('TOOL_002');
      }
      const claim = await this.scheduler.claimToolDecision(
        task,
        input.confirmationId,
        pending.toolCallId,
        pending.tool,
      );
      if (!claim) {
        throw new Error('CONFIRMATION_002');
      }
      let started: ExternalToolControlResult | undefined;
      let startedPublishing = Promise.resolve();
      try {
        const decision =
          pending.status === 'pending'
            ? await this.approval.confirm(
                input.confirmationId,
                input.context,
                (metadata) => {
                  started = { ...pending, ...metadata };
                  if (!this.usesDurableToolEvents()) {
                    startedPublishing = this.publishConfirmed(
                      started,
                      input.context.sessionId,
                      input.confirmationId,
                    ).then(() =>
                      this.publish(
                        started!,
                        input.context.sessionId,
                        'tool_execution_start',
                        {
                          tool: metadata.tool,
                          tool_call_id: metadata.toolCallId,
                        },
                      ),
                    );
                  }
                },
              )
            : await this.approval.recover(input.confirmationId, input.context);
        await startedPublishing;
        await this.completeDecision(
          task,
          claim,
          input.confirmationId,
          input.context.sessionId,
          decision,
          Boolean(started),
        );
      } catch (error) {
        if (started && !this.usesDurableToolEvents()) {
          await startedPublishing;
          await this.publish(
            started,
            input.context.sessionId,
            'tool_execution_end',
            {
              tool: started.tool,
              tool_call_id: started.toolCallId,
              success: false,
            },
          );
        }
        await this.scheduler.failClaimedToolDecision(task, claim, error);
        throw error;
      }
    });
  }

  async dismiss(
    socket: Socket,
    request: ToolConfirmationControlRequestV1,
  ): Promise<ToolControlAckV1> {
    return this.control(request?.request_id, 'dismiss', async () => {
      const input = this.confirmationInput(socket, request);
      const pending = await this.approval.getPendingContext(
        input.confirmationId,
        input.context,
      );
      this.assertRecoverableStatus(pending);
      const task = await this.requireWaitingTask(
        input.context.ownerId,
        input.context.sessionId,
        pending,
      );
      if (
        pending.status === 'pending' &&
        pending.expiresAt.getTime() <= Date.now()
      ) {
        await this.scheduler.expireToolDecision(task, input.confirmationId);
        throw new Error('TOOL_002');
      }
      const claim = await this.scheduler.claimToolDecision(
        task,
        input.confirmationId,
        pending.toolCallId,
        pending.tool,
      );
      if (!claim) {
        throw new Error('CONFIRMATION_002');
      }
      try {
        const decision =
          pending.status === 'pending'
            ? await this.approval.dismiss(input.confirmationId, input.context)
            : await this.approval.recover(input.confirmationId, input.context);
        await this.completeDecision(
          task,
          claim,
          input.confirmationId,
          input.context.sessionId,
          decision,
          false,
        );
      } catch (error) {
        await this.scheduler.failClaimedToolDecision(task, claim, error);
        throw error;
      }
    });
  }

  async undo(
    socket: Socket,
    request: ToolUndoControlRequestV1,
  ): Promise<ToolControlAckV1> {
    return this.control(request?.request_id, 'undo', async () => {
      const input = this.undoInput(socket, request);
      const undone = await this.approval.undo(input.executionId, input.context);
      if (!this.usesDurableToolEvents()) {
        await this.publish(
          undone,
          input.context.sessionId,
          'tool_undo_completed',
          {
            execution_id: input.executionId,
            tool: undone.tool,
            success: true,
          },
        );
      }
    });
  }

  private async control(
    requestId: unknown,
    action: ToolControlActionV1,
    execute: () => Promise<void>,
  ): Promise<ToolControlAckV1> {
    const safeRequestId = this.isNonEmptyString(requestId) ? requestId : '';
    try {
      await execute();
      return { request_id: safeRequestId, action, status: 'completed' };
    } catch (error) {
      return {
        request_id: safeRequestId,
        action,
        status: 'rejected',
        error: this.safeError(error),
      };
    }
  }

  private confirmationInput(
    socket: Socket,
    request: ToolConfirmationControlRequestV1,
  ) {
    const requestId = request?.request_id;
    const sessionId = request?.session_id;
    const confirmationId = request?.confirmation_id;
    this.requireIdentifiers({
      requestId,
      sessionId,
      resourceId: confirmationId,
    });
    return {
      confirmationId,
      context: { ownerId: this.requireAuthenticated(socket), sessionId },
    };
  }

  private undoInput(socket: Socket, request: ToolUndoControlRequestV1) {
    const requestId = request?.request_id;
    const sessionId = request?.session_id;
    const executionId = request?.execution_id;
    this.requireIdentifiers({ requestId, sessionId, resourceId: executionId });
    return {
      executionId,
      context: { ownerId: this.requireAuthenticated(socket), sessionId },
    };
  }

  private requireIdentifiers(input: {
    requestId: unknown;
    sessionId: unknown;
    resourceId: unknown;
  }): asserts input is {
    requestId: string;
    sessionId: string;
    resourceId: string;
  } {
    if (
      !this.isNonEmptyString(input.requestId) ||
      !this.isNonEmptyString(input.sessionId) ||
      !this.isNonEmptyString(input.resourceId)
    ) {
      throw new Error('VALIDATION_001');
    }
  }

  private requireAuthenticated(socket: Socket): string {
    const userId = socket.data.userId;
    if (!this.isNonEmptyString(userId)) throw new Error('AUTH_001');
    return userId;
  }

  private async requireWaitingTask(
    ownerId: string,
    sessionId: string,
    pending: ExternalToolControlResult,
  ): Promise<StoredChatTask> {
    if (!pending.taskId || !pending.operationId) {
      throw new Error('CONFIRMATION_002');
    }
    const task = await this.tasks.getTask(ownerId, pending.taskId);
    if (
      !task ||
      task.sessionId !== sessionId ||
      task.operationId !== pending.operationId
    ) {
      throw new NotFoundException('任务不存在');
    }
    if (String(task.state) !== 'waiting_tool_approval') {
      throw new Error('CONFIRMATION_002');
    }
    return task;
  }

  private assertRecoverableStatus(context: ExternalToolPendingContext): void {
    if (!['pending', 'succeeded', 'dismissed'].includes(context.status)) {
      throw new Error('CONFIRMATION_002');
    }
  }

  private async completeDecision(
    task: StoredChatTask,
    claim: ToolDecisionClaim,
    confirmationId: string,
    sessionId: string,
    decision: ExternalToolDecisionResult,
    confirmationAlreadyPublished: boolean,
  ): Promise<void> {
    if (!this.usesDurableToolEvents()) {
      if (decision.decision === 'confirmed') {
        if (!confirmationAlreadyPublished) {
          await this.publishConfirmed(decision, sessionId, confirmationId);
        }
        const executionId = decision.outcome.executionId;
        const undoExpiresAt = decision.outcome.externalUndoExpiresAt;
        await this.publish(decision, sessionId, 'tool_execution_end', {
          tool: decision.tool,
          tool_call_id: decision.toolCallId,
          success: true,
          ...(executionId ? { execution_id: executionId } : {}),
          ...(executionId ? { undo_available: true } : {}),
          ...(undoExpiresAt
            ? { undo_expires_at: undoExpiresAt.getTime() }
            : {}),
        });
        if (executionId && undoExpiresAt) {
          await this.publish(decision, sessionId, 'tool_undo_available', {
            execution_id: executionId,
            tool: decision.tool,
            expires_at: undoExpiresAt.getTime(),
          });
        }
      } else {
        await this.publish(decision, sessionId, 'tool_confirmation_dismissed', {
          confirmation_id: confirmationId,
          tool: decision.tool,
          tool_call_id: decision.toolCallId,
          reason: 'user_dismissed',
        });
      }
    }
    this.scheduler.resumeClaimedToolDecision(task, claim, {
      toolCallId: decision.toolCallId,
      toolName: decision.tool,
      result: decision.outcome.result,
      isError: decision.decision === 'dismissed',
    });
  }

  private usesDurableToolEvents(): boolean {
    return Boolean(this.toolStore.controlOutbox);
  }

  private async publishConfirmed(
    route: ExternalToolControlResult,
    sessionId: string,
    confirmationId: string,
  ): Promise<void> {
    await this.publish(route, sessionId, 'tool_confirmation_confirmed', {
      confirmation_id: confirmationId,
      tool: route.tool,
      tool_call_id: route.toolCallId,
    });
  }

  private async publish(
    route: ExternalToolControlResult,
    sessionId: string,
    eventType:
      | 'tool_confirmation_confirmed'
      | 'tool_confirmation_dismissed'
      | 'tool_execution_start'
      | 'tool_execution_end'
      | 'tool_undo_available'
      | 'tool_undo_completed',
    data: unknown,
  ): Promise<void> {
    const common = {
      session_id: sessionId,
      ...(route.taskId ? { task_id: route.taskId } : {}),
      ...(route.operationId ? { operation_id: route.operationId } : {}),
      event_type: eventType,
      data,
    } as const;
    const channels = [
      `session:${sessionId}` as const,
      ...(route.taskId ? ([`task:${route.taskId}`] as const) : []),
      ...(route.operationId
        ? ([`operation:${route.operationId}`] as const)
        : []),
    ];
    await Promise.allSettled(
      channels.map((channel) => this.events.publish({ channel, ...common })),
    );
  }

  private safeError(error: unknown): { code: string; message: string } {
    if (error instanceof NotFoundException) {
      return { code: 'AUTH_002', message: '资源不存在或无权操作' };
    }
    const message = error instanceof Error ? error.message : '';
    if (message === 'VALIDATION_001') {
      return { code: message, message: '工具控制请求字段无效' };
    }
    if (message === 'AUTH_001') {
      return { code: message, message: '未认证' };
    }
    if (message === 'TOOL_002' || message.includes('已过期')) {
      return { code: 'TOOL_002', message: '工具审批已过期' };
    }
    if (
      message === 'CONFIRMATION_002' ||
      message.includes('已处理') ||
      message.includes('已撤销') ||
      message.includes('正在撤销')
    ) {
      return { code: 'CONFIRMATION_002', message: '工具控制请求已失效' };
    }
    return { code: 'TOOL_001', message: '工具执行或恢复失败' };
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
