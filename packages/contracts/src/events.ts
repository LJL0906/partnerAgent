export const WS_EVENTS = {
  CHAT: "chat",
  CANCEL: "cancel",
  RESUME_SESSION: "resume_session",
  AGENT_EVENT: "agent_event",
} as const;

export interface SessionRequest {
  sessionId: string;
  userId?: string;
}

export interface ChatRequest extends SessionRequest {
  message: string;
}

export interface CancelRequest {
  sessionId: string;
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
  };
}

export type AgentEvent =
  | TextDeltaEvent
  | AgentDoneEvent
  | AgentErrorEvent
  | AgentCancelledEvent
  | SessionHistoryEvent
  | ToolExecutionStartEvent
  | ToolExecutionEndEvent;
