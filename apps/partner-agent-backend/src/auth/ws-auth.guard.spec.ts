import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WsAuthGuard } from './ws-auth.guard.js';

function createContext(client: object): ExecutionContext {
  return {
    switchToWs: () => ({ getClient: () => client }),
  } as unknown as ExecutionContext;
}

describe('WsAuthGuard', () => {
  it('stores the authenticated subject on the socket', async () => {
    const verifyToken = vi.fn().mockResolvedValue('user-x');
    const client = {
      data: {},
      handshake: { auth: { token: 'valid-token' }, headers: {} },
    };
    const guard = new WsAuthGuard({ verifyToken } as never);

    await expect(guard.canActivate(createContext(client))).resolves.toBe(true);
    expect(verifyToken).toHaveBeenCalledWith('valid-token');
    expect(client.data).toEqual({ userId: 'user-x' });
  });

  it('rejects a socket without a valid token', async () => {
    const guard = new WsAuthGuard({
      verifyToken: vi.fn().mockRejectedValue(new Error('invalid')),
    } as never);
    const client = { data: {}, handshake: { auth: {}, headers: {} } };

    await expect(guard.canActivate(createContext(client))).rejects.toThrow(
      '未认证',
    );
  });

  it('revalidates the token for every event instead of trusting cached identity', async () => {
    const verifyToken = vi.fn().mockRejectedValue(new Error('expired'));
    const client = {
      data: { userId: 'previously-authenticated' },
      handshake: { auth: { token: 'expired-token' }, headers: {} },
    };
    const guard = new WsAuthGuard({ verifyToken } as never);

    await expect(guard.canActivate(createContext(client))).rejects.toThrow(
      '未认证',
    );
    expect(verifyToken).toHaveBeenCalledWith('expired-token');
  });
});
