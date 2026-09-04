import { Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

@Entity({ name: 'session_messages' })
@Unique('session_messages_session_sequence_key', ['sessionId', 'sequence'])
@Index('session_messages_session_sequence_idx', ['sessionId', 'sequence'])
@Index('session_messages_owner_created_idx', ['ownerId', 'createdAt'])
export class SessionMessageEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'session_id', type: 'text' })
  sessionId: string;

  @Column({ name: 'owner_id', type: 'text' })
  ownerId: string;

  @Column({ type: 'integer' })
  sequence: number;

  @Column({ type: 'text' })
  role: 'user' | 'assistant' | 'system';

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text', default: 'complete' })
  status: 'pending' | 'streaming' | 'complete' | 'failed' | 'cancelled';

  @Column({ name: 'input_id', type: 'text', nullable: true })
  inputId: string | null;

  @Column({ name: 'operation_id', type: 'uuid', nullable: true })
  operationId: string | null;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string | null;

  @Column({ name: 'original_record_id', type: 'uuid', nullable: true })
  originalRecordId: string | null;

  @Column({ name: 'analysis_result_id', type: 'uuid', nullable: true })
  analysisResultId: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
