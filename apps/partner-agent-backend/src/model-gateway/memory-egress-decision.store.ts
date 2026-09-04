import { randomUUID } from 'node:crypto';
import {
  EgressDecisionConflictError,
  EgressDecisionExpiredError,
  EgressDecisionIdempotencyConflictError,
  EgressDecisionNotFoundError,
  type ConsumeEgressDecisionResult,
  type CreatePendingEgressDecisionInput,
  type EgressDecisionBinding,
  type EgressDecisionStore,
  type StoredEgressDecision,
  type SubmitEgressDecisionInput,
  type SubmitEgressDecisionResult,
} from './egress-decision.store.js';

export class MemoryEgressDecisionStore implements EgressDecisionStore {
  private readonly records = new Map<string, StoredEgressDecision>();
  private readonly operations = new Map<
    string,
    {
      fingerprint: string;
      result: SubmitEgressDecisionResult;
    }
  >();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async createOrGetPending(input: CreatePendingEgressDecisionInput) {
    this.validateCreate(input);
    const existing = this.activeForTask(input.taskId, input.ownerId).find(
      (record) => this.matches(record, input),
    );
    if (existing) return this.copy(existing);

    const now = this.now();
    for (const record of this.activeForTask(input.taskId, input.ownerId)) {
      record.state = record.state === 'pending' ? 'cancelled' : 'invalidated';
      record.updatedAt = now;
      record.version += 1;
    }
    const record: StoredEgressDecision = {
      id: this.createId(),
      ownerId: input.ownerId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      operationId: input.operationId,
      requestFingerprint: input.requestFingerprint,
      provider: input.provider,
      modelId: input.modelId,
      source: input.source,
      categories: [...input.categories],
      state: 'pending',
      version: 1,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + input.ttlMs),
    };
    this.records.set(record.id, record);
    return this.copy(record);
  }

  async findCurrentForTask(taskId: string, ownerId: string) {
    const current = this.activeForTask(taskId, ownerId)[0];
    return current ? this.copy(current) : undefined;
  }

  async findByIdForOwner(id: string, ownerId: string) {
    const record = this.records.get(id);
    return record?.ownerId === ownerId ? this.copy(record) : undefined;
  }

  async submitDecision(
    input: SubmitEgressDecisionInput,
  ): Promise<SubmitEgressDecisionResult> {
    const operationKey = `${input.ownerId}:${input.commandOperationId}`;
    const prior = this.operations.get(operationKey);
    if (prior) {
      if (prior.fingerprint !== input.commandRequestFingerprint)
        throw new EgressDecisionIdempotencyConflictError();
      return {
        record: this.copy(prior.result.record),
        result: { ...prior.result.result, status: 'duplicate' },
      };
    }
    const record = this.records.get(input.egressId);
    if (!record || record.ownerId !== input.ownerId)
      throw new EgressDecisionNotFoundError();
    if (record.state !== 'pending') throw new EgressDecisionConflictError();
    const now = this.now();
    if (record.expiresAt.getTime() <= now.getTime()) {
      record.state = 'expired';
      record.updatedAt = now;
      record.version += 1;
      throw new EgressDecisionExpiredError();
    }
    record.decision = input.decision;
    record.state =
      input.decision === 'allow'
        ? 'ready_allow'
        : input.decision === 'redact'
          ? 'ready_redact'
          : 'blocked';
    record.decidedAt = now;
    record.updatedAt = now;
    record.version += 1;
    const result = this.commandResult(input.commandOperationId, record);
    const stored = { record: this.copy(record), result };
    this.operations.set(operationKey, {
      fingerprint: input.commandRequestFingerprint,
      result: stored,
    });
    return { record: this.copy(record), result: { ...result } };
  }

  async consumeMatchingDecision(
    input: EgressDecisionBinding,
  ): Promise<ConsumeEgressDecisionResult> {
    const current = this.activeForTask(input.taskId, input.ownerId)[0];
    if (!current) return this.terminalOutcome(input.taskId, input.ownerId);
    const now = this.now();
    if (current.state === 'pending' && current.expiresAt <= now) {
      current.state = 'expired';
      current.updatedAt = now;
      current.version += 1;
      return { status: 'expired', record: this.copy(current) };
    }
    if (!this.matches(current, input)) {
      current.state = current.state === 'pending' ? 'cancelled' : 'invalidated';
      current.updatedAt = now;
      current.version += 1;
      return { status: 'invalidated', record: this.copy(current) };
    }
    if (current.state === 'pending')
      return { status: 'pending', record: this.copy(current) };
    current.state = 'consumed';
    current.consumedAt = now;
    current.updatedAt = now;
    current.version += 1;
    return { status: 'consumed', record: this.copy(current) };
  }

  async cancelPendingForTask(taskId: string, ownerId: string) {
    const now = this.now();
    const changed = this.activeForTask(taskId, ownerId);
    for (const record of changed) {
      record.state = 'cancelled';
      record.updatedAt = now;
      record.version += 1;
    }
    return changed.map((record) => this.copy(record));
  }

  async expireDue(limit = 100) {
    this.validateLimit(limit);
    const now = this.now();
    const due = [...this.records.values()]
      .filter((record) => record.state === 'pending' && record.expiresAt <= now)
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
      .slice(0, limit);
    for (const record of due) {
      record.state = 'expired';
      record.updatedAt = now;
      record.version += 1;
    }
    return due.map((record) => this.copy(record));
  }

  async listRecoverableDecisions(limit = 100) {
    this.validateLimit(limit);
    return [...this.records.values()]
      .filter((record) =>
        ['ready_allow', 'ready_redact'].includes(record.state),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map((record) => this.copy(record));
  }

  private terminalOutcome(
    taskId: string,
    ownerId: string,
  ): ConsumeEgressDecisionResult {
    const record = [...this.records.values()]
      .filter((item) => item.taskId === taskId && item.ownerId === ownerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!record || ['consumed', 'invalidated'].includes(record.state))
      return { status: 'missing' };
    if (['blocked', 'expired', 'cancelled'].includes(record.state))
      return {
        status: record.state,
        record: this.copy(record),
      } as ConsumeEgressDecisionResult;
    return { status: 'missing' };
  }

  private activeForTask(taskId: string, ownerId: string) {
    return [...this.records.values()]
      .filter(
        (record) =>
          record.taskId === taskId &&
          record.ownerId === ownerId &&
          ['pending', 'ready_allow', 'ready_redact'].includes(record.state),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private matches(record: StoredEgressDecision, input: EgressDecisionBinding) {
    return (
      record.taskId === input.taskId &&
      record.ownerId === input.ownerId &&
      record.requestFingerprint === input.requestFingerprint &&
      record.provider === input.provider &&
      record.modelId === input.modelId &&
      record.source === input.source
    );
  }

  private commandResult(operationId: string, record: StoredEgressDecision) {
    return {
      operation_id: operationId,
      status: record.state === 'blocked' ? 'completed' : 'accepted',
      task_refs: [{ task_id: record.taskId, kind: 'chat_response' }],
      data: {
        egress_id: record.id,
        task_id: record.taskId,
        decision: record.decision,
        state: record.state,
        version: String(record.version),
      },
    };
  }

  private validateCreate(input: CreatePendingEgressDecisionInput) {
    if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0)
      throw new RangeError('ttlMs 必须是正数');
    if (input.categories.length === 0)
      throw new RangeError('categories 不能为空');
  }
  private validateLimit(limit: number) {
    if (!Number.isInteger(limit) || limit <= 0)
      throw new RangeError('limit 必须是正整数');
  }
  private copy(record: StoredEgressDecision): StoredEgressDecision {
    return structuredClone(record);
  }
}
