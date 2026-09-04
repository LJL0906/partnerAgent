import type { SensitiveCategory } from './egress.types.js';

export const EGRESS_DECISION_STORE = Symbol('EGRESS_DECISION_STORE');

export type PrivacyDecision = 'allow' | 'redact' | 'block';
export type EgressDecisionRequestState =
  | 'pending'
  | 'ready_allow'
  | 'ready_redact'
  | 'consumed'
  | 'blocked'
  | 'expired'
  | 'cancelled'
  | 'invalidated';

export interface StoredEgressDecision {
  id: string;
  ownerId: string;
  taskId: string;
  sessionId: string;
  operationId: string;
  requestFingerprint: string;
  provider: string;
  modelId: string;
  source: string;
  categories: SensitiveCategory[];
  state: EgressDecisionRequestState;
  decision?: PrivacyDecision;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  decidedAt?: Date;
  consumedAt?: Date;
}

export interface CreatePendingEgressDecisionInput {
  ownerId: string;
  taskId: string;
  sessionId: string;
  operationId: string;
  requestFingerprint: string;
  provider: string;
  modelId: string;
  source: string;
  categories: readonly SensitiveCategory[];
  ttlMs: number;
}

export interface EgressDecisionBinding {
  ownerId: string;
  taskId: string;
  requestFingerprint: string;
  provider: string;
  modelId: string;
  source: string;
}

export interface SubmitEgressDecisionInput {
  ownerId: string;
  egressId: string;
  decision: PrivacyDecision;
  commandOperationId: string;
  commandRequestFingerprint: string;
}

export interface SubmitEgressDecisionResult {
  record: StoredEgressDecision;
  result: Record<string, unknown>;
}

export interface ConsumeEgressDecisionResult {
  status:
    | 'consumed'
    | 'pending'
    | 'missing'
    | 'blocked'
    | 'expired'
    | 'cancelled'
    | 'invalidated';
  record?: StoredEgressDecision;
}

export class EgressDecisionNotFoundError extends Error {}
export class EgressDecisionConflictError extends Error {}
export class EgressDecisionExpiredError extends Error {}
export class EgressDecisionIdempotencyConflictError extends Error {}

export interface EgressDecisionStore {
  createOrGetPending(
    input: CreatePendingEgressDecisionInput,
  ): Promise<StoredEgressDecision>;
  findCurrentForTask(
    taskId: string,
    ownerId: string,
  ): Promise<StoredEgressDecision | undefined>;
  findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<StoredEgressDecision | undefined>;
  submitDecision(
    input: SubmitEgressDecisionInput,
  ): Promise<SubmitEgressDecisionResult>;
  consumeMatchingDecision(
    input: EgressDecisionBinding,
  ): Promise<ConsumeEgressDecisionResult>;
  cancelPendingForTask(
    taskId: string,
    ownerId: string,
  ): Promise<StoredEgressDecision[]>;
  expireDue(limit?: number): Promise<StoredEgressDecision[]>;
  listRecoverableDecisions(limit?: number): Promise<StoredEgressDecision[]>;
}
