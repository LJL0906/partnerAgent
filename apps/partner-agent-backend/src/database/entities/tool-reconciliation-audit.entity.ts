import { Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';
import type {
  ToolReconciliationOutcome,
  ToolReconciliationSnapshot,
} from '../../tools/tool-operation.store.js';

@Entity({ name: 'tool_reconciliation_audits' })
@Unique('tool_reconciliation_audits_confirmation_key', ['confirmationId'])
@Unique('tool_reconciliation_audits_owner_confirmation_key', [
  'ownerId',
  'confirmationId',
])
@Index('tool_reconciliation_audits_owner_created_idx', ['ownerId', 'createdAt'])
export class ToolReconciliationAuditEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;
  @Column({ name: 'confirmation_id', type: 'uuid' })
  confirmationId: string;
  @Column({ name: 'owner_id', type: 'text' })
  ownerId: string;
  @Column({ name: 'expected_version', type: 'integer' })
  expectedVersion: number;
  @Column({ name: 'confirmation_version_after', type: 'integer' })
  confirmationVersionAfter: number;
  @Column({ name: 'expected_status', type: 'text' })
  expectedStatus: 'indeterminate';
  @Column({ type: 'text' })
  outcome: ToolReconciliationOutcome;
  @Column({ name: 'operator_label', type: 'text' })
  operatorLabel: string;
  @Column({ name: 'confirmation_phrase', type: 'text' })
  confirmationPhrase: string;
  @Column({ name: 'snapshot_json', type: 'jsonb' })
  snapshotJson: ToolReconciliationSnapshot;
  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
