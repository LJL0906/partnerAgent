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

  it('rejects duplicate tools and tools whose effect boundary is inconsistent', () => {
    const { registry } = createHarness();
    const tool = {
      name: 'dangerous_write',
      label: '危险写入',
      description: '测试写入',
      parameters: Type.Object({}),
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

    const publicTool = registry.toPublicTool(
      registry.get('get_current_time'),
      vi.fn(),
    );
    expect(Object.keys(publicTool).sort()).toEqual(
      ['description', 'execute', 'label', 'name', 'parameters'].sort(),
    );
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

    const audits = await store.listAudits();
    expect(audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining(['staged', 'confirmed', 'executed']),
    );
    expect(JSON.stringify(audits)).not.toContain('request-secret');
    expect(JSON.stringify(audits)).not.toContain('result-secret');

    await confirmation.undo(outcome!.outcome.executionId!, context);
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
    const context = { ownerId: 'user-a', sessionId: 'session-a' };
    const pending = await execution
      .createAgentTools(context)
      .find((tool) => tool.name === 'dismissed_write')!
      .execute('call-2', {});
    const { confirmationId } = pending.details as { confirmationId: string };

    await confirmation.dismiss(confirmationId, context);

    expect(handler).not.toHaveBeenCalled();
    expect((await store.listAudits()).map((audit) => audit.action)).toEqual([
      'staged',
      'dismissed',
    ]);
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
