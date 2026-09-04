import {
  Check,
  Column,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity({ name: 'formal_object_details' })
@Unique('formal_object_details_user_id_id_key', ['userId', 'id'])
@Check('formal_object_details_confidence_check', 'confidence between 0 and 1')
export class FormalObjectDetailEntity {
  @PrimaryColumn({ type: 'uuid' }) id: string;
  @Column({ name: 'user_id', type: 'text' }) userId: string;
  @Column({ type: 'jsonb' }) content: Record<string, unknown>;
  @Column({ name: 'domain_status', type: 'text' }) domainStatus: string;
  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true })
  confidence: string | null;
  @Column({ name: 'is_sensitive', type: 'boolean', default: false })
  isSensitive: boolean;
  @Column({ name: 'confirmed_at', type: 'timestamptz' }) confirmedAt: Date;
  @Column({ name: 'supersedes_object_id', type: 'uuid', nullable: true })
  supersedesObjectId: string | null;
}

@Entity({ name: 'object_versions' })
@Unique('object_versions_user_object_version_key', [
  'userId',
  'objectId',
  'objectVersion',
])
@Index('object_versions_latest_idx', ['userId', 'objectId', 'objectVersion'])
@Check('object_versions_version_check', 'object_version >= 1')
export class ObjectVersionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'text' }) userId: string;
  @Column({ name: 'object_id', type: 'uuid' }) objectId: string;
  @Column({ name: 'object_version', type: 'bigint' }) objectVersion: string;
  @Column({ type: 'jsonb' }) snapshot: Record<string, unknown>;
  @Column({ name: 'change_type', type: 'text' }) changeType: string;
  @Column({ name: 'confirmation_action_id', type: 'uuid' })
  confirmationActionId: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity({ name: 'source_relations' })
@Index('source_relations_object_idx', ['userId', 'objectId'])
@Index('source_relations_reverse_idx', ['userId', 'sourceKind', 'sourceId'])
export class SourceRelationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'text' }) userId: string;
  @Column({ name: 'object_id', type: 'uuid' }) objectId: string;
  @Column({ name: 'source_kind', type: 'text' }) sourceKind: string;
  @Column({ name: 'source_id', type: 'text' }) sourceId: string;
  @Column({ name: 'relation_type', type: 'text' }) relationType: string;
  @Column({ name: 'source_excerpt', type: 'text', nullable: true })
  sourceExcerpt: string | null;
  @Column({ name: 'source_deleted', type: 'boolean', default: false })
  sourceDeleted: boolean;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity({ name: 'object_index_jobs' })
@Index('object_index_jobs_pending_idx', ['status', 'createdAt', 'id'], {
  where: "status in ('pending','retrying')",
})
@Check(
  'object_index_jobs_status_check',
  "status in ('pending','processing','succeeded','retrying','failed')",
)
@Check('object_index_jobs_attempts_check', 'attempts >= 0')
@Check('object_index_jobs_version_check', 'object_version >= 1')
export class ObjectIndexJobEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'text' }) userId: string;
  @Column({ name: 'object_id', type: 'uuid' }) objectId: string;
  @Column({ name: 'object_version', type: 'bigint' }) objectVersion: string;
  @Column({ type: 'text', default: 'pending' })
  status: 'pending' | 'processing' | 'succeeded' | 'retrying' | 'failed';
  @Column({ type: 'integer', default: 0 }) attempts: number;
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
