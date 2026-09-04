import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { LocalCoreApplicationService } from './local-core-application.service.js';
import { MemoryChatTaskStore } from './memory-chat-task.store.js';

const envelope = {
  operation_id: 'operation-1',
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
});

function createFixture() {
  const sessions = new MemorySessionStore();
  const tasks = new MemoryChatTaskStore(sessions);
  const schedule = vi.fn();
  return {
    schedule,
    service: new LocalCoreApplicationService(
      sessions,
      {} as never,
      tasks,
      { schedule } as never,
      {} as never,
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
