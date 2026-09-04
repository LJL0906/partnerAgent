import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type {
  EgressDecision,
  SensitiveCategory,
} from '../../model-gateway/egress.types.js';

@Entity({ name: 'egress_audit_logs' })
@Index('egress_audit_owner_created_idx', ['ownerId', 'createdAt'])
@Index('egress_audit_task_created_idx', ['taskId', 'createdAt'])
@Index('egress_audit_fingerprint_created_idx', [
  'requestFingerprint',
  'createdAt',
])
export class EgressAuditEntity {
  @PrimaryColumn({ name: 'request_id', type: 'uuid' }) requestId: string;
  @Column({ name: 'egress_id', type: 'uuid', nullable: true }) egressId:
    string | null;
  @Column({ name: 'owner_id', type: 'text', nullable: true }) ownerId:
    string | null;
  @Column({ name: 'session_id', type: 'text', nullable: true }) sessionId:
    string | null;
  @Column({ name: 'task_id', type: 'uuid', nullable: true }) taskId:
    string | null;
  @Column({ name: 'operation_id', type: 'text', nullable: true }) operationId:
    string | null;
  @Column({ name: 'request_fingerprint', type: 'text', nullable: true })
  requestFingerprint: string | null;
  @Column({ type: 'text' }) source: string;
  @Column({ type: 'text', array: true }) categories: SensitiveCategory[];
  @Column({ name: 'policy_result', type: 'text' }) policyResult: EgressDecision;
  @Column({ type: 'text' }) provider: string;
  @Column({ name: 'model_id', type: 'text', nullable: true }) modelId:
    string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
