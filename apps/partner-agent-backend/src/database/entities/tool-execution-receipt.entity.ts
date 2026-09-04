import { Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';
import type { ToolExecutionReceipt } from '../../tools/tool-operation.store.js';

@Entity({ name: 'tool_execution_receipts' })
@Index('tool_receipts_owner_session_idx', ['ownerId', 'sessionId'])
@Unique('tool_receipts_owner_confirmation_key', ['ownerId', 'confirmationId'])
export class ToolExecutionReceiptEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;
  @Column({ name: 'confirmation_id', type: 'uuid', unique: true })
  confirmationId: string;
  @Column({ name: 'owner_id', type: 'text' })
  ownerId: string;
  @Column({ name: 'session_id', type: 'text' })
  sessionId: string;
  @Column({ name: 'tool_name', type: 'text' })
  toolName: string;
  @Column({ name: 'undo_payload_json', type: 'text' })
  undoPayloadJson: string;
  @Column({ type: 'text' })
  status: ToolExecutionReceipt['status'];
  @Column({ name: 'applied_at', type: 'timestamptz' })
  appliedAt: Date;
  @Column({ name: 'undo_expires_at', type: 'timestamptz' })
  undoExpiresAt: Date;
}
