import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { SessionManager } from './session-manager.service.js';

function createManager(store = new MemorySessionStore(), limit = 100) {
  return new SessionManager(
    new ConfigService({ MAX_SESSIONS_PER_USER: String(limit) }),
    store,
  );
}

describe('SessionManager', () => {
  it('isolates histories and restores a session by id', async () => {
    const manager = createManager();
    await manager.getOrCreate('session-a', 'user-a');
    await manager.getOrCreate('session-b', 'user-b');
    await manager.saveMessage('session-a', 'user-a', 'user', 'A 的消息');
    await manager.saveMessage('session-b', 'user-b', 'user', 'B 的消息');

    await expect(manager.getHistory('session-a', 'user-a')).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: 'A 的消息' }),
    ]);
    await expect(manager.getHistory('session-b', 'user-b')).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: 'B 的消息' }),
    ]);
  });

  it('restores persisted history with a new manager but not the live Agent', async () => {
    const store = new MemorySessionStore();
    const managerA = createManager(store);
    await managerA.getOrCreate('persistent', 'user-a');
    await managerA.saveMessage('persistent', 'user-a', 'user', '第一轮');
    await managerA.completeAssistantTurn('persistent', 'user-a', '已记住', [
      { role: 'user', content: '第一轮', timestamp: 1 },
    ]);

    const managerB = createManager(store);
    await expect(managerB.getHistory('persistent', 'user-a')).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: '第一轮' }),
      expect.objectContaining({ role: 'assistant', content: '已记住' }),
    ]);
    await expect(
      managerB.getAgent('persistent', 'user-a'),
    ).resolves.toBeUndefined();
    const restored = await managerB.getOrCreate('persistent', 'user-a');
    expect(restored.contextMessages).toEqual([
      { role: 'user', content: '第一轮', timestamp: 1 },
    ]);
    expect(restored.contextRevision).toBe(2);
    expect(restored.messages.map((message) => message.sequence)).toEqual([
      1, 2,
    ]);
  });

  it('keeps the snapshot watermark behind a user message saved before a crash', async () => {
    const store = new MemorySessionStore();
    const managerA = createManager(store);
    await managerA.getOrCreate('watermark', 'user-a');
    await managerA.saveMessage('watermark', 'user-a', 'user', '第一轮');
    await managerA.completeAssistantTurn('watermark', 'user-a', '回答', [
      { role: 'user', content: '第一轮', timestamp: 1 },
    ]);
    await managerA.saveMessage('watermark', 'user-a', 'user', '未进快照');

    const restored = await createManager(store).getOrCreate(
      'watermark',
      'user-a',
    );
    expect(restored.contextRevision).toBe(2);
    expect(restored.messages.at(-1)).toMatchObject({
      sequence: 3,
      content: '未进快照',
    });
  });

  it('rejects access to a session owned by another user', async () => {
    const manager = createManager();
    await manager.getOrCreate('private-session', 'user-x');
    await manager.saveMessage('private-session', 'user-x', 'user', '私密消息');

    await expect(
      manager.getOrCreate('private-session', 'user-y'),
    ).rejects.toThrow('会话不存在');
    await expect(
      manager.getHistory('private-session', 'user-y'),
    ).rejects.toThrow('会话不存在');
  });

  it('limits sessions per user without affecting other users', async () => {
    const manager = createManager(new MemorySessionStore(), 2);
    await manager.getOrCreate('x-1', 'user-x');
    await manager.getOrCreate('x-2', 'user-x');

    await expect(manager.getOrCreate('x-3', 'user-x')).rejects.toThrow(
      '用户会话数量已达到上限 2',
    );
    await expect(manager.getOrCreate('y-1', 'user-y')).resolves.toMatchObject({
      ownerId: 'user-y',
    });
  });

  it('does not consume a session slot when missing history is requested', async () => {
    const manager = createManager(new MemorySessionStore(), 1);

    await expect(manager.getHistory('missing', 'user-x')).rejects.toThrow(
      '会话不存在',
    );
    await expect(
      manager.getOrCreate('real-session', 'user-x'),
    ).resolves.toMatchObject({ ownerId: 'user-x' });
  });
});
