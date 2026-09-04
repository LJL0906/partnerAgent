import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { ToolRiskLevel } from '@partner-agent/contracts';
import type { ToolAuditRecord } from '../../tools/tool-operation.store.js';

@Entity({ name: 'tool_audit_logs' })
@Index('tool_audits_owner_session_created_idx', [
  'ownerId',
  'sessionId',
  'createdAt',
])
export class ToolAuditEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;
  @Column({ name: 'owner_id', type: 'text' })
  ownerId: string;
  @Column({ name: 'session_id', type: 'text' })
  sessionId: string;
  @Column({ name: 'tool_call_id', type: 'text' })
  toolCallId: string;
  @Column({ name: 'tool_name', type: 'text' })
  toolName: string;
  @Column({ name: 'risk_level', type: 'text' })
  riskLevel: ToolRiskLevel;
  @Column({ type: 'text' })
  action: ToolAuditRecord['action'];
  @Column({ name: 'confirmation_id', type: 'uuid', nullable: true })
  confirmationId: string | null;
  @Column({ name: 'execution_id', type: 'uuid', nullable: true })
  executionId: string | null;
  @Column({ name: 'request_summary', type: 'text', nullable: true })
  requestSummary: string | null;
  @Column({ name: 'result_summary', type: 'text', nullable: true })
  resultSummary: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
