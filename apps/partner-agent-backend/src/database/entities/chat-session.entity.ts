import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'chat_sessions' })
@Index('chat_sessions_owner_last_active_idx', ['ownerId', 'lastActiveAt'])
export class ChatSessionEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ name: 'owner_id', type: 'text' })
  ownerId: string;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ name: 'context_format', type: 'text', default: 'pi-agent-v1' })
  contextFormat: string;

  @Column({ name: 'context_json', type: 'text', default: '[]' })
  contextJson: string;

  @Column({ name: 'context_revision', type: 'integer', default: 0 })
  contextRevision: number;

  @Column({ type: 'bigint', default: 1 })
  version: string;

  @Column({ name: 'lifecycle_status', type: 'text', default: 'active' })
  lifecycleStatus: 'active' | 'archived' | 'soft_deleted' | 'purged';

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'last_active_at', type: 'timestamptz' })
  lastActiveAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
