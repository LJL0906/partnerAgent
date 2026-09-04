import { Injectable } from '@nestjs/common';
import type { Agent } from '@earendil-works/pi-agent-core';
import type { SessionMessage } from '@partner-agent/contracts';

export interface Session {
  id: string;
  userId?: string;
  messages: SessionMessage[];
  agent?: Agent;
  createdAt: Date;
  lastActiveAt: Date;
}

const MAX_SESSIONS = 100;
const MAX_MESSAGES_PER_SESSION = 100;

@Injectable()
export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  getOrCreate(sessionId: string, userId?: string): Session {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastActiveAt = new Date();
      return existing;
    }

    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(`会话数量已达到上限 ${MAX_SESSIONS}`);
    }

    const now = new Date();
    const session: Session = {
      id: sessionId,
      userId,
      messages: [],
      createdAt: now,
      lastActiveAt: now,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  saveMessage(
    sessionId: string,
    role: SessionMessage['role'],
    content: string,
  ): void {
    const session = this.getOrCreate(sessionId);
    session.messages.push({ role, content, timestamp: Date.now() });
    if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
      session.messages.splice(
        0,
        session.messages.length - MAX_MESSAGES_PER_SESSION,
      );
    }
    session.lastActiveAt = new Date();
  }

  getHistory(sessionId: string, userId?: string): SessionMessage[] {
    const session = this.getOrCreate(sessionId, userId);
    return session.messages.map((message) => ({ ...message }));
  }

  getAgent(sessionId: string): Agent | undefined {
    return this.sessions.get(sessionId)?.agent;
  }

  setAgent(sessionId: string, agent: Agent): void {
    const session = this.getOrCreate(sessionId);
    session.agent = agent;
    session.lastActiveAt = new Date();
  }

  destroy(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    session?.agent?.abort();
    this.sessions.delete(sessionId);
  }
}
