export const AGENT_TRACE_MAX_EVENTS_PER_RUN = 256;
export const AGENT_TRACE_MAX_EVENTS_PER_OWNER = 10_000;
export const AGENT_TRACE_RETENTION_DAYS = 30;
export const AGENT_TRACE_MAX_QUERY_DAYS = 7;
export const AGENT_TRACE_MAX_PAGE_SIZE = 100;

export interface AgentRunTraceRecord {
  id: string;
  runId: string;
  sequence: number;
  ownerId: string;
  sessionId: string;
  taskId?: string;
  operationId?: string;
  requestId?: string;
  toolCallId?: string;
  source: string;
  eventType: string;
  status?: string;
  provider?: string;
  modelId?: string;
  toolName?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  modelTurns?: number;
  toolCalls?: number;
  outputTokenBudget?: number;
  deadlineMs?: number;
  errorCode?: string;
  createdAt: Date;
}

export interface AgentRunTraceCursor {
  createdAt: Date;
  runId: string;
  sequence: number;
  id: string;
}

export interface AgentRunTraceQuery {
  ownerId: string;
  from: Date;
  to: Date;
  runId?: string;
  limit?: number;
  after?: AgentRunTraceCursor;
}

export interface AgentRunTracePage {
  items: AgentRunTraceRecord[];
  nextCursor?: AgentRunTraceCursor;
}

export abstract class AgentRunTraceStore {
  abstract append(record: AgentRunTraceRecord): Promise<void>;
  abstract query(query: AgentRunTraceQuery): Promise<AgentRunTracePage>;
  abstract prune(ownerId: string, now?: Date): Promise<void>;
  abstract pruneExpired(now?: Date): Promise<void>;
}

export class MemoryAgentRunTraceStore extends AgentRunTraceStore {
  private records: AgentRunTraceRecord[] = [];

  async append(record: AgentRunTraceRecord): Promise<void> {
    if (
      record.sequence < 1 ||
      record.sequence > AGENT_TRACE_MAX_EVENTS_PER_RUN
    ) {
      return;
    }
    if (
      this.records.some(
        (item) =>
          item.runId === record.runId && item.sequence === record.sequence,
      )
    ) {
      return;
    }
    this.records.push(copyRecord(record));
  }

  async query(query: AgentRunTraceQuery): Promise<AgentRunTracePage> {
    const limit = normalizedLimit(query.limit);
    const matches = this.records
      .filter(
        (record) =>
          record.ownerId === query.ownerId &&
          (!query.runId || record.runId === query.runId) &&
          record.createdAt >= query.from &&
          record.createdAt <= query.to &&
          (!query.after || afterCursor(record, query.after)),
      )
      .sort(compareRecords)
      .slice(0, limit + 1);
    const hasNext = matches.length > limit;
    const items = matches.slice(0, limit).map(copyRecord);
    const last = items.at(-1);
    return {
      items,
      ...(hasNext && last
        ? {
            nextCursor: {
              createdAt: last.createdAt,
              runId: last.runId,
              sequence: last.sequence,
              id: last.id,
            },
          }
        : {}),
    };
  }

  async prune(ownerId: string, now = new Date()): Promise<void> {
    const cutoff = new Date(
      now.getTime() - AGENT_TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );
    const retained = this.records
      .filter(
        (record) => record.ownerId === ownerId && record.createdAt >= cutoff,
      )
      .sort((left, right) => compareRecords(right, left))
      .slice(0, AGENT_TRACE_MAX_EVENTS_PER_OWNER);
    this.records = [
      ...this.records.filter((record) => record.ownerId !== ownerId),
      ...retained,
    ];
  }

  async pruneExpired(now = new Date()): Promise<void> {
    const cutoff = new Date(
      now.getTime() - AGENT_TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );
    this.records = this.records.filter((record) => record.createdAt >= cutoff);
  }
}

export function normalizedLimit(limit = 50): number {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > AGENT_TRACE_MAX_PAGE_SIZE
  )
    throw new RangeError(
      `trace limit 必须是 1 到 ${AGENT_TRACE_MAX_PAGE_SIZE}`,
    );
  return limit;
}

function compareRecords(
  left: AgentRunTraceRecord,
  right: AgentRunTraceRecord,
): number {
  return (
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.runId.localeCompare(right.runId) ||
    left.sequence - right.sequence ||
    left.id.localeCompare(right.id)
  );
}

function afterCursor(
  record: AgentRunTraceRecord,
  cursor: AgentRunTraceCursor,
): boolean {
  return (
    record.createdAt > cursor.createdAt ||
    (record.createdAt.getTime() === cursor.createdAt.getTime() &&
      (record.runId > cursor.runId ||
        (record.runId === cursor.runId &&
          (record.sequence > cursor.sequence ||
            (record.sequence === cursor.sequence && record.id > cursor.id)))))
  );
}

function copyRecord(record: AgentRunTraceRecord): AgentRunTraceRecord {
  return { ...record, createdAt: new Date(record.createdAt) };
}
