import type {
  AnalysisTaskRef,
  PrivacyDecisionStatus,
  ResourceRef,
  TaskStatus,
} from './local-core.js';

/**
 * @deprecated 旧 Socket.IO request/response 事件名，仅供兼容层使用。
 * v1 客户端只能发送 WS_CONTROL_EVENTS 中的订阅控制事件，业务 Command 走 REST。
 */
export const WS_EVENTS = {
  CHAT: "chat",
  CANCEL: "cancel",
  RESUME_SESSION: "resume_session",
  CONFIRM_TOOL_EXECUTION: "confirm_tool_execution",
  DISMISS_TOOL_EXECUTION: "dismiss_tool_execution",
  UNDO_TOOL_EXECUTION: "undo_tool_execution",
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

export interface SessionMessageV1 {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export type ServerPushEventTypeV1 =
  | "text_delta"
  | "thinking_delta"
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

export type TextDeltaEventV1 = ServerPushEventBaseV1<"text_delta", string>;
export type ThinkingDeltaEventV1 = ServerPushEventBaseV1<"thinking_delta", string>;
export type SessionHistoryEventV1 = ServerPushEventBaseV1<
  "history",
  { messages: SessionMessageV1[] }
>;
export type ToolExecutionStartEventV1 = ServerPushEventBaseV1<
  "tool_execution_start",
  { tool: string; tool_call_id: string }
>;
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
>;

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
>;

/**
 * 上述 tool_confirmation/tool_undo 推送只描述外部工具副作用的 Tool Approval，
 * 不得用于正式业务对象的 Confirmation Batch 或撤销。
 */
export type ToolConfirmationConfirmedEventV1 = ServerPushEventBaseV1<
  "tool_confirmation_confirmed",
  { confirmation_id: string; tool: string; tool_call_id: string }
>;
export type ToolConfirmationDismissedEventV1 = ServerPushEventBaseV1<
  "tool_confirmation_dismissed",
  {
    confirmation_id: string;
    tool: string;
    tool_call_id: string;
    reason: "user_dismissed" | "expired";
  }
>;
export type ToolUndoAvailableEventV1 = ServerPushEventBaseV1<
  "tool_undo_available",
  { execution_id: string; tool: string; expires_at: number }
>;
export type ToolUndoCompletedEventV1 = ServerPushEventBaseV1<
  "tool_undo_completed",
  { execution_id: string; tool: string; success: boolean }
>;
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
> & { task_id: string };
export type ReminderEventV1 = ServerPushEventBaseV1<
  "reminder",
  { reminder_instance_id: string }
>;
export type SummaryEventV1 = ServerPushEventBaseV1<
  "summary",
  { summary_id: string; summary_kind: "daily" | "weekly" }
>;
export type TaskStateEventV1 = ServerPushEventBaseV1<
  "task_state",
  {
    state: TaskStatus['state'];
    error_code?: string;
    message?: string;
    /** 仅 waiting_privacy_decision 状态携带的无明文恢复摘要。 */
    privacy_decision?: PrivacyDecisionStatus;
  }
>;
export type AgentCancelledEventV1 = ServerPushEventBaseV1<"cancelled", Record<string, never>>;
export type AgentDoneEventV1 = ServerPushEventBaseV1<"done", Record<string, never>>;
export type AgentErrorEventV1 = ServerPushEventBaseV1<
  "error",
  { code: string; message: string }
>;
export type RecoveryRequiredEventV1 = ServerPushEventBaseV1<
  "recovery_required",
  { reason: "event_expired"; query_url?: string }
>;

/** v1 唯一公开的服务端推送信封；线协议字段统一使用 snake_case。 */
export type ServerPushEventV1 =
  | TextDeltaEventV1
  | ThinkingDeltaEventV1
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

/** @deprecated 旧 Socket.IO 请求契约；v1 业务 Command 请改走 REST。 */
export interface SessionRequest {
  sessionId: string;
}

export interface ChatRequest extends SessionRequest {
  message: string;
}

export interface CancelRequest {
  sessionId: string;
}

export interface ToolConfirmationRequest extends SessionRequest {
  confirmationId: string;
}

export interface ToolUndoRequest extends SessionRequest {
  executionId: string;
}

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface AgentEventBase {
  type: string;
  sessionId: string;
  timestamp: number;
}

export interface TextDeltaEvent extends AgentEventBase {
  type: "text_delta";
  data: string;
}

export interface ThinkingDeltaEvent extends AgentEventBase {
  type: "thinking_delta";
  data: string;
}

export interface AgentDoneEvent extends AgentEventBase {
  type: "done";
}

export interface AgentErrorEvent extends AgentEventBase {
  type: "error";
  data: {
    message: string;
  };
}

export interface AgentCancelledEvent extends AgentEventBase {
  type: "cancelled";
}

export interface SessionHistoryEvent extends AgentEventBase {
  type: "history";
  data: {
    messages: SessionMessage[];
  };
}

export interface ToolExecutionStartEvent extends AgentEventBase {
  type: "tool_execution_start";
  data: {
    tool: string;
    toolCallId: string;
  };
}

export interface ToolExecutionEndEvent extends AgentEventBase {
  type: "tool_execution_end";
  data: {
    tool: string;
    toolCallId: string;
    success: boolean;
    executionId?: string;
    undoAvailable?: boolean;
    undoExpiresAt?: number;
  };
}

export interface ToolConfirmationPendingEvent extends AgentEventBase {
  type: "tool_confirmation_pending";
  data: {
    confirmationId: string;
    tool: string;
    toolCallId: string;
    riskLevel: ToolRiskLevel;
    requestSummary: string;
    expiresAt: number;
  };
}

export interface ToolConfirmationConfirmedEvent extends AgentEventBase {
  type: "tool_confirmation_confirmed";
  data: { confirmationId: string; tool: string; toolCallId: string };
}

export interface ToolConfirmationDismissedEvent extends AgentEventBase {
  type: "tool_confirmation_dismissed";
  data: {
    confirmationId: string;
    tool: string;
    toolCallId: string;
    reason: "user_dismissed" | "expired";
  };
}

export interface ToolUndoAvailableEvent extends AgentEventBase {
  type: "tool_undo_available";
  data: { executionId: string; tool: string; expiresAt: number };
}

export interface ToolUndoCompletedEvent extends AgentEventBase {
  type: "tool_undo_completed";
  data: { executionId: string; tool: string; success: boolean };
}

/** @deprecated 旧 camelCase/type 推送契约；新代码使用 ServerPushEventV1。 */
export type AgentEvent =
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | AgentDoneEvent
  | AgentErrorEvent
  | AgentCancelledEvent
  | SessionHistoryEvent
  | ToolExecutionStartEvent
  | ToolExecutionEndEvent
  | ToolConfirmationPendingEvent
  | ToolConfirmationConfirmedEvent
  | ToolConfirmationDismissedEvent
  | ToolUndoAvailableEvent
  | ToolUndoCompletedEvent;
