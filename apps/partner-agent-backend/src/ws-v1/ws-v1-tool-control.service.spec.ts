import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import type { ChatTaskScheduler } from '../local-core-api/chat-task-scheduler.js';
import type {
  ChatTaskStore,
  StoredChatTask,
} from '../local-core-api/chat-task.store.js';
import type { ExternalToolApprovalService } from '../tools/confirmation-center.service.js';
import type { WsV1Service } from './ws-v1.service.js';
import { WsV1ToolControlService } from './ws-v1-tool-control.service.js';

const task: StoredChatTask = {
  taskId: 'task-1',
  ownerId: 'owner',
  sessionId: 'session-1',
  operationId: 'operation-1',
  inputId: 'input-1',
  text: 'hello',
  state: 'waiting_tool_approval' as StoredChatTask['state'],
  originalRecordId: 'record-1',
  userMessageId: 'message-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  attemptCount: 1,
};

function harness() {
  const approval = {
    getPendingContext: vi.fn(async () => ({
      tool: 'external_write',
      toolCallId: 'call-1',
      taskId: task.taskId,
      operationId: task.operationId,
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    })),
    confirm: vi.fn(async (_id, _context, onConfirmed) => {
      onConfirmed?.({ tool: 'external_write', toolCallId: 'call-1' });
      return {
        tool: 'external_write',
        toolCallId: 'call-1',
        taskId: task.taskId,
        operationId: task.operationId,
        decision: 'confirmed',
        replayed: false,
        outcome: {
          result: {
            content: [{ type: 'text', text: 'ok' }],
            details: { ok: true },
          },
          executionId: 'execution-1',
          externalUndoExpiresAt: new Date('2026-09-04T12:00:00.000Z'),
        },
      };
    }),
    dismiss: vi.fn(async () => ({
      tool: 'external_write',
      toolCallId: 'call-1',
      taskId: task.taskId,
      operationId: task.operationId,
      decision: 'dismissed',
      replayed: false,
      outcome: {
        result: {
          content: [{ type: 'text' as const, text: 'dismissed' }],
          details: { status: 'user_dismissed' },
        },
      },
    })),
    recover: vi.fn(async () => ({
      tool: 'external_write',
      toolCallId: 'call-1',
      taskId: task.taskId,
      operationId: task.operationId,
      decision: 'confirmed',
      replayed: true,
      outcome: {
        result: {
          content: [{ type: 'text' as const, text: 'persisted' }],
          details: { persisted: true },
        },
      },
    })),
    undo: vi.fn(async () => ({
      tool: 'external_write',
      toolCallId: 'call-1',
      taskId: task.taskId,
      operationId: task.operationId,
    })),
  };
  const tasks = { getTask: vi.fn(async () => task) };
  const claimToolDecision = vi.fn(
    async (_task: StoredChatTask, confirmationId: string) => ({
      confirmationId,
      leaseToken: `lease:${confirmationId}`,
    }),
  );
  const resumeClaimedToolDecision = vi.fn();
  const failClaimedToolDecision = vi.fn(async () => undefined);
  const expireToolDecision = vi.fn(async () => true);
  const scheduler = {
    claimToolDecision,
    resumeClaimedToolDecision,
    failClaimedToolDecision,
    expireToolDecision,
  };
  const events = { publish: vi.fn() };
  const service = new WsV1ToolControlService(
    approval as unknown as ExternalToolApprovalService,
    tasks as unknown as ChatTaskStore,
    scheduler as unknown as ChatTaskScheduler,
    events as unknown as WsV1Service,
  );
  return {
    approval,
    tasks,
    claimToolDecision,
    resumeClaimedToolDecision,
    failClaimedToolDecision,
    expireToolDecision,
    events,
    service,
  };
}

function socket(ownerId = 'owner'): Socket {
  return { data: { userId: ownerId } } as unknown as Socket;
}

