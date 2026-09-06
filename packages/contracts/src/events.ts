import type {
  AnalysisTaskRef,
  PrivacyDecisionStatus,
  ResourceRef,
  TaskStatus,
} from './local-core.js';
import type { SessionMessageDto } from './local-core-queries.js';

/** 正式 v1 服务端推送事件名。 */
export const WS_SERVER_EVENTS = {
  AGENT_EVENT: "agent_event",
} as const;

/** v1 WebSocket 只承载订阅控制与服务端推送，业务 Command 走 REST。 */
export const WS_CONTROL_EVENTS = {
  SUBSCRIBE: "subscribe",
  UNSUBSCRIBE: "unsubscribe",
  SUBSCRIPTION_ACK: "subscription_ack",
  CONFIRM_TOOL_EXECUTION: "confirm_tool_execution",
  DISMISS_TOOL_EXECUTION: "dismiss_tool_execution",
  UNDO_TOOL_EXECUTION: "undo_tool_execution",
  TOOL_CONTROL_ACK: "tool_control_ack",
  PING: "ping",
  PONG: "pong",
} as const;

export type SubscriptionChannel =
  | `task:${string}`
  | `operation:${string}`
  | `session:${string}`
  | "user:self";

export interface SubscribeRequestV1 {
  request_id: string;
  channels: SubscriptionChannel[];
  /** channel -> last event_id，用于断线续传。 */
  after?: Partial<Record<SubscriptionChannel, string>>;
}

export interface UnsubscribeRequestV1 {
  request_id: string;
  channels: SubscriptionChannel[];
}

export interface SubscriptionRejectionV1 {
  channel: string;
  code: string;
  message: string;
}

export interface SubscriptionAckV1 {
  request_id: string;
  accepted: SubscriptionChannel[];
  rejected: SubscriptionRejectionV1[];
}

export interface PingRequestV1 {
  request_id: string;
  timestamp: number;
}

export interface PongResponseV1 extends PingRequestV1 {}

/**
 * v1 外部工具副作用控制命令。它们只处理 Tool Approval，不得用于正式业务对象确认。
 * 所有资源标识均由服务端结合 JWT owner 与 session 所有权重新校验。
 */
export interface ToolConfirmationControlRequestV1 {
  request_id: string;
  session_id: string;
  confirmation_id: string;
}

export interface ToolUndoControlRequestV1 {
  request_id: string;
  session_id: string;
  execution_id: string;
}

export type ToolControlActionV1 = "confirm" | "dismiss" | "undo";

export interface ToolControlAckV1 {
  request_id: string;
  action: ToolControlActionV1;
  status: "completed" | "rejected";
  error?: {
    code: string;
    message: string;
  };
}

/** @deprecated history 与 REST 恢复现在共用 SessionMessageDto。 */
export type SessionMessageV1 = SessionMessageDto;

export type ServerPushEventTypeV1 =
  | "text_delta"
  | "thinking_delta"
  | "todo_update"
  | "history"
  | "tool_execution_start"
  | "tool_execution_end"
  | "tool_confirmation_pending"
  | "tool_confirmation_confirmed"
  | "tool_confirmation_dismissed"
  | "tool_undo_available"
  | "tool_undo_completed"
  | "candidate"
  | "reminder"
  | "summary"
  | "task_state"
  | "cancelled"
  | "done"
  | "error"
  | "recovery_required";

export interface ServerPushEventBaseV1<T extends ServerPushEventTypeV1, D> {
  schema_version: 1;
  event_id: string;
  channel: SubscriptionChannel;
  sequence: number;
  session_id?: string;
  operation_id?: string;
  task_id?: string;
  event_type: T;
  timestamp: number;
  data: D;
}

/** 展示项修订独立于每频道 sequence；多频道广播使用同一 item_id/revision。 */
export interface DisplayItemRevisionV1 {
  item_id: string;
  item_revision: number;
}

/** text_offset 是追加前正文的 JavaScript UTF-16 code unit 长度。 */
export interface TextAppendPositionV1 extends DisplayItemRevisionV1 {
  text_offset: number;
}

export type TextDeltaEventV1 = ServerPushEventBaseV1<"text_delta", string>
  & TextAppendPositionV1
  & { message_id: string };
export type ThinkingDeltaEventV1 = ServerPushEventBaseV1<"thinking_delta", string>
  & TextAppendPositionV1;
export type TaskTodoStatusV1 = "pending" | "in_progress" | "completed";
export interface TaskTodoItemV1 {
  id: string;
  content: string;
  status: TaskTodoStatusV1;
}
export type TodoUpdateEventV1 = ServerPushEventBaseV1<
  "todo_update",
  { items: TaskTodoItemV1[] }
> & { task_id: string };
export type SessionHistoryEventV1 = ServerPushEventBaseV1<
  "history",
  { messages: SessionMessageV1[] }
>;
export type ToolExecutionStartEventV1 = ServerPushEventBaseV1<
  "tool_execution_start",
  { tool: string; tool_call_id: string }
