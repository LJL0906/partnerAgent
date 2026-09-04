import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { ChatRequest } from '@partner-agent/contracts';
import type { Socket } from 'socket.io';
import { AgentGateway } from './agent.gateway.js';
import { SessionManager } from './session-manager.service.js';
import { MemorySessionStore } from '../database/memory-session.store.js';

type Gate = {
  resolve: () => void;
};

function createSocket(id: string, userId: string) {
  return {
    id,
    data: { userId },
    emit: vi.fn(),
  } as unknown as Socket;
}

function createManager(limit = 100) {
  return new SessionManager(
    new ConfigService({ MAX_SESSIONS_PER_USER: String(limit) }),
    new MemorySessionStore(),
  );
}

describe('AgentGateway', () => {
  it('isolates concurrent sessions and cancels only the requested session', async () => {
    const gates = new Map<string, Gate>();
    const cancel = vi.fn();
    const piAgentService = {
      async *chat(sessionId: string) {
        yield { type: 'text_delta', data: sessionId, timestamp: Date.now() };
        await new Promise<void>((resolve) => gates.set(sessionId, { resolve }));
        yield { type: 'done', timestamp: Date.now() };
      },
      cancel,
    };
    const gateway = new AgentGateway(
      piAgentService as never,
      createManager(),
      {} as never,
    );
    const socketA = createSocket('socket-a', 'user-a');
    const socketB = createSocket('socket-b', 'user-b');

    const requestA = gateway.handleChat(socketA, {
      sessionId: 'session-a',
      message: 'A',
    });
    const requestB = gateway.handleChat(socketB, {
      sessionId: 'session-b',
      message: 'B',
    });
    await vi.waitFor(() => {
      expect(gates.size).toBe(2);
    });

    await gateway.handleCancel(socketA, { sessionId: 'session-a' });
    gates.get('session-a')?.resolve();
    gates.get('session-b')?.resolve();
    await Promise.all([requestA, requestB]);

    expect(cancel).toHaveBeenCalledWith('session-a', 'user-a');
    expect(cancel).not.toHaveBeenCalledWith('session-b', 'user-b');
    expect(socketA.emit).toHaveBeenCalledWith(
      'agent_event',
      expect.objectContaining({ type: 'cancelled', sessionId: 'session-a' }),
    );
    expect(socketB.emit).toHaveBeenCalledWith(
      'agent_event',
      expect.objectContaining({ type: 'done', sessionId: 'session-b' }),
    );
  });

  it('returns saved history when a session reconnects', async () => {
    const manager = createManager();
    await manager.getOrCreate('restored-session', 'user-a');
    await manager.saveMessage('restored-session', 'user-a', 'user', '记住我');
    const gateway = new AgentGateway(
      { cancel: vi.fn() } as never,
      manager,
      {} as never,
    );
    const socket = createSocket('new-socket', 'user-a');

    await gateway.handleResumeSession(socket, {
      sessionId: 'restored-session',
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'agent_event',
      expect.objectContaining({
        type: 'history',
        sessionId: 'restored-session',
        data: {
          messages: [
            expect.objectContaining({ role: 'user', content: '记住我' }),
          ],
        },
      }),
    );
  });

  it('uses the authenticated socket identity instead of a forged payload userId', async () => {
    const chat = vi.fn(async function* () {
      yield { type: 'done', timestamp: Date.now() };
    });
    const gateway = new AgentGateway(
      { chat, cancel: vi.fn() } as never,
      createManager(),
      {} as never,
    );
    const socket = createSocket('socket-x', 'trusted-user');

    await gateway.handleChat(socket, {
      sessionId: 'trusted-session',
      message: '你好',
      userId: 'forged-user',
    } as unknown as ChatRequest);

    expect(chat).toHaveBeenCalledWith(
      'trusted-session',
      '你好',
      'trusted-user',
    );
  });

  it('does not expose or cancel a session owned by another user', async () => {
    const manager = createManager();
    await manager.getOrCreate('private-session', 'user-x');
    await manager.saveMessage(
      'private-session',
      'user-x',
      'user',
      '私密消息',
    );
    const cancel = vi.fn();
    const chat = vi.fn(async function* () {
      yield { type: 'done', timestamp: Date.now() };
    });
    const gateway = new AgentGateway(
      { chat, cancel } as never,
      manager,
      {} as never,
    );
    const attacker = createSocket('socket-y', 'user-y');

    await gateway.handleResumeSession(attacker, {
      sessionId: 'private-session',
    });
    await gateway.handleCancel(attacker, { sessionId: 'private-session' });
    await gateway.handleChat(attacker, {
      sessionId: 'private-session',
      message: '窃取历史',
    });

    expect(chat).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(attacker.emit).not.toHaveBeenCalledWith(
      'agent_event',
      expect.objectContaining({ type: 'history' }),
    );
    expect(attacker.emit).toHaveBeenCalledWith(
      'agent_event',
      expect.objectContaining({
        type: 'error',
        data: { message: '会话不存在' },
      }),
    );
  });

  it('does not expose unexpected internal error details', async () => {
    const chat = vi.fn(async function* () {
      yield* [];
      throw new Error('provider secret-key-123 failed at C:\\private\\file');
    });
    const gateway = new AgentGateway(
      { chat, cancel: vi.fn() } as never,
      createManager(),
      {} as never,
    );
    const socket = createSocket('socket-safe-error', 'user-safe');

    await gateway.handleChat(socket, {
      sessionId: 'safe-error-session',
      message: '触发失败',
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'agent_event',
      expect.objectContaining({
        type: 'error',
        data: { message: '请求处理失败' },
      }),
    );
  });
});
