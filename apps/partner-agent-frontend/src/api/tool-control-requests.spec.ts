import type { ToolControlAckV1 } from '@partner-agent/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolControlRequests } from './tool-control-requests';

const ack: ToolControlAckV1 = { request_id: 'request-1', action: 'confirm', status: 'completed' };

describe('tool control request lifecycle', () => {
  let requests: ToolControlRequests;
  beforeEach(() => { vi.useFakeTimers(); requests = new ToolControlRequests(); });
  afterEach(() => { requests.rejectAll(new Error('closed')); vi.useRealTimers(); });

  it.each(['completed', 'rejected'] as const)('accepts matching %s ACK and clears its timer', async (status) => {
    const pending = requests.send('request-1', 'confirm', vi.fn());
    expect(vi.getTimerCount()).toBe(1);
    const response = { ...ack, status };
    requests.acknowledge(response);
    await expect(pending).resolves.toEqual(response);
    expect(vi.getTimerCount()).toBe(0);
    requests.acknowledge({ ...ack, action: 'undo' });
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(pending).resolves.toEqual(response);
  });

  it.each([
    { action: 'undo' },
    { action: 'invalid' },
    { action: undefined },
    { status: 'pending' },
    { status: undefined },
    { error: null },
    { error: 'private server exception' },
    { error: { code: 123, message: 'invalid' } },
    { error: { code: 'INVALID', message: {} } },
  ])('rejects correlated malformed ACK %j and ignores a subsequent valid ACK', async (invalid) => {
    const pending = requests.send('request-1', 'confirm', vi.fn());
    const rejected = expect(pending).rejects.toMatchObject({ name: 'ToolControlAckError' });
    requests.acknowledge({ ...ack, ...invalid });
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    requests.acknowledge(ack);
    await expect(pending).rejects.toMatchObject({ name: 'ToolControlAckError' });
  });

  it.each([undefined, null, [], 'ack', {}, { ...ack, request_id: 1 }, { ...ack, request_id: 'unknown' }])(
    'ignores uncorrelated ACK %j without settling another request', async (invalid) => {
      const settled = vi.fn();
      const pending = requests.send('request-1', 'confirm', vi.fn());
      void pending.then(settled);
      expect(() => requests.acknowledge(invalid)).not.toThrow();
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      requests.acknowledge(ack);
      await expect(pending).resolves.toEqual(ack);
      expect(settled).toHaveBeenCalledOnce();
    },
  );

  it('expires only at the deadline and ignores late ACKs without replaying emit', async () => {
    const emit = vi.fn();
    const pending = requests.send('request-1', 'confirm', emit);
    const result = pending.catch((error: unknown) => error);
    const settled = vi.fn();
    void result.then(settled);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ name: 'ToolControlTimeoutError' });
    expect(vi.getTimerCount()).toBe(0);
    requests.acknowledge(ack);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledOnce();
  });

  it('clears all pending requests on shutdown and ignores their late ACKs', async () => {
    const first = requests.send('request-1', 'confirm', vi.fn()).catch((error: unknown) => error);
    const second = requests.send('request-2', 'undo', vi.fn()).catch((error: unknown) => error);
    const closed = new Error('disconnected');
    requests.rejectAll(closed);
    expect(vi.getTimerCount()).toBe(0);
    requests.acknowledge(ack);
    expect(await first).toBe(closed);
    expect(await second).toBe(closed);
    requests.rejectAll(new Error('closed again'));
    expect(await first).toBe(closed);
  });

  it('converts synchronous emit failures to safe rejected promises and clears pending state', async () => {
    const pending = requests.send('request-1', 'confirm', () => { throw 'private transport exception'; });
    await expect(pending).rejects.toThrow('工具操作请求发送失败');
    expect(vi.getTimerCount()).toBe(0);
    requests.acknowledge(ack);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(pending).rejects.not.toThrow('private transport exception');
  });

  it('registers a request before emit so a synchronous ACK can settle it', async () => {
    const pending = requests.send('request-1', 'confirm', () => requests.acknowledge(ack));
    await expect(pending).resolves.toEqual(ack);
    expect(vi.getTimerCount()).toBe(0);
  });
});
