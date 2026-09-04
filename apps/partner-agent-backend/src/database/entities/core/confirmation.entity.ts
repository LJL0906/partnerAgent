import {
  Check,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type {
  BusinessObjectAction,
  BusinessObjectKind,
  CandidateStatus,
} from './core.types.js';

@Entity({ name: 'confirmation_batches' })
@Unique('confirmation_batches_user_id_id_key', ['userId', 'id'])
@Index('confirmation_batches_pending_idx', ['userId', 'createdAt'], {
  where: "batch_status in ('pending','partially_processed')",
})
@Check(
  'confirmation_batches_status_check',
  "batch_status in ('pending','partially_processed','confirmed','cancelled','expired')",
)
@Check('confirmation_batches_risk_check', "risk_level in ('normal','high')")
@Check('confirmation_batches_version_check', 'version >= 1')
export class ConfirmationBatchEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'text' }) userId: string;
  @Column({ name: 'source_record_id', type: 'uuid', nullable: true })
  sourceRecordId: string | null;
  @Column({ name: 'source_analysis_id', type: 'uuid', nullable: true })
  sourceAnalysisId: string | null;
  @Column({ name: 'batch_status', type: 'text', default: 'pending' })
  batchStatus:
    'pending' | 'partially_processed' | 'confirmed' | 'cancelled' | 'expired';
  @Column({ name: 'risk_level', type: 'text', default: 'normal' })
  riskLevel: 'normal' | 'high';
  @Column({
    name: 'expires_at',
    type: 'timestamptz',
    default: () => "now() + interval '24 hours'",
  })
  expiresAt: Date;
  @Column({ name: 'first_presented_at', type: 'timestamptz', nullable: true })
  firstPresentedAt: Date | null;
  @Column({ name: 'last_processed_at', type: 'timestamptz', nullable: true })
  lastProcessedAt: Date | null;
  @Column({ type: 'bigint', default: 1 }) version: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity({ name: 'candidate_items' })
@Unique('candidate_items_user_id_id_key', ['userId', 'id'])
@Unique('candidate_items_user_batch_id_key', ['userId', 'batchId', 'id'])
@Index('candidate_items_pending_expiry_idx', ['userId', 'expiresAt'], {
  where: "candidate_status = 'pending'",
})
@Index('candidate_items_batch_status_idx', [
  'userId',
  'batchId',
  'candidateStatus',
])
@Check(
  'candidate_items_kind_check',
  "kind in ('goal','action','fact','memory','decision','situation','reminder')",
)
@Check(
  'candidate_items_action_check',
  "action in ('create','update','status_change','archive','soft_delete','permanent_delete','restore','undo')",
)
@Check(
  'candidate_items_status_check',
  "candidate_status in ('pending','confirmed','confirmed_after_edit','cancelled','expired')",
)
@Check('candidate_items_risk_check', "risk in ('normal','high')")
@Check(
  'candidate_items_target_check',
  "action = 'create' or target_object_id is not null",
)
@Check(
  'candidate_items_edited_payload_check',
  "candidate_status = 'confirmed_after_edit' or edited_payload is null",
)
@Check('candidate_items_confidence_check', 'confidence between 0 and 1')
@Check('candidate_items_version_check', 'version >= 1')
export class CandidateItemEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'text' }) userId: string;
  @Column({ name: 'batch_id', type: 'uuid' }) batchId: string;
  @Column({ type: 'text' }) kind: BusinessObjectKind;
  @Column({ type: 'text' })
  action: BusinessObjectAction;
  @Column({ name: 'candidate_status', type: 'text', default: 'pending' })
  candidateStatus: CandidateStatus;
  @Column({ type: 'text', default: 'normal' }) risk: 'normal' | 'high';
  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;
  /** modify_confirm 允许覆盖的候选 payload 顶层字段。 */
  @Column({ name: 'editable_fields', type: 'text', array: true, default: '{}' })
  editableFields: string[];
  @Column({ name: 'edited_payload', type: 'jsonb', nullable: true })
  editedPayload: Record<string, unknown> | null;
  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true })
  confidence: string | null;
  @Column({ name: 'sensitive_marks', type: 'text', array: true, default: '{}' })
  sensitiveMarks: string[];
  @Column({ name: 'target_object_id', type: 'uuid', nullable: true })
  targetObjectId: string | null;
  @Column({ name: 'expected_version', type: 'bigint', nullable: true })
  expectedVersion: string | null;
  @Column({ name: 'source_refs', type: 'jsonb', default: () => "'[]'::jsonb" })
  sourceRefs: unknown[];
  @Column({
    name: 'expires_at',
    type: 'timestamptz',
    default: () => "now() + interval '24 hours'",
  })
  expiresAt: Date;
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;
  @Column({ type: 'bigint', default: 1 }) version: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity({ name: 'confirmation_actions' })
@Unique('confirmation_actions_user_operation_key', ['userId', 'operationId'])
@Unique('confirmation_actions_user_id_id_key', ['userId', 'id'])
@Index('confirmation_actions_batch_created_idx', [
  'userId',
  'batchId',
  'createdAt',
])
@Check(
  'confirmation_actions_type_check',
  "action_type in ('confirm','confirm_after_edit','cancel','undo')",
)
@Check(
  'confirmation_actions_client_source_check',
  "client_source in ('ios','android','web','other')",
)
@Check('confirmation_actions_attempts_check', 'attempts >= 1')
export class ConfirmationActionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'text' }) userId: string;
  @Column({ name: 'batch_id', type: 'uuid' }) batchId: string;
  @Column({ name: 'candidate_id', type: 'uuid', nullable: true })
  candidateId: string | null;
  @Column({ name: 'operation_id', type: 'uuid' }) operationId: string;
  @Column({ name: 'request_fingerprint', type: 'text' })
  requestFingerprint: string;
  @Column({ name: 'action_type', type: 'text' })
  actionType: 'confirm' | 'confirm_after_edit' | 'cancel' | 'undo';
  @Column({ name: 'submitted_payload', type: 'jsonb', nullable: true })
  submittedPayload: Record<string, unknown> | null;
  @Column({ name: 'client_source', type: 'text' }) clientSource: string;
  @Column({ name: 'reverses_action_id', type: 'uuid', nullable: true })
  reversesActionId: string | null;
  @Column({ type: 'integer', default: 1 }) attempts: number;
  @Column({ name: 'last_error', type: 'jsonb', nullable: true })
  lastError: Record<string, unknown> | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
