import type { ToolControlAckV1 } from '@partner-agent/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createToolActionState, toolActionKey } from './chat-tool-action-state';
import { ToolControlRequests } from '@/api/tool-control-requests';

const ack: ToolControlAckV1 = { request_id: 'r', action: 'confirm', status: 'completed' };
const controls = () => ({
  confirmTool: vi.fn(async () => ack),
  dismissTool: vi.fn(async () => ({ ...ack, action: 'dismiss' as const })),
  undoTool: vi.fn(async () => ({ ...ack, action: 'undo' as const })),
});

describe('tool action feedback separate from server item state', () => {
  it('blocks repeated and conflicting actions while one confirmation is pending', async () => {
    const transport = controls();
    let resolve!: (value: ToolControlAckV1) => void;
    transport.confirmTool.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const state = createToolActionState(transport);
    const submitted = state.run('confirm', 'c1');
    expect(state.getSnapshot()[toolActionKey('confirm', 'c1')].phase).toBe('pending');
    await state.run('confirm', 'c1');
    await state.run('dismiss', 'c1');
    expect(transport.confirmTool).toHaveBeenCalledTimes(1);
    expect(transport.dismissTool).not.toHaveBeenCalled();
    resolve(ack);
    await submitted;
    expect(state.getSnapshot()[toolActionKey('confirm', 'c1')].phase).toBe('acknowledged');
    expect(state.getSnapshot()[toolActionKey('confirm', 'c1')].message).toContain('等待');
    await state.run('dismiss', 'c1');
    expect(transport.dismissTool).not.toHaveBeenCalled();
  });

  it('shows server rejection rather than pretending the tool succeeded', async () => {
    const transport = controls();
    transport.confirmTool.mockResolvedValueOnce({ ...ack, status: 'rejected', error: { code: 'AUTH_002', message: 'secret=private' } });
    const state = createToolActionState(transport);
    await state.run('confirm', 'c1');
    expect(state.getSnapshot()[toolActionKey('confirm', 'c1')].phase).toBe('rejected');
    expect(JSON.stringify(state.getSnapshot())).not.toContain('secret=private');
  });

  it('catches transport failure without replaying uncertain side effects', async () => {
    const transport = controls();
    transport.undoTool.mockRejectedValueOnce(new Error('Bearer private-token'));
    const state = createToolActionState(transport);
    await expect(state.run('undo', 'x1')).resolves.toBeUndefined();
    expect(state.getSnapshot()[toolActionKey('undo', 'x1')].phase).toBe('unknown');
    await state.run('undo', 'x1');
    expect(transport.undoTool).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(state.getSnapshot())).not.toContain('private-token');
  });

  it('rejects mismatched actions defensively and does not confirm local business state', async () => {
    const transport = controls();
    transport.confirmTool.mockResolvedValueOnce({ ...ack, action: 'undo' });
    const state = createToolActionState(transport);
    await state.run('confirm', 'c1');
    expect(state.getSnapshot()[toolActionKey('confirm', 'c1')].phase).toBe('unknown');
  });

  it('does not carry old request results into a newly selected session', async () => {
    const transport = controls();
    let resolve!: (value: ToolControlAckV1) => void;
    transport.confirmTool.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const oldState = createToolActionState(transport);
    const submitted = oldState.run('confirm', 'c1');
    const newState = createToolActionState(controls());
    resolve(ack);
    await submitted;
    expect(newState.getSnapshot()).toEqual({});
  });

  it('turns the actual ACK timeout into visible uncertainty without replaying the request', async () => {
    vi.useFakeTimers();
    const requests = new ToolControlRequests();
    try {
      const transport = controls();
      const emit = vi.fn();
      transport.confirmTool.mockImplementation(() => requests.send('request-1', 'confirm', emit));
      const state = createToolActionState(transport);
      const pending = state.run('confirm', 'c1');
      await vi.advanceTimersByTimeAsync(15_000);
      await pending;
      expect(state.getSnapshot()[toolActionKey('confirm', 'c1')].phase).toBe('unknown');
      requests.acknowledge({ ...ack, request_id: 'request-1' });
      await state.run('confirm', 'c1');
      expect(emit).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      requests.rejectAll(new Error('cleanup'));
      vi.useRealTimers();
    }
  });

  it('notifies subscribers and supports cleanup with distinct execution and confirmation keys', async () => {
    const state = createToolActionState(controls());
    const listener = vi.fn();
    const stop = state.subscribe(listener);
    await state.run('confirm', 'same');
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    await state.run('undo', 'same');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(Object.keys(state.getSnapshot())).toHaveLength(2);
  });
});
