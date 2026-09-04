import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { AgentGateway } from './agent.gateway.js';
import { SessionManager } from './session-manager.service.js';

type Gate = {
  resolve: () => void;
};

function createSocket(id: string) {
  return {
    id,
    emit: vi.fn(),
  } as unknown as Socket;
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
      new SessionManager(),
    );
    const socketA = createSocket('socket-a');
    const socketB = createSocket('socket-b');

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

    gateway.handleCancel(socketA, { sessionId: 'session-a' });
    gates.get('session-a')?.resolve();
    gates.get('session-b')?.resolve();
    await Promise.all([requestA, requestB]);

    expect(cancel).toHaveBeenCalledWith('session-a');
    expect(cancel).not.toHaveBeenCalledWith('session-b');
    expect(socketA.emit).toHaveBeenCalledWith(
      'agent_event',
      expect.objectContaining({ type: 'cancelled', sessionId: 'session-a' }),
    );
    expect(socketB.emit).toHaveBeenCalledWith(
      'agent_event',
      expect.objectContaining({ type: 'done', sessionId: 'session-b' }),
    );
  });

  it('returns saved history when a session reconnects', () => {
    const manager = new SessionManager();
    manager.saveMessage('restored-session', 'user', '记住我');
    const gateway = new AgentGateway({ cancel: vi.fn() } as never, manager);
    const socket = createSocket('new-socket');

    gateway.handleResumeSession(socket, { sessionId: 'restored-session' });

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
});
