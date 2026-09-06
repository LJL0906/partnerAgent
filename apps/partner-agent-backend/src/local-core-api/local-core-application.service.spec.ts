import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { LocalCoreApplicationService } from './local-core-application.service.js';
import { MemoryChatTaskStore } from './memory-chat-task.store.js';
import { MemoryToolOperationStore } from '../tools/memory-tool-operation.store.js';
import { parseChatSessionSummary } from '@partner-agent/contracts';

const envelope = {
  operation_id: '11111111-1111-4111-8111-111111111111',
  request_fingerprint: 'fingerprint-1',
  client_source: 'web',
  payload: { text: '普通聊天', input_id: 'input-1' },
};

describe('LocalCoreApplicationService SubmitTextInput analysis handling', () => {
  it('keeps ordinary chat behavior when analysis is omitted or false', async () => {
    for (const requestAnalysis of [undefined, false]) {
      const fixture = createFixture();
      const payload = {
        ...envelope.payload,
        ...(requestAnalysis === undefined
          ? {}
          : { request_analysis: requestAnalysis }),
      };
      const result = await fixture.service.executeCommand('SubmitTextInput', {
        userId: 'trusted-owner',
        input: {},
        envelope: { ...envelope, payload },
      });

      expect(result).toMatchObject({ status: 'accepted' });
      expect(fixture.schedule).toHaveBeenCalledOnce();
    }
  });

  it('returns stable 501 before requiring text or creating chat state', async () => {
    const fixture = createFixture();
    const request = {
      userId: 'trusted-owner',
      input: {},
      envelope: {
        ...envelope,
        payload: {
          request_analysis: true,
          analysis_types: ['problem_analysis'],
        },
      },
    };

    const first = await capturedException(
      fixture.service.executeCommand('SubmitTextInput', request),
    );
    const replay = await capturedException(
      fixture.service.executeCommand('SubmitTextInput', request),
    );

    expect(first.getStatus()).toBe(501);
    expect(first.getResponse()).toEqual(replay.getResponse());
    expect(first.getResponse()).toEqual({
      code: 'NOT_IMPLEMENTED_001',
      message: 'input_analysis 尚未实现',
      details: {
        feature: 'input_analysis',
        requested_types: ['problem_analysis'],
        operation_id: envelope.operation_id,
      },
    });
    expect(fixture.schedule).not.toHaveBeenCalled();
  });

  it('returns 422 for false plus analysis_types without creating chat state', async () => {
    const fixture = createFixture();
    const error = await capturedException(
      fixture.service.executeCommand('SubmitTextInput', {
        userId: 'trusted-owner',
        input: {},
        envelope: {
          ...envelope,
          payload: {
            request_analysis: false,
            analysis_types: ['idea_organize'],
          },
        },
      }),
    );

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toMatchObject({ code: 'VALIDATION_001' });
    expect(fixture.schedule).not.toHaveBeenCalled();
  });

  it('accepts chat and structured preview modes and returns the resolved model', async () => {
    for (const mode of [
      { output_mode: 'chat' },
      { output_mode: 'structured_preview', preview_kind: 'action' },
    ]) {
      const fixture = createFixture();
      const submit = vi.spyOn(fixture.tasks, 'submitText');
      const result = await fixture.service.executeCommand('SubmitTextInput', {
        userId: 'trusted-owner',
        input: {},
        envelope: { ...envelope, payload: { ...envelope.payload, ...mode } },
      });

      expect(result).toMatchObject({
        operation_id: envelope.operation_id,
        status: 'accepted',
        data: {
          resolved_model: {
            model_config_id: 'deepseek:deepseek-chat',
            reasoning_level: 'off',
          },
        },
      });
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({
        outputMode: mode.output_mode,
        ...(mode.preview_kind ? { previewKind: mode.preview_kind } : {}),
      }));
      expect(fixture.submitConfirmationBatch).not.toHaveBeenCalled();
    }
  });

  it('rejects an invalid preview mode before creating chat state', async () => {
    const fixture = createFixture();
    const error = await capturedException(
      fixture.service.executeCommand('SubmitTextInput', {
        userId: 'trusted-owner',
        input: {},
        envelope: {
          ...envelope,
          payload: {
            ...envelope.payload,
            output_mode: 'structured_preview',
            preview_kind: 'goal',
          },
        },
      }),
    );

    expect(error.getStatus()).toBe(422);
    expect(fixture.schedule).not.toHaveBeenCalled();
  });

  it('returns a safe contract error when persisted response references disagree', async () => {
    const fixture = createFixture();
    vi.spyOn(fixture.tasks, 'submitText').mockResolvedValue({
      result: {
        operation_id: envelope.operation_id,
        status: 'accepted',
        resource_refs: [
          { kind: 'session', id: 'session-1' },
          { kind: 'chat_message', id: 'message-in-refs' },
        ],
        task_refs: [{ kind: 'chat_response', task_id: 'task-1' }],
        data: {
          session_id: 'session-1',
          message_ref: { kind: 'chat_message', id: 'different-message' },
          chat_task: { kind: 'chat_response', task_id: 'task-1' },
        },
      },
    });

    const error = await capturedException(
      fixture.service.executeCommand('SubmitTextInput', {
        userId: 'trusted-owner', input: {}, envelope,
      }),
    );

    expect(error.getStatus()).toBe(500);
    expect(error.getResponse()).toEqual({
      code: 'CONTRACT_001', message: '聊天受理结果引用不一致',
    });
    expect(JSON.stringify(error.getResponse())).not.toContain('different-message');
  });
});

