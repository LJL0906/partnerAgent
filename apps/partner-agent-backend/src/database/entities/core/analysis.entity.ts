import {
  Check,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type {
  AnalysisRunStatus,
  AnalysisType,
  StructuredAnalysisStatus,
} from '@partner-agent/contracts';

@Entity({ name: 'analysis_runs' })
@Unique('analysis_runs_owner_id_key', ['ownerId', 'id'])
@Unique('analysis_runs_owner_task_type_key', [
  'ownerId',
  'chatTaskId',
  'analysisType',
])
@Index('analysis_runs_owner_status_created_idx', [
  'ownerId',
  'status',
  'createdAt',
])
@Index('analysis_runs_owner_record_created_idx', [
  'ownerId',
  'originalRecordId',
  'createdAt',
])
@Index('analysis_runs_owner_task_created_idx', [
  'ownerId',
  'chatTaskId',
  'createdAt',
])
@Check(
  'analysis_runs_type_check',
  "analysis_type in ('idea_organize','experience_review','problem_analysis','content_extract','action')",
)
@Check(
  'analysis_runs_status_check',
  "status in ('queued','running','completed','partially_completed','failed','cancelled')",
)
@Check('analysis_runs_version_check', 'version >= 1')
export class AnalysisRunEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'owner_id', type: 'text' }) ownerId: string;
  @Column({ name: 'original_record_id', type: 'uuid' })
  originalRecordId: string;
  @Column({ name: 'chat_task_id', type: 'uuid' }) chatTaskId: string;
  @Column({ name: 'analysis_type', type: 'text' }) analysisType: AnalysisType;
  @Column({ type: 'text', default: 'queued' }) status: AnalysisRunStatus;
  @Column({ name: 'request_fingerprint', type: 'text' })
  requestFingerprint: string;
  @Column({ name: 'error_summary', type: 'text', nullable: true })
  errorSummary: string | null;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
  @Column({ type: 'bigint', default: 1 }) version: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity({ name: 'structured_analyses' })
@Unique('structured_analyses_owner_id_key', ['ownerId', 'id'])
@Unique('structured_analyses_owner_run_key', ['ownerId', 'analysisRunId'])
@Check('structured_analyses_schema_version_check', 'schema_version >= 1')
@Check(
  'structured_analyses_status_check',
  "status in ('valid','partially_valid','invalid')",
)
export class StructuredAnalysisEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'owner_id', type: 'text' }) ownerId: string;
  @Column({ name: 'analysis_run_id', type: 'uuid' }) analysisRunId: string;
  @Column({ name: 'schema_version', type: 'integer', default: 1 })
  schemaVersion: number;
  @Column({ type: 'text' }) status: StructuredAnalysisStatus;
  @Column({ name: 'result_json', type: 'jsonb' })
  resultJson: Record<string, unknown>;
  @Column({
    name: 'validation_errors',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  validationErrors: unknown[];
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
