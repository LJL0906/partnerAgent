import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionMessage } from '@partner-agent/contracts';
import { SessionStore, type StoredSession } from '../database/session-store.js';

export interface Session {
  id: string;
  ownerId: string;
  messages: Array<SessionMessage & { sequence: number }>;
  contextMessages: AgentMessage[];
  contextRevision: number;
  agent?: Agent;
  createdAt: Date;
  lastActiveAt: Date;
}

const DEFAULT_MAX_SESSIONS_PER_USER = 100;

@Injectable()
export class SessionManager {
  private readonly agents = new Map<string, Agent>();
  private readonly maxSessionsPerUser: number;

  constructor(
    configService: ConfigService,
    private readonly store: SessionStore,
  ) {
    const configured = Number(
      configService.get<string>('MAX_SESSIONS_PER_USER') ??
        DEFAULT_MAX_SESSIONS_PER_USER,
    );
    if (!Number.isInteger(configured) || configured < 1) {
      throw new Error('MAX_SESSIONS_PER_USER 必须是正整数');
    }
    this.maxSessionsPerUser = configured;
  }

  async getOrCreate(sessionId: string, ownerId: string): Promise<Session> {
    const existing = await this.store.find(sessionId, ownerId);
    if (existing) return this.toSession(this.assertOwner(existing, ownerId));

    const created = await this.store.createIfAllowed(
      sessionId,
      ownerId,
      this.maxSessionsPerUser,
    );
    return this.toSession(this.assertOwner(created, ownerId));
  }

  async saveMessage(
    sessionId: string,
    ownerId: string,
    role: SessionMessage['role'],
    content: string,
  ): Promise<void> {
    await this.requireOwnedSession(sessionId, ownerId);
    await this.store.appendMessage(sessionId, ownerId, role, content);
  }

  async completeAssistantTurn(
    sessionId: string,
    ownerId: string,
    content: string | undefined,
    contextMessages: AgentMessage[],
  ): Promise<void> {
    await this.requireOwnedSession(sessionId, ownerId);
    await this.store.completeAssistantTurn(
      sessionId,
      ownerId,
      content,
      contextMessages,
    );
  }

  async getHistory(
    sessionId: string,
    ownerId: string,
  ): Promise<SessionMessage[]> {
    const session = await this.requireOwnedSession(sessionId, ownerId);
    return session.messages.map(
      ({ sequence: _sequence, ...message }) => message,
    );
  }

  async getAgent(
    sessionId: string,
    ownerId: string,
  ): Promise<Agent | undefined> {
    await this.requireOwnedSession(sessionId, ownerId);
    return this.agents.get(sessionId);
  }

  async setAgent(
    sessionId: string,
    ownerId: string,
    agent: Agent,
  ): Promise<void> {
    await this.requireOwnedSession(sessionId, ownerId);
    this.agents.set(sessionId, agent);
  }

  clearAgent(sessionId: string): void {
    this.agents.delete(sessionId);
  }

  async assertOwnership(sessionId: string, ownerId: string): Promise<void> {
    await this.requireOwnedSession(sessionId, ownerId);
  }

  async destroy(sessionId: string, ownerId: string): Promise<void> {
    await this.requireOwnedSession(sessionId, ownerId);
    this.agents.get(sessionId)?.abort();
    this.agents.delete(sessionId);
    await this.store.delete(sessionId, ownerId);
  }

  private async requireOwnedSession(
    sessionId: string,
    ownerId: string,
  ): Promise<StoredSession> {
    const session = await this.store.find(sessionId, ownerId);
    if (!session) throw new NotFoundException('会话不存在');
    return this.assertOwner(session, ownerId);
  }

  private assertOwner(session: StoredSession, ownerId: string): StoredSession {
    if (session.ownerId !== ownerId) {
      throw new NotFoundException('会话不存在');
    }
    return session;
  }

  private toSession(session: StoredSession): Session {
    return {
      ...session,
      contextMessages: session.contextMessages as AgentMessage[],
      agent: this.agents.get(session.id),
    };
  }
}
