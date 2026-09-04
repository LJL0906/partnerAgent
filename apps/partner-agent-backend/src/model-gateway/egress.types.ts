import type { Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';

export type EgressDecision =
  | 'allowed'
  | 'redacted'
  | 'pending_user_decision'
  | 'blocked';

export type SensitiveCategory =
  | 'identity_document'
  | 'bank_card'
  | 'password'
  | 'api_key'
  | 'secret';

export interface EgressRequestMetadata {
  ownerId: string;
  sessionId: string;
  taskId?: string;
  operationId?: string;
  source: string;
  provider: string;
}

export interface ExternalModelRequest {
  readonly metadata: EgressRequestMetadata;
  readonly model: Model<any>;
  readonly context: Context;
  readonly options?: SimpleStreamOptions;
}

declare const approvedEgressBrand: unique symbol;

/** Provider 只能接收由策略网关生成的品牌类型。 */
export interface ApprovedEgressRequest extends ExternalModelRequest {
  readonly decision: 'allowed' | 'redacted';
  readonly categories: readonly SensitiveCategory[];
  readonly [approvedEgressBrand]: true;
}

export interface EgressPolicyResult {
  decision: EgressDecision;
  categories: SensitiveCategory[];
  request?: ApprovedEgressRequest;
}

export interface EgressAuditRecord {
  requestId: string;
  taskId?: string;
  source: string;
  provider: string;
  categories: SensitiveCategory[];
  decision: EgressDecision;
  createdAt: Date;
}

export class EgressDecisionError extends Error {
  constructor(
    readonly decision: 'pending_user_decision' | 'blocked',
    readonly categories: readonly SensitiveCategory[],
  ) {
    super(decision === 'blocked' ? '外发已被策略阻止' : '外发等待用户决定');
  }
}
