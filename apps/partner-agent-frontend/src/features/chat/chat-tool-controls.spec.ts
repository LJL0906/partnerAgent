import { describe, expect, it, vi } from 'vitest';

import { createChatToolControls } from './chat-tool-controls';

describe('chat tool controls', () => {
  it('injects the current session into confirm and dismiss requests', async () => {
    const transport = {
      confirmTool: vi.fn(async () => ({ request_id: 'r1', action: 'confirm' as const, status: 'completed' as const })),
      dismissTool: vi.fn(async () => ({ request_id: 'r2', action: 'dismiss' as const, status: 'completed' as const })),
      undoTool: vi.fn(),
    };
    const controls = createChatToolControls(() => 'session-1', () => transport);
    await controls.confirmTool('confirmation-1');
    await controls.dismissTool('confirmation-2');
    expect(transport.confirmTool).toHaveBeenCalledWith({ session_id: 'session-1', confirmation_id: 'confirmation-1' });
    expect(transport.dismissTool).toHaveBeenCalledWith({ session_id: 'session-1', confirmation_id: 'confirmation-2' });
  });

  it('routes undo to execution_id and rejects missing transport or identifiers', async () => {
    const transport = {
      confirmTool: vi.fn(), dismissTool: vi.fn(),
      undoTool: vi.fn(async () => ({ request_id: 'r3', action: 'undo' as const, status: 'completed' as const })),
    };
    const controls = createChatToolControls(() => 'session-1', () => transport);
    await controls.undoTool('execution-1');
    expect(transport.undoTool).toHaveBeenCalledWith({ session_id: 'session-1', execution_id: 'execution-1' });
    await expect(controls.confirmTool('')).rejects.toThrow('不能为空');
    await expect(createChatToolControls(() => 'session-1', () => undefined).confirmTool('confirmation-1')).rejects.toThrow('实时连接');
  });

  it('does not guess a session when no session exists', async () => {
    const transport = { confirmTool: vi.fn(), dismissTool: vi.fn(), undoTool: vi.fn() };
    await expect(createChatToolControls(() => undefined, () => transport).undoTool('execution-1')).rejects.toThrow('会话尚未就绪');
    expect(transport.undoTool).not.toHaveBeenCalled();
  });
});
