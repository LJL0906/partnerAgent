import { DataSource } from 'typeorm';
import { AgentRunTraceEntity } from '../database/entities/agent-run-trace.entity.js';
import {
  AGENT_TRACE_MAX_EVENTS_PER_OWNER,
  AGENT_TRACE_RETENTION_DAYS,
  AgentRunTraceStore,
  normalizedLimit,
  type AgentRunTracePage,
  type AgentRunTraceQuery,
  type AgentRunTraceRecord,
} from './agent-run-trace.store.js';

export class TypeOrmAgentRunTraceStore extends AgentRunTraceStore {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async append(record: AgentRunTraceRecord): Promise<void> {
    await this.dataSource
      .getRepository(AgentRunTraceEntity)
      .createQueryBuilder()
      .insert()
      .values(toEntity(record))
      .orIgnore()
      .execute();
  }

  async query(query: AgentRunTraceQuery): Promise<AgentRunTracePage> {
    const limit = normalizedLimit(query.limit);
    const builder = this.dataSource
      .getRepository(AgentRunTraceEntity)
      .createQueryBuilder('trace')
      .where('trace.owner_id = :ownerId', { ownerId: query.ownerId })
      .andWhere('trace.created_at >= :from', { from: query.from })
      .andWhere('trace.created_at <= :to', { to: query.to });
    if (query.runId) {
      builder.andWhere('trace.run_id = :runId', { runId: query.runId });
    }
    if (query.after) {
      builder.andWhere(
        `(
          trace.created_at > :afterAt
          or (trace.created_at = :afterAt and trace.run_id::text > :afterRunId)
          or (
            trace.created_at = :afterAt and trace.run_id = :afterRunId
            and trace.sequence > :afterSequence
          )
          or (
            trace.created_at = :afterAt and trace.run_id = :afterRunId
            and trace.sequence = :afterSequence and trace.id::text > :afterId
          )
        )`,
        {
          afterAt: query.after.createdAt,
          afterRunId: query.after.runId,
          afterSequence: query.after.sequence,
          afterId: query.after.id,
        },
      );
    }
    const entities = await builder
      .orderBy('trace.created_at', 'ASC')
      .addOrderBy('trace.run_id', 'ASC')
      .addOrderBy('trace.sequence', 'ASC')
      .addOrderBy('trace.id', 'ASC')
      .take(limit + 1)
      .getMany();
    const hasNext = entities.length > limit;
    const items = entities.slice(0, limit).map(fromEntity);
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
    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(AgentRunTraceEntity)
        .createQueryBuilder()
        .delete()
        .where('owner_id = :ownerId and created_at < :cutoff', {
          ownerId,
          cutoff,
        })
        .execute();
      await manager.query(
        `delete from agent_run_trace_events
         where owner_id = $1 and id in (
           select id from agent_run_trace_events
           where owner_id = $1
           order by created_at desc, id desc
           offset $2
         )`,
        [ownerId, AGENT_TRACE_MAX_EVENTS_PER_OWNER],
      );
    });
  }

  async pruneExpired(now = new Date()): Promise<void> {
    const cutoff = new Date(
      now.getTime() - AGENT_TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );
    await this.dataSource
      .getRepository(AgentRunTraceEntity)
      .createQueryBuilder()
      .delete()
      .where('created_at < :cutoff', { cutoff })
      .execute();
  }
}

function toEntity(record: AgentRunTraceRecord): AgentRunTraceEntity {
  return Object.assign(new AgentRunTraceEntity(), {
    ...record,
    taskId: record.taskId ?? null,
    operationId: record.operationId ?? null,
    requestId: record.requestId ?? null,
    toolCallId: record.toolCallId ?? null,
    status: record.status ?? null,
    provider: record.provider ?? null,
    modelId: record.modelId ?? null,
    toolName: record.toolName ?? null,
    durationMs: record.durationMs ?? null,
    inputTokens: record.inputTokens ?? null,
    outputTokens: record.outputTokens ?? null,
    totalTokens: record.totalTokens ?? null,
    modelTurns: record.modelTurns ?? null,
    toolCalls: record.toolCalls ?? null,
    outputTokenBudget: record.outputTokenBudget ?? null,
    deadlineMs: record.deadlineMs ?? null,
    errorCode: record.errorCode ?? null,
  });
}

function fromEntity(entity: AgentRunTraceEntity): AgentRunTraceRecord {
  return compact({
    id: entity.id,
    runId: entity.runId,
    sequence: entity.sequence,
    ownerId: entity.ownerId,
    sessionId: entity.sessionId,
    taskId: entity.taskId,
    operationId: entity.operationId,
    requestId: entity.requestId,
    toolCallId: entity.toolCallId,
    source: entity.source,
    eventType: entity.eventType,
    status: entity.status,
    provider: entity.provider,
    modelId: entity.modelId,
    toolName: entity.toolName,
    durationMs: entity.durationMs,
    inputTokens: entity.inputTokens,
    outputTokens: entity.outputTokens,
    totalTokens: entity.totalTokens,
    modelTurns: entity.modelTurns,
    toolCalls: entity.toolCalls,
    outputTokenBudget: entity.outputTokenBudget,
    deadlineMs: entity.deadlineMs,
    errorCode: entity.errorCode,
    createdAt: entity.createdAt,
  }) as AgentRunTraceRecord;
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null),
  ) as Partial<T>;
}
