import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'outbox_remediation_audits' })
@Index('outbox_remediation_audits_event_idx', ['outboxKind', 'eventId'])
export class OutboxRemediationAuditEntity {
  @PrimaryColumn({ type: 'uuid' }) id: string;
  @Column({ name: 'outbox_kind', type: 'text' }) outboxKind: string;
  @Column({ name: 'event_id', type: 'uuid' }) eventId: string;
  @Column({ type: 'text' }) action: string;
  @Column({ name: 'operator_label', type: 'text' }) operatorLabel: string;
  @Column({ name: 'confirmation_phrase', type: 'text' })
  confirmationPhrase: string;
  @Column({ name: 'previous_attempt_count', type: 'integer' })
  previousAttemptCount: number;
  @Column({ name: 'previous_error_code', type: 'text', nullable: true })
  previousErrorCode: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
