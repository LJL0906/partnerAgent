import { Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';
import type { ChatTaskState } from './chat-task.entity.js';

@Entity({ name: 'chat_task_lifecycle_outbox' })
@Unique('chat_task_lifecycle_outbox_event_key', ['eventKey'])
@Index('chat_task_lifecycle_outbox_claim_idx', [
  'deliveredAt',
  'availableAt',
  'leaseExpiresAt',
])
export class ChatTaskLifecycleOutboxEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' }) eventId: string;
  @Column({ name: 'event_key', type: 'text' }) eventKey: string;
  @Column({ name: 'owner_id', type: 'text' }) ownerId: string;
  @Column({ name: 'task_id', type: 'uuid' }) taskId: string;
  @Column({ name: 'operation_id', type: 'text' }) operationId: string;
  @Column({ name: 'session_id', type: 'text' }) sessionId: string;
  @Column({ type: 'text' }) state: ChatTaskState;
  @Column({ name: 'event_data', type: 'jsonb' }) eventData: Record<string, unknown>;
  @Column({ name: 'attempt_count', type: 'integer' }) attemptCount: number;
  @Column({ name: 'available_at', type: 'timestamptz' }) availableAt: Date;
  @Column({ name: 'lease_owner', type: 'uuid', nullable: true })
  leaseOwner: string | null;
  @Column({ name: 'lease_token', type: 'bigint' }) leaseToken: string;
  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt: Date | null;
  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;
  @Column({ name: 'last_error_code', type: 'text', nullable: true })
  lastErrorCode: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
