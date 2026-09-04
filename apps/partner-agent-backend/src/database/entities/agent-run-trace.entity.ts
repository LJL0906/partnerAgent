import { Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

@Entity({ name: 'agent_run_trace_events' })
@Unique('agent_run_trace_events_run_sequence_key', ['runId', 'sequence'])
@Index('agent_run_trace_events_owner_created_idx', ['ownerId', 'createdAt'])
@Index('agent_run_trace_events_owner_run_created_idx', [
  'ownerId',
  'runId',
  'createdAt',
])
export class AgentRunTraceEntity {
  @PrimaryColumn({ type: 'uuid' }) id: string;
  @Column({ name: 'run_id', type: 'uuid' }) runId: string;
  @Column({ type: 'integer' }) sequence: number;
  @Column({ name: 'owner_id', type: 'text' }) ownerId: string;
  @Column({ name: 'session_id', type: 'text' }) sessionId: string;
  @Column({ name: 'task_id', type: 'text', nullable: true }) taskId:
    string | null;
  @Column({ name: 'operation_id', type: 'text', nullable: true }) operationId:
    string | null;
  @Column({ name: 'request_id', type: 'uuid', nullable: true }) requestId:
    string | null;
  @Column({ name: 'tool_call_id', type: 'text', nullable: true }) toolCallId:
    string | null;
  @Column({ type: 'text' }) source: string;
  @Column({ name: 'event_type', type: 'text' }) eventType: string;
  @Column({ type: 'text', nullable: true }) status: string | null;
  @Column({ type: 'text', nullable: true }) provider: string | null;
  @Column({ name: 'model_id', type: 'text', nullable: true }) modelId:
    string | null;
  @Column({ name: 'tool_name', type: 'text', nullable: true }) toolName:
    string | null;
  @Column({ name: 'duration_ms', type: 'integer', nullable: true }) durationMs:
    number | null;
  @Column({ name: 'input_tokens', type: 'integer', nullable: true })
  inputTokens: number | null;
  @Column({ name: 'output_tokens', type: 'integer', nullable: true })
  outputTokens: number | null;
  @Column({ name: 'total_tokens', type: 'integer', nullable: true })
  totalTokens: number | null;
  @Column({ name: 'model_turns', type: 'integer', nullable: true }) modelTurns:
    number | null;
  @Column({ name: 'tool_calls', type: 'integer', nullable: true }) toolCalls:
    number | null;
  @Column({ name: 'output_token_budget', type: 'integer', nullable: true })
  outputTokenBudget: number | null;
  @Column({ name: 'deadline_ms', type: 'integer', nullable: true }) deadlineMs:
    number | null;
  @Column({ name: 'error_code', type: 'text', nullable: true }) errorCode:
    string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
