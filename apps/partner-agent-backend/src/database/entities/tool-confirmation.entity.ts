import { Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';
import type { ToolRiskLevel } from '@partner-agent/contracts';
import type { ConfirmationStatus } from '../../tools/tool-operation.store.js';
import type { ToolReconciliationSnapshot } from '../../tools/tool-operation.store.js';

@Entity({ name: 'tool_confirmation_requests' })
@Unique('tool_confirmation_requests_owner_id_id_key', ['ownerId', 'id'])
@Index('tool_confirmations_owner_session_status_idx', [
  'ownerId',
  'sessionId',
  'status',
])
@Index('tool_confirmations_expires_idx', ['expiresAt'])
@Index('tool_confirmations_owner_task_idx', ['ownerId', 'taskId'])
export class ToolConfirmationEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;
  @Column({ name: 'owner_id', type: 'text' })
  ownerId: string;
  @Column({ name: 'session_id', type: 'text' })
  sessionId: string;
  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string | null;
  @Column({ name: 'operation_id', type: 'text', nullable: true })
  operationId: string | null;
  @Column({ name: 'tool_call_id', type: 'text' })
  toolCallId: string;
  @Column({ name: 'tool_name', type: 'text' })
  toolName: string;
  @Column({ name: 'risk_level', type: 'text' })
  riskLevel: ToolRiskLevel;
  @Column({ type: 'text' })
  status: ConfirmationStatus;
  @Column({ name: 'arguments_json', type: 'text' })
  argumentsJson: string;
  @Column({ name: 'request_summary', type: 'text' })
  requestSummary: string;
  @Column({ name: 'result_summary', type: 'text', nullable: true })
  resultSummary: string | null;
  @Column({ name: 'result_json', type: 'jsonb', nullable: true })
  resultJson: object | null;
  @Column({
    name: 'reconciliation_snapshot_json',
    type: 'jsonb',
    nullable: true,
  })
  reconciliationSnapshotJson: ToolReconciliationSnapshot | null;
  @Column({ type: 'integer', default: 1 })
  version: number;
  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