describe('LocalCoreApplicationService idempotent session mutations', () => {
  it('does not let an old rename retry overwrite a newer title', async () => {
    const fixture = createFixture();
    await fixture.sessions.createIfAllowed('session-1', 'trusted-owner', 10);
    const rename = (operationId: string, fingerprint: string, title: string) =>
      fixture.service.executeCommand('RenameChatSession', {
        userId: 'trusted-owner', input: {},
        envelope: {
          operation_id: operationId, request_fingerprint: fingerprint,
          client_source: 'web', payload: { session_id: 'session-1', title },
        },
      });

    await rename('22222222-2222-4222-8222-222222222222', 'rename-a', '名称 A');
    await rename('33333333-3333-4333-8333-333333333333', 'rename-b', '名称 B');
    const replay = await rename(
      '22222222-2222-4222-8222-222222222222', 'rename-a', '名称 A',
    );

    expect(replay).toMatchObject({ title: '名称 A' });
    expect((await fixture.sessions.find('session-1', 'trusted-owner'))?.title).toBe('名称 B');
  });

  it('does not append a second model switch tip on retry', async () => {
    const fixture = createFixture();
    await fixture.sessions.createIfAllowed('session-1', 'trusted-owner', 10);
    const request = {
      userId: 'trusted-owner', input: {},
      envelope: {
        operation_id: '44444444-4444-4444-8444-444444444444',
        request_fingerprint: 'switch-model', client_source: 'web',
        payload: {
          session_id: 'session-1', previous_model_config_id: 'deepseek:old',
          model_config_id: 'deepseek:deepseek-chat', reasoning_level: 'off',
        },
      },
    };

    const first = await fixture.service.executeCommand('SetMessageModelSelection', request);
    const replay = await fixture.service.executeCommand('SetMessageModelSelection', request);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      session_id: 'session-1', item_id: expect.stringMatching(/^message:/),
      message_ref: { kind: 'chat_message', id: expect.any(String) },
      resolved_model: {
        model_config_id: 'deepseek:deepseek-chat', reasoning_level: 'off',
      },
    });
    expect((await fixture.sessions.find('session-1', 'trusted-owner'))?.messages).toHaveLength(1);
  });

  it('archives only once when the same operation is retried', async () => {
    const fixture = createFixture();
    await fixture.sessions.createIfAllowed('session-1', 'trusted-owner', 10);
    const archive = vi.spyOn(fixture.sessions, 'archive');
    const request = {
      userId: 'trusted-owner', input: {},
      envelope: {
        operation_id: '77777777-7777-4777-8777-777777777777',
        request_fingerprint: 'archive-once', client_source: 'web',
        payload: { session_id: 'session-1' },
      },
    };

    const first = await fixture.service.executeCommand('ArchiveChatSession', request);
    const replay = await fixture.service.executeCommand('ArchiveChatSession', request);

    expect(replay).toEqual(first);
    expect(archive).toHaveBeenCalledOnce();
  });
});

describe('LocalCoreApplicationService safe chat snapshot', () => {
  it('returns contract-valid recoverable items without raw tool data or metadata', async () => {
    const fixture = createFixture();
    const accepted = (await fixture.service.executeCommand('SubmitTextInput', {
      userId: 'trusted-owner', input: {}, envelope,
    })) as { data: { session_id: string; chat_task: { task_id: string } } };
    const { session_id: sessionId, chat_task: chatTask } = accepted.data;
    await fixture.toolOperations.saveConfirmation({
      id: '55555555-5555-4555-8555-555555555555',
      ownerId: 'trusted-owner', sessionId, taskId: chatTask.task_id,
      operationId: envelope.operation_id, toolCallId: 'tool-call-1',
      toolName: 'send_message', riskLevel: 'high', status: 'pending',
      arguments: { secret: 'must-not-leak' }, requestSummary: '发送周报',
      version: 2, createdAt: new Date('2026-09-06T08:00:00.000Z'),
      expiresAt: new Date('2099-09-06T08:10:00.000Z'),
    });

    const snapshot = await fixture.service.executeQuery('GetChatSession', {
      userId: 'trusted-owner', input: { session_id: sessionId },
    });

    expect(() => parseChatSessionSummary(snapshot)).not.toThrow();
    expect(snapshot).toMatchObject({
      tool_views: [expect.objectContaining({
        tool_call_id: 'tool-call-1', confirmation_id: '55555555-5555-4555-8555-555555555555',
        allowed_actions: ['confirm', 'dismiss'],
      })],
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'approval:55555555-5555-4555-8555-555555555555' }),
      ]),
    });
    expect(JSON.stringify(snapshot)).not.toContain('must-not-leak');
    expect(JSON.stringify(snapshot)).not.toContain('arguments');
    expect(JSON.stringify(snapshot)).not.toContain('contextMessages');
    expect(JSON.stringify(snapshot)).not.toContain('metadata');
  });
});

function createFixture() {
  const sessions = new MemorySessionStore();
  const tasks = new MemoryChatTaskStore(sessions);
  const toolOperations = new MemoryToolOperationStore();
  const schedule = vi.fn();
  const modelSelection = {
    resolve: vi.fn(() => ({
      provider: 'deepseek', modelId: 'deepseek-chat', reasoningLevel: 'off',
    })),
    list: vi.fn(),
  };
  const submitConfirmationBatch = vi.fn();
  return {
    sessions,
    tasks,
    toolOperations,
    schedule,
    submitConfirmationBatch,
    service: new LocalCoreApplicationService(
      sessions,
      { submit: submitConfirmationBatch } as never,
      tasks,
      { schedule } as never,
      {} as never,
      modelSelection as never,
      toolOperations,
    ),
  };
}

async function capturedException(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error('expected HttpException');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
}
