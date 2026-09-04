import { ConfigService } from '@nestjs/config';
import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';
import { ExternalToolApprovalService } from './confirmation-center.service.js';
import { MemoryToolOperationStore } from './memory-tool-operation.store.js';
import { RedactionService } from './redaction.service.js';
import { ToolExecutionService } from './tool-execution.service.js';
import { ToolRegistryService } from './tool-registry.service.js';

function createHarness() {
  const registry = new ToolRegistryService();
  const store = new MemoryToolOperationStore();
  const execution = new ToolExecutionService(
    registry,
    store,
    new RedactionService(),
    new ConfigService(),
  );
  const confirmation = new ExternalToolApprovalService(
    registry,
    execution,
    store,
  );
  return { registry, store, execution, confirmation };
}

describe('tool registry and confirmation center', () => {
  it('redacts secrets and internal paths embedded in string values', () => {
    const redaction = new RedactionService();
    const summary = redaction.summarize({
      message:
        'Authorization failed: Bearer abc.def.ghi apiKey=plain-secret at C:\\workspace\\private\\handler.ts and /home/user/private.txt',
    });

    expect(summary).not.toContain('abc.def.ghi');
    expect(summary).not.toContain('plain-secret');
    expect(summary).not.toContain('C:\\workspace');
    expect(summary).not.toContain('/home/user');
    expect(summary).toContain('[已脱敏]');
  });

  it('rejects duplicate tools and preserves execution mode on the public wrapper', async () => {
    const { registry } = createHarness();
    const tool = {
      name: 'dangerous_write',
      label: '危险写入',
      description: '测试写入',
      parameters: Type.Object({}),
      executionMode: 'sequential' as const,
      execute: vi.fn(),
    };

    expect(() =>
      registry.register({
        tool,
        riskLevel: 'high',
        effect: 'external_side_effect',
        capabilities: ['external_api'],
        requiredPermissions: [],
        requiresToolApproval: false,
      }),
    ).toThrow('外部副作用工具必须进入 Tool Approval');
    expect(() =>
      registry.register({
        tool: registry.get('get_current_time').tool,
        riskLevel: 'read_only',
        effect: 'read_only',
        capabilities: ['read_runtime'],
        requiredPermissions: [],
        requiresToolApproval: false,
      }),
    ).toThrow('工具重复注册');

    const wrappedExecute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      details: { ok: true },
    }));
    const publicTool = registry.toPublicTool(
      {
        ...registry.get('get_current_time'),
        tool,
      },
      wrappedExecute,
    );
    expect(Object.keys(publicTool).sort()).toEqual(
      [
        'description',
        'execute',
        'executionMode',
        'label',
        'name',
        'parameters',
      ].sort(),
    );
    expect(publicTool.executionMode).toBe('sequential');
    await expect(publicTool.execute('call-public', {})).resolves.toMatchObject({
      details: { ok: true },
    });
    expect(wrappedExecute).toHaveBeenCalledOnce();
  });

  it('stages high-risk work, executes once after confirmation, redacts and undoes', async () => {
    const { registry, store, execution, confirmation } = createHarness();
    const handler = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'raw result' }],
      details: { changed: true, apiKey: 'result-secret' },
    }));
    const undo = vi.fn(async () => undefined);
    registry.register({
      tool: {
        name: 'dangerous_write',
        label: '危险写入',
        description: '测试写入',
        parameters: Type.Object({ apiKey: Type.String() }),
        execute: handler,
      },
      riskLevel: 'high',
      effect: 'external_side_effect',
      capabilities: ['external_api'],
      requiredPermissions: ['external.write'],
      requiresToolApproval: true,
      createUndoPayload: () => ({ resourceId: 'resource-1' }),
      undo,
    });

    const context = {
      ownerId: 'user-a',
      sessionId: 'session-a',
      taskId: 'task-a',
      operationId: 'operation-a',
      permissions: ['external.write'],
    };
    const agentTool = execution
      .createAgentTools(context)
      .find((tool) => tool.name === 'dangerous_write')!;
    const pending = await agentTool.execute('call-1', {
      apiKey: 'request-secret',
    });

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(pending)).not.toContain('request-secret');
    const details = pending.details as { confirmationId: string };
    await expect(
      store.findConfirmation(details.confirmationId),
    ).resolves.toMatchObject({
      ownerId: 'user-a',
      sessionId: 'session-a',
      taskId: 'task-a',
      operationId: 'operation-a',
      toolCallId: 'call-1',
    });
    const [first, second] = await Promise.allSettled([
      confirmation.confirm(details.confirmationId, context),
      confirmation.confirm(details.confirmationId, context),
    ]);
    const fulfilled = [first, second].find(
      (result) => result.status === 'fulfilled',
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fulfilled?.status).toBe('fulfilled');
    const outcome =
      fulfilled?.status === 'fulfilled' ? fulfilled.value : undefined;
    expect(JSON.stringify(outcome?.outcome.result)).not.toContain(
      'result-secret',
    );
    expect(outcome).toMatchObject({
      tool: 'dangerous_write',
      toolCallId: 'call-1',
      taskId: 'task-a',
      operationId: 'operation-a',
    });
    await expect(
      store.findConfirmation(details.confirmationId),
    ).resolves.toMatchObject({
      status: 'succeeded',
      result: {
        details: { changed: true, apiKey: '[已脱敏]' },
      },
    });
    await expect(confirmation.listRecoverableDecisions()).resolves.toEqual([
      expect.objectContaining({
        confirmationId: details.confirmationId,
        ownerId: 'user-a',
        sessionId: 'session-a',
        taskId: 'task-a',
        operationId: 'operation-a',
        decision: 'confirmed',
        outcome: {
          result: expect.objectContaining({
            details: { changed: true, apiKey: '[已脱敏]' },
          }),
          executionId: outcome!.outcome.executionId,
          externalUndoExpiresAt: expect.any(Date),
        },
      }),
    ]);
    await expect(confirmation.listRecoverableDecisions()).resolves.toEqual([]);
    await expect(
      confirmation.confirm(details.confirmationId, context),
    ).resolves.toMatchObject({
      decision: 'confirmed',
      replayed: true,
      outcome: {
        result: { details: { changed: true, apiKey: '[已脱敏]' } },
        executionId: outcome!.outcome.executionId,
      },
    });
    expect(handler).toHaveBeenCalledTimes(1);

    const audits = await store.listAudits();
    expect(audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining(['staged', 'confirmed', 'executed']),
    );
    expect(JSON.stringify(audits)).not.toContain('request-secret');
    expect(JSON.stringify(audits)).not.toContain('result-secret');

    await expect(
      confirmation.undo(outcome!.outcome.executionId!, context),
    ).resolves.toMatchObject({
      tool: 'dangerous_write',
      toolCallId: 'call-1',
      taskId: 'task-a',
      operationId: 'operation-a',
    });
    expect(undo).toHaveBeenCalledTimes(1);
    await expect(
      confirmation.undo(outcome!.outcome.executionId!, context),
    ).rejects.toThrow('执行记录已撤销或正在撤销');
  });

  it('records dismissal without executing the handler', async () => {
    const { registry, store, execution, confirmation } = createHarness();
    const handler = vi.fn();
    registry.register({
      tool: {
        name: 'dismissed_write',
        label: '拒绝写入',
        description: '测试拒绝',
        parameters: Type.Object({}),
        execute: handler,
      },
      riskLevel: 'high',
      effect: 'external_side_effect',
      capabilities: ['external_api'],
      requiredPermissions: [],
      requiresToolApproval: true,
    });
    const context = {
      ownerId: 'user-a',
      sessionId: 'session-a',
      taskId: 'task-dismissed',
      operationId: 'operation-dismissed',
    };
    const pending = await execution
      .createAgentTools(context)
      .find((tool) => tool.name === 'dismissed_write')!
      .execute('call-2', {});
    const { confirmationId } = pending.details as { confirmationId: string };

    const dismissed = await confirmation.dismiss(confirmationId, context);

    await expect(
      confirmation.dismiss(confirmationId, context),
    ).resolves.toEqual({ ...dismissed, replayed: true });

    expect(handler).not.toHaveBeenCalled();
    expect((await store.listAudits()).map((audit) => audit.action)).toEqual([
      'staged',
      'dismissed',
    ]);
    await expect(store.findConfirmation(confirmationId)).resolves.toMatchObject(
      {
        status: 'dismissed',
        result: {
          content: [{ type: 'text', text: '用户拒绝了这次外部工具调用。' }],
          details: { status: 'user_dismissed' },
        },
      },
    );
  });

  it('expires stale dismissals instead of treating them as a user decision', async () => {
    const { registry, store, execution, confirmation } = createHarness();
    const handler = vi.fn();
    registry.register({
      tool: {
        name: 'expired_write',
        label: '过期写入',
        description: '测试过期拒绝',
        parameters: Type.Object({}),
        execute: handler,
      },
      riskLevel: 'high',
      effect: 'external_side_effect',
      capabilities: ['external_api'],
      requiredPermissions: [],
      requiresToolApproval: true,
    });
    const context = {
      ownerId: 'user-a',
      sessionId: 'session-a',
      taskId: 'task-expired',
      operationId: 'operation-expired',
    };
    const pending = await execution
      .createAgentTools(context)
      .find((tool) => tool.name === 'expired_write')!
      .execute('expired-call', {});
    const { confirmationId } = pending.details as { confirmationId: string };
    await store.updateConfirmation(confirmationId, {
      expiresAt: new Date(Date.now() - 1),
    });

    await expect(confirmation.dismiss(confirmationId, context)).rejects.toThrow(
      'TOOL_002',
    );
    expect(handler).not.toHaveBeenCalled();
    await expect(store.findConfirmation(confirmationId)).resolves.toMatchObject(
      {
        status: 'pending',
      },
    );
    await expect(
      confirmation.expirePendingConfirmations(new Date()),
    ).resolves.toEqual([
      expect.objectContaining({
        confirmationId,
        taskId: 'task-expired',
        operationId: 'operation-expired',
      }),
    ]);
    await expect(store.findConfirmation(confirmationId)).resolves.toMatchObject(
      { status: 'expired' },
    );
    expect((await store.listAudits()).map((audit) => audit.action)).toEqual([
      'staged',
      'expired',
    ]);
  });

  it('reconciles stale executing and terminal confirmations without replaying side effects', async () => {
    const { registry, store, confirmation } = createHarness();
    const handler = vi.fn();
    registry.register({
      tool: {
        name: 'reconcile_write',
        label: '对账写入',
        description: '测试崩溃后对账',
        parameters: Type.Object({}),
        execute: handler,
      },
      riskLevel: 'high',
      effect: 'external_side_effect',
      capabilities: ['external_api'],
      requiredPermissions: [],
      requiresToolApproval: true,
    });
    const now = new Date();
    const base = {
      ownerId: 'user-a',
      sessionId: 'session-a',
      operationId: 'operation-reconcile',
      toolName: 'reconcile_write',
      riskLevel: 'high' as const,
      arguments: {},
      requestSummary: '{}',
      createdAt: new Date(now.getTime() - 120_000),
    };
    await Promise.all([
      store.saveConfirmation({
        ...base,
        id: 'stale-executing',
        taskId: 'task-executing',
        toolCallId: 'call-executing',
        status: 'executing',
        expiresAt: new Date(now.getTime() - 60_000),
      }),
      store.saveConfirmation({
        ...base,
        id: 'future-executing',
        taskId: 'task-future',
        toolCallId: 'call-future',
        status: 'executing',
        expiresAt: new Date(now.getTime() + 60_000),
      }),
      store.saveConfirmation({
        ...base,
        id: 'failed-confirmation',
        taskId: 'task-failed',
        toolCallId: 'call-failed',
        status: 'failed',
        expiresAt: new Date(now.getTime() + 60_000),
      }),
      store.saveConfirmation({
        ...base,
        id: 'expired-confirmation',
        taskId: 'task-expired',
        toolCallId: 'call-expired',
        status: 'expired',
        expiresAt: new Date(now.getTime() - 60_000),
      }),
      store.saveConfirmation({
        ...base,
        id: 'pending-confirmation',
        taskId: 'task-pending',
        toolCallId: 'call-pending',
        status: 'pending',
        expiresAt: new Date(now.getTime() - 60_000),
      }),
    ]);

    const reconciled = await confirmation.reconcileStaleConfirmations(now, 10);

    expect(reconciled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          confirmationId: 'stale-executing',
          status: 'indeterminate',
        }),
        expect.objectContaining({
          confirmationId: 'failed-confirmation',
          status: 'failed',
        }),
        expect.objectContaining({
          confirmationId: 'expired-confirmation',
          status: 'expired',
        }),
      ]),
    );
    expect(reconciled).toHaveLength(3);
    await expect(
      store.findConfirmation('stale-executing'),
    ).resolves.toMatchObject({ status: 'indeterminate' });
    await expect(
      store.findConfirmation('future-executing'),
    ).resolves.toMatchObject({ status: 'executing' });
    await expect(
      store.findConfirmation('pending-confirmation'),
    ).resolves.toMatchObject({ status: 'pending' });
    expect((await store.listAudits()).map((audit) => audit.action)).toEqual([
      'indeterminate',
    ]);
    await expect(
      confirmation.reconcileStaleConfirmations(now, 10),
    ).resolves.toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('never executes a formal business handler and only stages Candidate/Batch data', async () => {
    const { registry, store, execution } = createHarness();
    const forbiddenExecute = vi.fn();
    const createCandidateBatch = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'internal result' }],
      details: {
        status: 'candidate_staged',
        candidate_ids: ['candidate-1'],
        batch_id: 'batch-1',
        secret: 'must-not-leak',
      },
    }));
    registry.register({
      tool: {
        name: 'create_goal_candidate',
        label: '生成目标候选',
        description: '只生成候选，不写正式目标',
        parameters: Type.Object({ title: Type.String() }),
        execute: forbiddenExecute,
      },
      riskLevel: 'medium',
      effect: 'formal_business_data',
      capabilities: ['generate_candidate_batch'],
      requiredPermissions: ['candidate.create'],
      requiresToolApproval: false,
      createCandidateBatch,
    });
    const tool = execution
      .createAgentTools({
        ownerId: 'user-a',
        sessionId: 'session-a',
        permissions: ['candidate.create'],
      })
      .find((entry) => entry.name === 'create_goal_candidate')!;

    const result = await tool.execute('formal-call', { title: '新目标' });

    expect(forbiddenExecute).not.toHaveBeenCalled();
    expect(createCandidateBatch).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      details: {
        status: 'candidate_staged',
        candidate_ids: ['candidate-1'],
        batch_id: 'batch-1',
        secret: '[已脱敏]',
      },
    });
    expect((await store.listAudits()).map((audit) => audit.action)).toContain(
      'candidate_staged',
    );
  });

  it('does not expose tools whose permissions are missing', async () => {
    const { registry, store, execution } = createHarness();
    const handler = vi.fn();
    registry.register({
      tool: {
        name: 'external_write',
        label: '外部写入',
        description: '写入外部系统',
        parameters: Type.Object({}),
        execute: handler,
      },
      riskLevel: 'medium',
      effect: 'external_side_effect',
      capabilities: ['external_api'],
      requiredPermissions: ['external.write'],
      requiresToolApproval: true,
    });
    const exposed = execution.createAgentTools({
      ownerId: 'user-a',
      sessionId: 'session-a',
    });

    expect(exposed.map((tool) => tool.name)).not.toContain('external_write');
    expect(handler).not.toHaveBeenCalled();
    expect(await store.listAudits()).toEqual([]);
  });
});
