import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { EgressDecision, SensitiveCategory } from '../../model-gateway/egress.types.js';

@Entity({ name: 'egress_audit_logs' })
@Index('egress_audit_task_created_idx', ['taskId', 'createdAt'])
export class EgressAuditEntity {
  @PrimaryColumn({ name: 'request_id', type: 'uuid' }) requestId: string;
  @Column({ name: 'task_id', type: 'uuid', nullable: true }) taskId: string | null;
  @Column({ type: 'text' }) source: string;
  @Column({ type: 'text', array: true }) categories: SensitiveCategory[];
  @Column({ name: 'policy_result', type: 'text' }) policyResult: EgressDecision;
  @Column({ type: 'text' }) provider: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
