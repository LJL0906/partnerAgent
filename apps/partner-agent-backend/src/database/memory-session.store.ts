import type { SessionMessage } from '@partner-agent/contracts';
import { SessionStore, type StoredSession } from './session-store.js';

export class MemorySessionStore extends SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  async list(ownerId: string): Promise<StoredSession[]> {
    return [...this.sessions.values()]
      .filter((session) => session.ownerId === ownerId)
      .sort(
        (a, b) =>
          b.lastActiveAt.getTime() - a.lastActiveAt.getTime() ||
          b.id.localeCompare(a.id),
      )
      .map((session) => ({ ...this.copy(session), contextMessages: [] }));
  }

  async find(
    sessionId: string,
    ownerId?: string,
  ): Promise<StoredSession | undefined> {
    const session = this.sessions.get(sessionId);
    if (ownerId !== undefined && session?.ownerId !== ownerId) return undefined;
    return session ? this.copy(session) : undefined;
  }

  async createIfAllowed(
    sessionId: string,
    ownerId: string,
    maxSessionsPerUser: number,
  ): Promise<StoredSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return this.copy(existing);

    const count = [...this.sessions.values()].filter(
      (session) => session.ownerId === ownerId,
    ).length;
    if (count >= maxSessionsPerUser) {
      throw new Error(`用户会话数量已达到上限 ${maxSessionsPerUser}`);
    }

    const now = new Date();
    const session: StoredSession = {
      id: sessionId,
      ownerId,
      messages: [],
      contextMessages: [],
      contextRevision: 0,
      createdAt: now,
      lastActiveAt: now,
    };
    this.sessions.set(sessionId, session);
    return this.copy(session);
  }

  async appendMessage(
    sessionId: string,
    ownerId: string,
    role: SessionMessage['role'],
    content: string,
  ): Promise<void> {
    const session = this.requireOwned(sessionId, ownerId);
    session.messages.push({
      sequence: (session.messages.at(-1)?.sequence ?? 0) + 1,
      role,
      content,
      timestamp: Date.now(),
    });
    session.lastActiveAt = new Date();
  }

  async completeAssistantTurn(
    sessionId: string,
    ownerId: string,
    content: string | undefined,
    contextMessages: unknown[],
  ): Promise<void> {
    const session = this.requireOwned(sessionId, ownerId);
    if (content) {
      session.messages.push({
        sequence: (session.messages.at(-1)?.sequence ?? 0) + 1,
        role: 'assistant',
        content,
        timestamp: Date.now(),
      });
    }
    session.contextMessages = structuredClone(contextMessages);
    session.contextRevision = session.messages.at(-1)?.sequence ?? 0;
    session.lastActiveAt = new Date();
  }

  async delete(sessionId: string, ownerId: string): Promise<void> {
    this.requireOwned(sessionId, ownerId);
    this.sessions.delete(sessionId);
  }

  private requireOwned(sessionId: string, ownerId: string): StoredSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) {
      throw new Error('会话不存在');
    }
    return session;
  }

  private copy(session: StoredSession): StoredSession {
    return {
      ...session,
      messages: session.messages.map((message) => ({ ...message })),
      contextMessages: structuredClone(session.contextMessages),
      createdAt: new Date(session.createdAt),
      lastActiveAt: new Date(session.lastActiveAt),
    };
  }
}
