import { Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

export type ChatTaskState =
  | 'queued'
  | 'running'
  | 'waiting_privacy_decision'
  | 'completed'
  | 'failed'
  | 'cancelled';

@Entity({ name: 'original_records' })
@Unique('original_records_owner_input_key', ['ownerId', 'inputId'])
@Unique('original_records_owner_id_key', ['ownerId', 'id'])
export class OriginalRecordEntity {
  @PrimaryColumn({ type: 'uuid' }) id: string;
  @Column({ name: 'owner_id', type: 'text' }) ownerId: string;
  @Column({ name: 'session_id', type: 'text' }) sessionId: string;
  @Column({ name: 'input_id', type: 'text' }) inputId: string;
  @Column({ name: 'request_fingerprint', type: 'text' })
  requestFingerprint: string;
  @Column({ type: 'text' }) content: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity({ name: 'local_core_operations' })
@Unique('local_core_operations_owner_operation_key', ['ownerId', 'operationId'])
export class LocalCoreOperationEntity {
  @PrimaryColumn({ type: 'uuid' }) id: string;
  @Column({ name: 'owner_id', type: 'text' }) ownerId: string;
  @Column({ name: 'operation_id', type: 'text' }) operationId: string;
  @Column({ name: 'request_fingerprint', type: 'text' })
  requestFingerprint: string;
  @Column({ name: 'command_name', type: 'text' }) commandName: string;
  @Column({ name: 'result_json', type: 'jsonb' }) resultJson: Record<
    string,
    unknown
  >;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity({ name: 'chat_tasks' })
@Index('chat_tasks_owner_updated_idx', ['ownerId', 'updatedAt'])
export class ChatTaskEntity {
  @PrimaryColumn({ type: 'uuid' }) id: string;
  @Column({ name: 'owner_id', type: 'text' }) ownerId: string;
  @Column({ name: 'session_id', type: 'text' }) sessionId: string;
  @Column({ name: 'operation_id', type: 'text' }) operationId: string;
  @Column({ name: 'input_id', type: 'text' }) inputId: string;
  @Column({ name: 'original_record_id', type: 'uuid' })
  originalRecordId: string;
  @Column({ name: 'user_message_id', type: 'uuid' }) userMessageId: string;
  @Column({ name: 'result_message_id', type: 'uuid', nullable: true })
  resultMessageId: string | null;
  @Column({ type: 'text' }) state: ChatTaskState;
  @Column({ name: 'error_code', type: 'text', nullable: true }) errorCode:
    string | null;
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}

export const CHAT_TASK_ENTITIES = [
  OriginalRecordEntity,
  LocalCoreOperationEntity,
  ChatTaskEntity,
] as const;
