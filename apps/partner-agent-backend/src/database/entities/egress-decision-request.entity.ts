import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

export type EgressDecisionState =
  | 'pending'
  | 'ready_allow'
  | 'ready_redact'
  | 'consumed'
  | 'blocked'
  | 'expired'
  | 'cancelled'
  | 'invalidated';

export type EgressDecision = 'allow' | 'redact' | 'block';

@Entity({ name: 'egress_decision_requests' })
@Index('egress_decision_owner_state_created_idx', [
  'ownerId',
  'state',
  'createdAt',
])
@Check('egress_decision_version_check', 'version > 0')
@Check('egress_decision_expiry_check', 'expires_at > created_at')
export class EgressDecisionRequestEntity {
  @PrimaryColumn({ type: 'uuid' }) id: string;
  @Column({ name: 'owner_id', type: 'text' }) ownerId: string;
  @Column({ name: 'task_id', type: 'uuid' }) taskId: string;
  @Column({ name: 'session_id', type: 'text' }) sessionId: string;
  @Column({ name: 'operation_id', type: 'text' }) operationId: string;
  @Column({ name: 'request_fingerprint', type: 'text' })
  requestFingerprint: string;
  @Column({ type: 'text' }) provider: string;
  @Column({ name: 'model_id', type: 'text' }) modelId: string;
  @Column({ type: 'text' }) source: string;
  @Column({ type: 'text', array: true }) categories: string[];
  @Column({ type: 'text' }) state: EgressDecisionState;
  @Column({ type: 'text', nullable: true }) decision: EgressDecision | null;
  @Column({ type: 'integer' }) version: number;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;
}
