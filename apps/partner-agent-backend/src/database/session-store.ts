import type { ReasoningLevel, SessionMessage } from '@partner-agent/contracts';

export interface StoredSessionMessage extends SessionMessage {
  /** 稳定消息资源 ID。 */
  id?: string;
  /** 会话内单调递增序号，用于把快照水位之后的消息补回 Agent 上下文。 */
  sequence: number;
  status?: 'pending' | 'streaming' | 'complete' | 'failed' | 'cancelled';
  revision?: number;
  taskId?: string;
  operationId?: string;
  modelConfigId?: string;
  reasoningLevel?: ReasoningLevel;
}

export interface AppendedSessionMessage {
  id: string;
  sequence: number;
  createdAt: Date;
}

export interface TaskAssistantMessageWrite {
  id: string;
  taskId: string;
  operationId: string;
  modelConfigId: string;
  reasoningLevel: ReasoningLevel;
  content: string;
  status: 'streaming' | 'complete';
  revision: number;
  metadata?: Record<string, unknown>;
}

export interface StoredSession {
  id: string;
  ownerId: string;
  title: string | null;
  messages: StoredSessionMessage[];
  contextMessages: unknown[];
  /** 已包含在 contextMessages 中的最后一条持久消息序号。 */
  contextRevision: number;
  createdAt: Date;
  lastActiveAt: Date;
  archivedAt: Date | null;
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
  abstract rename(sessionId: string, ownerId: string, title: string): Promise<StoredSession>;
  abstract archive(sessionId: string, ownerId: string): Promise<StoredSession>;
  abstract appendMessage(
    sessionId: string,
    ownerId: string,
    role: SessionMessage['role'],
    content: string,
  ): Promise<void>;
  abstract appendSystemTip(
    sessionId: string,
    ownerId: string,
    content: string,
    metadata: { model_config_id: string; previous_model_config_id: string },
  ): Promise<AppendedSessionMessage>;
  abstract completeAssistantTurn(
    sessionId: string,
    ownerId: string,
    content: string | undefined,
    contextMessages: unknown[],
  ): Promise<void>;
  abstract saveTaskAssistantMessage(
    sessionId: string,
    ownerId: string,
    message: TaskAssistantMessageWrite,
  ): Promise<AppendedSessionMessage>;
  abstract saveContextSnapshot(
    sessionId: string,
    ownerId: string,
    contextMessages: unknown[],
    contextRevision: number,
  ): Promise<void>;
  abstract delete(sessionId: string, ownerId: string): Promise<void>;
}
