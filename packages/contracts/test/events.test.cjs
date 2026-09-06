const contracts = require("../dist");
const { WS_CONTROL_EVENTS, WS_SERVER_EVENTS } = contracts;
const { isServerPushEventV1 } = contracts;

describe("legacy Agent WebSocket contract", () => {
  it("does not export the removed request event map", () => {
    expect(contracts.WS_EVENTS).toBeUndefined();
  });
});

describe("todo_update", () => {
  const event = {
    schema_version: 1, event_id: "todo-1", channel: "task:task-1", sequence: 1,
    session_id: "session-1", task_id: "task-1", event_type: "todo_update",
    timestamp: 1, data: { items: [
      { id: "step-1", content: "分析需求", status: "in_progress" },
      { id: "step-2", content: "验证结果", status: "pending" },
    ] },
  };

  it("accepts a scoped todo snapshot and rejects ambiguous progress", () => {
    expect(isServerPushEventV1(event)).toBe(true);
    expect(isServerPushEventV1({ ...event, data: { items: event.data.items.map((item) => ({ ...item, status: "in_progress" })) } })).toBe(false);
  });
});

describe("WS_SERVER_EVENTS", () => {
  it("exposes the formal v1 server push event independently", () => {
    expect(WS_SERVER_EVENTS).toEqual({ AGENT_EVENT: "agent_event" });
  });
});

describe("WS_CONTROL_EVENTS", () => {
  it("exposes subscription and external tool control event names", () => {
    expect(WS_CONTROL_EVENTS).toEqual({
      SUBSCRIBE: "subscribe",
      UNSUBSCRIBE: "unsubscribe",
      SUBSCRIPTION_ACK: "subscription_ack",
      CONFIRM_TOOL_EXECUTION: "confirm_tool_execution",
      DISMISS_TOOL_EXECUTION: "dismiss_tool_execution",
      UNDO_TOOL_EXECUTION: "undo_tool_execution",
      TOOL_CONTROL_ACK: "tool_control_ack",
      PING: "ping",
      PONG: "pong",
    });
  });
});
