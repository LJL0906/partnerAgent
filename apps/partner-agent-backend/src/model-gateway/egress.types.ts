import type {
  Context,
  Model,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { SensitiveCategory } from '@partner-agent/contracts';

export type { SensitiveCategory } from '@partner-agent/contracts';

export type EgressDecision =
  'allowed' | 'redacted' | 'pending_user_decision' | 'blocked';

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
  requestFingerprint?: string;
  egressId?: string;
  expiresAt?: Date;
  request?: ApprovedEgressRequest;
}

export interface EgressAuditRecord {
  requestId: string;
  egressId?: string;
  ownerId: string;
  sessionId: string;
  taskId?: string;
  operationId?: string;
  requestFingerprint: string;
  source: string;
  provider: string;
  modelId: string;
  categories: SensitiveCategory[];
  decision: EgressDecision;
  createdAt: Date;
}

export class EgressDecisionError extends Error {
  readonly code: 'EGRESS_001' | 'EGRESS_002';

  constructor(
    readonly decision: 'pending_user_decision' | 'blocked',
    readonly categories: readonly SensitiveCategory[],
    readonly details: {
      egressId?: string;
      expiresAt?: Date;
      provider?: string;
      modelId?: string;
      requestFingerprint?: string;
      reason?: 'audit_unavailable';
    } = {},
  ) {
    super(
      details.reason === 'audit_unavailable'
        ? '外发安全检查暂时不可用，本次内容未发送。'
        : decision === 'blocked'
          ? '外发已被策略阻止'
          : '外发等待用户决定',
    );
    this.name = 'EgressDecisionError';
    this.code = decision === 'blocked' ? 'EGRESS_001' : 'EGRESS_002';
  }

  get egressId(): string | undefined {
    return this.details.egressId;
  }

  get expiresAt(): Date | undefined {
    return this.details.expiresAt;
  }

  get provider(): string | undefined {
    return this.details.provider;
  }

  get modelId(): string | undefined {
    return this.details.modelId;
  }
}
