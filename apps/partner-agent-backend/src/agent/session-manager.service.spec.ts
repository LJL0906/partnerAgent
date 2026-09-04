import { describe, expect, it } from 'vitest';
import { SessionManager } from './session-manager.service.js';

describe('SessionManager', () => {
  it('isolates histories and restores a session by id', () => {
    const manager = new SessionManager();

    manager.saveMessage('session-a', 'user', 'A 的消息');
    manager.saveMessage('session-b', 'user', 'B 的消息');

    expect(manager.getHistory('session-a')).toEqual([
      expect.objectContaining({ role: 'user', content: 'A 的消息' }),
    ]);
    expect(manager.getHistory('session-b')).toEqual([
      expect.objectContaining({ role: 'user', content: 'B 的消息' }),
    ]);
  });

  it('destroys only the requested session', () => {
    const manager = new SessionManager();
    manager.saveMessage('session-a', 'user', '保留前删除');
    manager.saveMessage('session-b', 'user', '继续保留');

    manager.destroy('session-a');

    expect(manager.getHistory('session-a')).toEqual([]);
    expect(manager.getHistory('session-b')).toHaveLength(1);
  });
});
