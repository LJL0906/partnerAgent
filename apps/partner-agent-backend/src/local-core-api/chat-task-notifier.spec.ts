import { EventEmitter } from 'node:events';
import type { Notification } from 'pg';
import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_TASK_NOTIFICATION_CHANNEL,
  PostgresChatTaskNotifier,
  type ChatTaskListenerClient,
} from './chat-task-notifier.js';

class FakeListenerClient
  extends EventEmitter
  implements ChatTaskListenerClient
{
  readonly connect = vi.fn(async () => undefined);
  readonly query = vi.fn(async (_query: string) => []);
  readonly end = vi.fn(async () => undefined);

  send(taskId: string): void {
    this.emit('notification', {
      channel: CHAT_TASK_NOTIFICATION_CHANNEL,
      payload: taskId,
      processId: 1,
    } satisfies Notification);
  }
}

const createDataSource = (query = vi.fn(async () => [])) =>
  ({ isInitialized: true, query }) as unknown as DataSource;

describe('PostgresChatTaskNotifier', () => {
  it('publishes only the task id through pg_notify', async () => {
    const query = vi.fn(async () => []);
    const notifier = new PostgresChatTaskNotifier(
      createDataSource(query),
      'postgres://unused',
    );

    await notifier.notify('task-1');

    expect(query).toHaveBeenCalledWith('select pg_notify($1, $2)', [
      CHAT_TASK_NOTIFICATION_CHANNEL,
      'task-1',
    ]);
  });

  it('swallows notification failures so committed tasks remain durable', async () => {
    const notifier = new PostgresChatTaskNotifier(
      createDataSource(vi.fn().mockRejectedValue(new Error('offline'))),
      'postgres://unused',
    );

    await expect(notifier.notify('task-1')).resolves.toBeUndefined();
  });

  it('listens for wakeups and reconnects after the connection drops', async () => {
    const first = new FakeListenerClient();
    const second = new FakeListenerClient();
    const clients = [first, second];
    const received: string[] = [];
    const notifier = new PostgresChatTaskNotifier(
      createDataSource(),
      'postgres://unused',
      1,
      () => clients.shift()!,
    );

    await notifier.start((taskId) => received.push(taskId));
    expect(first.query).toHaveBeenCalledWith(
      `LISTEN ${CHAT_TASK_NOTIFICATION_CHANNEL}`,
    );
    first.send('task-1');
    expect(received).toEqual(['task-1']);

    first.emit('error', new Error('connection lost'));
    await vi.waitFor(() => expect(second.connect).toHaveBeenCalledOnce());
    second.send('task-2');
    expect(received).toEqual(['task-1', 'task-2']);

    await notifier.stop();
    expect(second.end).toHaveBeenCalledOnce();
  });
});
