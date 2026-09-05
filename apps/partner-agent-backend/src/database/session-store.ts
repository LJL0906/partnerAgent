import type { SessionMessage } from '@partner-agent/contracts';

export interface StoredSessionMessage extends SessionMessage {
  /** 会话内单调递增序号，用于把快照水位之后的消息补回 Agent 上下文。 */
  sequence: number;
}

export interface StoredSession {
  id: string;
  ownerId: string;
  messages: StoredSessionMessage[];
  contextMessages: unknown[];
  /** 已包含在 contextMessages 中的最后一条持久消息序号。 */
  contextRevision: number;
  createdAt: Date;
  lastActiveAt: Date;
}

export abstract class SessionStore {
  /** 返回当前用户的会话，不携带 Agent 内部上下文。 */
  abstract list(ownerId: string): Promise<StoredSession[]>;
  abstract find(
    sessionId: string,
    ownerId?: string,
  ): Promise<StoredSession | undefined>;
  abstract createIfAllowed(
    sessionId: string,
    ownerId: string,
    maxSessionsPerUser: number,
  ): Promise<StoredSession>;
  abstract appendMessage(
    sessionId: string,
    ownerId: string,
    role: SessionMessage['role'],
    content: string,
  ): Promise<void>;
  abstract completeAssistantTurn(
    sessionId: string,
    ownerId: string,
    content: string | undefined,
    contextMessages: unknown[],
  ): Promise<void>;
  abstract delete(sessionId: string, ownerId: string): Promise<void>;
}
