import {
  Check,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { BusinessObjectKind, LifecycleStatus } from './core.types.js';

@Entity({ name: 'business_objects' })
@Unique('business_objects_user_id_id_key', ['userId', 'id'])
@Index('business_objects_active_kind_idx', ['userId', 'kind', 'updatedAt'], {
  where: "lifecycle_status = 'active'",
})
@Check(
  'business_objects_kind_check',
  "kind in ('goal','action','fact','memory','decision','situation','reminder')",
)
@Check(
  'business_objects_lifecycle_check',
  "lifecycle_status in ('active','archived','soft_deleted','purged')",
)
@Check('business_objects_version_check', 'version >= 1')
@Check(
  'business_objects_archived_at_check',
  "lifecycle_status <> 'archived' or archived_at is not null",
)
@Check(
  'business_objects_deleted_at_check',
  "lifecycle_status not in ('soft_deleted','purged') or deleted_at is not null",
)
@Check(
  'business_objects_purged_at_check',
  "lifecycle_status <> 'purged' or purged_at is not null",
)
export class BusinessObjectEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'text' }) userId: string;
  @Column({ type: 'text' }) kind: BusinessObjectKind;
  @Column({ type: 'bigint', default: 1 }) version: string;
  @Column({ name: 'lifecycle_status', type: 'text', default: 'active' })
  lifecycleStatus: LifecycleStatus;
  @Column({ name: 'created_by_batch_id', type: 'uuid' })
  createdByBatchId: string;
  @Column({ name: 'last_confirmation_batch_id', type: 'uuid' })
  lastConfirmationBatchId: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
  @Column({ name: 'purged_at', type: 'timestamptz', nullable: true })
  purgedAt: Date | null;
}