> & DisplayItemRevisionV1;
export type ToolExecutionEndEventV1 = ServerPushEventBaseV1<
  "tool_execution_end",
  {
    tool: string;
    tool_call_id: string;
    success: boolean;
    execution_id?: string;
    undo_available?: boolean;
    undo_expires_at?: number;
  }
> & DisplayItemRevisionV1;

export type ToolRiskLevel = "read_only" | "low" | "medium" | "high";

export type ToolConfirmationPendingEventV1 = ServerPushEventBaseV1<
  "tool_confirmation_pending",
  {
    confirmation_id: string;
    tool: string;
    tool_call_id: string;
    risk_level: ToolRiskLevel;
    request_summary: string;
    expires_at: number;
  }
> & DisplayItemRevisionV1;

/**
 * 上述 tool_confirmation/tool_undo 推送只描述外部工具副作用的 Tool Approval，
 * 不得用于正式业务对象的 Confirmation Batch 或撤销。
 */
export type ToolConfirmationConfirmedEventV1 = ServerPushEventBaseV1<
  "tool_confirmation_confirmed",
  { confirmation_id: string; tool: string; tool_call_id: string }
> & DisplayItemRevisionV1;
export type ToolConfirmationDismissedEventV1 = ServerPushEventBaseV1<
  "tool_confirmation_dismissed",
  {
    confirmation_id: string;
    tool: string;
    tool_call_id: string;
    reason: "user_dismissed" | "expired";
  }
> & DisplayItemRevisionV1;
export type ToolUndoAvailableEventV1 = ServerPushEventBaseV1<
  "tool_undo_available",
  { execution_id: string; tool: string; tool_call_id: string; expires_at: number }
> & DisplayItemRevisionV1;
export type ToolUndoCompletedEventV1 = ServerPushEventBaseV1<
  "tool_undo_completed",
  { execution_id: string; tool: string; tool_call_id: string; success: boolean }
> & DisplayItemRevisionV1;
export type CandidateEventV1 = ServerPushEventBaseV1<
  "candidate",
  {
    analysis_ref: ResourceRef & { kind: 'analysis_run' };
    batch_ref: ResourceRef & { kind: 'confirmation_batch' };
    candidate_refs: Array<ResourceRef & { kind: 'candidate' }>;
    task_ref: AnalysisTaskRef;
    candidate_count: number;
    risk_level: 'normal' | 'high';
    /** 已过滤敏感信息的短摘要；完整候选只能通过 REST 查询。 */
    safe_summary: string;
    occurred_at: number;
  }
> & { task_id: string } & DisplayItemRevisionV1;
export type ReminderEventV1 = ServerPushEventBaseV1<
  "reminder",
  { reminder_instance_id: string }
> & DisplayItemRevisionV1;
export type SummaryEventV1 = ServerPushEventBaseV1<
  "summary",
  { summary_id: string; summary_kind: "daily" | "weekly" }
> & DisplayItemRevisionV1;
export type TaskStateEventV1 = ServerPushEventBaseV1<
  "task_state",
  {
    state: TaskStatus['state'];
    error_code?: string;
    message?: string;
    /** 仅 waiting_privacy_decision 状态携带的无明文恢复摘要。 */
    privacy_decision?: PrivacyDecisionStatus;
  }
> & DisplayItemRevisionV1;
export type AgentCancelledEventV1 = ServerPushEventBaseV1<"cancelled", Record<string, never>>;
export type AgentDoneEventV1 = ServerPushEventBaseV1<"done", Record<string, never>>;
export type AgentErrorEventV1 = ServerPushEventBaseV1<
  "error",
  { code: string; message: string }
> & DisplayItemRevisionV1;
export type RecoveryRequiredEventV1 = ServerPushEventBaseV1<
  "recovery_required",
  { reason: "event_expired"; query_url?: string }
>;

/** v1 唯一公开的服务端推送信封；线协议字段统一使用 snake_case。 */
export type ServerPushEventV1 =
  | TextDeltaEventV1
  | ThinkingDeltaEventV1
  | TodoUpdateEventV1
  | SessionHistoryEventV1
  | ToolExecutionStartEventV1
  | ToolExecutionEndEventV1
  | ToolConfirmationPendingEventV1
  | ToolConfirmationConfirmedEventV1
  | ToolConfirmationDismissedEventV1
  | ToolUndoAvailableEventV1
  | ToolUndoCompletedEventV1
  | CandidateEventV1
  | ReminderEventV1
  | SummaryEventV1
  | TaskStateEventV1
  | AgentCancelledEventV1
  | AgentDoneEventV1
  | AgentErrorEventV1
  | RecoveryRequiredEventV1;

/** Agent 内部会话消息；不是 WebSocket wire contract。 */
export interface SessionMessage {
  role: "user" | "assistant" | "system";
  metadata?: Record<string, unknown>;
  content: string;
  timestamp: number;
}