describe('WsV1ToolControlService', () => {
  it('confirms once, publishes lifecycle events and resumes the owning task', async () => {
    const fixture = harness();
    const ack = await fixture.service.confirm(socket(), {
      request_id: 'request-1',
      session_id: task.sessionId,
      confirmation_id: 'confirmation-1',
    });

    expect(ack).toEqual({
      request_id: 'request-1',
      action: 'confirm',
      status: 'completed',
    });
    expect(fixture.approval.confirm).toHaveBeenCalledOnce();
    expect(fixture.claimToolDecision).toHaveBeenCalledWith(
      task,
      'confirmation-1',
      'call-1',
      'external_write',
    );
    expect(fixture.resumeClaimedToolDecision).toHaveBeenCalledWith(
      task,
      {
        confirmationId: 'confirmation-1',
        leaseToken: 'lease:confirmation-1',
      },
      expect.objectContaining({
        toolCallId: 'call-1',
        toolName: 'external_write',
        isError: false,
        result: expect.objectContaining({ details: { ok: true } }),
      }),
    );
    const sessionEvents = fixture.events.publish.mock.calls
      .map(([event]) => event)
      .filter((event) => event.channel === `session:${task.sessionId}`);
    expect(sessionEvents.map((event) => event.event_type)).toEqual([
      'tool_confirmation_confirmed',
      'tool_execution_start',
      'tool_execution_end',
      'tool_undo_available',
    ]);
  });

  it('dismisses without execution and feeds an error tool result back to the task', async () => {
    const fixture = harness();
    const ack = await fixture.service.dismiss(socket(), {
      request_id: 'request-2',
      session_id: task.sessionId,
      confirmation_id: 'confirmation-1',
    });

    expect(ack.status).toBe('completed');
    expect(fixture.approval.confirm).not.toHaveBeenCalled();
    expect(fixture.approval.dismiss).toHaveBeenCalledOnce();
    expect(fixture.claimToolDecision).toHaveBeenCalledWith(
      task,
      'confirmation-1',
      'call-1',
      'external_write',
    );
    expect(fixture.resumeClaimedToolDecision).toHaveBeenCalledWith(
      task,
      {
        confirmationId: 'confirmation-1',
        leaseToken: 'lease:confirmation-1',
      },
      expect.objectContaining({
        toolCallId: 'call-1',
        toolName: 'external_write',
        isError: true,
      }),
    );
    expect(fixture.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: `session:${task.sessionId}`,
        event_type: 'tool_confirmation_dismissed',
      }),
    );
  });

  it('undoes only an owned receipt and publishes completion to all known routes', async () => {
    const fixture = harness();
    const ack = await fixture.service.undo(socket(), {
      request_id: 'request-3',
      session_id: task.sessionId,
      execution_id: 'execution-1',
    });

    expect(ack.status).toBe('completed');
    expect(fixture.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: `task:${task.taskId}`,
        event_type: 'tool_undo_completed',
        data: expect.objectContaining({ execution_id: 'execution-1' }),
      }),
    );
  });

  it('rejects malformed and cross-owner requests without executing a tool', async () => {
    const malformed = harness();
    await expect(
      malformed.service.confirm(socket(), {
        request_id: '',
        session_id: task.sessionId,
        confirmation_id: 'confirmation-1',
      }),
    ).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'VALIDATION_001' },
    });
    expect(malformed.approval.confirm).not.toHaveBeenCalled();

    const attacker = harness();
    attacker.approval.getPendingContext.mockRejectedValueOnce(
      new NotFoundException('确认请求不存在'),
    );
    await expect(
      attacker.service.confirm(socket('attacker'), {
        request_id: 'request-4',
        session_id: task.sessionId,
        confirmation_id: 'confirmation-1',
      }),
    ).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'AUTH_002' },
    });
    expect(attacker.approval.confirm).not.toHaveBeenCalled();
    expect(attacker.events.publish).not.toHaveBeenCalled();
  });

  it('does not execute when the owning task is no longer waiting', async () => {
    const fixture = harness();
    fixture.tasks.getTask.mockResolvedValueOnce({
      ...task,
      state: 'completed',
    });

    await expect(
      fixture.service.confirm(socket(), {
        request_id: 'request-5',
        session_id: task.sessionId,
        confirmation_id: 'confirmation-1',
      }),
    ).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'CONFIRMATION_002' },
    });
    expect(fixture.approval.confirm).not.toHaveBeenCalled();
  });

  it('does not execute when the task decision lease cannot be claimed', async () => {
    const fixture = harness();
    fixture.claimToolDecision.mockResolvedValueOnce(undefined);

    await expect(
      fixture.service.confirm(socket(), {
        request_id: 'request-6',
        session_id: task.sessionId,
        confirmation_id: 'confirmation-1',
      }),
    ).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'CONFIRMATION_002' },
    });
    expect(fixture.approval.confirm).not.toHaveBeenCalled();
  });

  it('fails the claimed task when approved execution throws', async () => {
    const fixture = harness();
    fixture.approval.confirm.mockImplementationOnce(
      async (_id, _context, onConfirmed) => {
        onConfirmed?.({ tool: 'external_write', toolCallId: 'call-1' });
        throw new Error('provider leaked secret: apiKey=hidden-value');
      },
    );

    await expect(
      fixture.service.confirm(socket(), {
        request_id: 'request-7',
        session_id: task.sessionId,
        confirmation_id: 'confirmation-1',
      }),
    ).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'TOOL_001', message: '工具执行或恢复失败' },
    });
    expect(fixture.failClaimedToolDecision).toHaveBeenCalledWith(
      task,
      {
        confirmationId: 'confirmation-1',
        leaseToken: 'lease:confirmation-1',
      },
      expect.any(Error),
    );
    expect(fixture.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: `session:${task.sessionId}`,
        event_type: 'tool_execution_end',
        data: expect.objectContaining({ success: false }),
      }),
    );
  });

  it('recovers a persisted successful result without executing the side effect again', async () => {
    const fixture = harness();
    fixture.approval.getPendingContext.mockResolvedValueOnce({
      tool: 'external_write',
      toolCallId: 'call-1',
      taskId: task.taskId,
      operationId: task.operationId,
      status: 'succeeded',
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      fixture.service.confirm(socket(), {
        request_id: 'request-recover-success',
        session_id: task.sessionId,
        confirmation_id: 'confirmation-1',
      }),
    ).resolves.toMatchObject({ status: 'completed' });

    expect(fixture.approval.confirm).not.toHaveBeenCalled();
    expect(fixture.approval.recover).toHaveBeenCalledOnce();
    expect(fixture.resumeClaimedToolDecision).toHaveBeenCalledWith(
      task,
      expect.objectContaining({ confirmationId: 'confirmation-1' }),
      expect.objectContaining({
        result: expect.objectContaining({ details: { persisted: true } }),
        isError: false,
      }),
    );
  });

  it('recovers a persisted dismissal deterministically even through confirm', async () => {
    const fixture = harness();
    fixture.approval.getPendingContext.mockResolvedValueOnce({
      tool: 'external_write',
      toolCallId: 'call-1',
      taskId: task.taskId,
      operationId: task.operationId,
      status: 'dismissed',
      expiresAt: new Date(),
    });
    fixture.approval.recover.mockResolvedValueOnce({
      tool: 'external_write',
      toolCallId: 'call-1',
      taskId: task.taskId,
      operationId: task.operationId,
      decision: 'dismissed',
      replayed: true,
      outcome: {
        result: {
          content: [{ type: 'text', text: '用户拒绝了这次外部工具调用。' }],
          details: { status: 'user_dismissed' },
        },
      },
    });

    await expect(
      fixture.service.confirm(socket(), {
        request_id: 'request-recover-dismissed',
        session_id: task.sessionId,
        confirmation_id: 'confirmation-1',
      }),
    ).resolves.toMatchObject({ status: 'completed' });
    expect(fixture.approval.confirm).not.toHaveBeenCalled();
    expect(fixture.resumeClaimedToolDecision).toHaveBeenCalledWith(
      task,
      expect.any(Object),
      expect.objectContaining({ isError: true }),
    );
  });

  it.each(['executing', 'failed', 'expired', 'indeterminate', 'undone'] as const)(
    'rejects %s without claiming or failing the current task',
    async (status) => {
      const fixture = harness();
      fixture.approval.getPendingContext.mockResolvedValueOnce({
        tool: 'external_write',
        toolCallId: 'call-1',
        taskId: task.taskId,
        operationId: task.operationId,
        status,
        expiresAt: new Date(),
      });

      await expect(
        fixture.service.confirm(socket(), {
          request_id: `request-${status}`,
          session_id: task.sessionId,
          confirmation_id: 'confirmation-1',
        }),
      ).resolves.toMatchObject({
        status: 'rejected',
        error: { code: 'CONFIRMATION_002' },
      });
      expect(fixture.claimToolDecision).not.toHaveBeenCalled();
      expect(fixture.failClaimedToolDecision).not.toHaveBeenCalled();
    },
  );

  it('rejects an old confirmation fence without touching the new wait', async () => {
    const fixture = harness();
    fixture.claimToolDecision.mockResolvedValueOnce(undefined);

    await expect(
      fixture.service.confirm(socket(), {
        request_id: 'request-old-confirmation',
        session_id: task.sessionId,
        confirmation_id: 'old-confirmation',
      }),
    ).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'CONFIRMATION_002' },
    });
    expect(fixture.claimToolDecision).toHaveBeenCalledWith(
      task,
      'old-confirmation',
      'call-1',
      'external_write',
    );
    expect(fixture.approval.confirm).not.toHaveBeenCalled();
    expect(fixture.approval.recover).not.toHaveBeenCalled();
    expect(fixture.failClaimedToolDecision).not.toHaveBeenCalled();
  });

  it('expires the matching waiting task before rejecting an overdue approval', async () => {
    const fixture = harness();
    fixture.approval.getPendingContext.mockResolvedValueOnce({
      tool: 'external_write',
      toolCallId: 'call-1',
      taskId: task.taskId,
      operationId: task.operationId,
      status: 'pending',
      expiresAt: new Date(Date.now() - 1),
    });

    await expect(
      fixture.service.confirm(socket(), {
        request_id: 'request-expired',
        session_id: task.sessionId,
        confirmation_id: 'confirmation-expired',
      }),
    ).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'TOOL_002' },
    });
    expect(fixture.expireToolDecision).toHaveBeenCalledWith(
      task,
      'confirmation-expired',
    );
    expect(fixture.claimToolDecision).not.toHaveBeenCalled();
    expect(fixture.approval.confirm).not.toHaveBeenCalled();
  });
});
