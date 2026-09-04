const { WS_CONTROL_EVENTS, WS_EVENTS } = require("../dist");

describe("WS_EVENTS", () => {
  it("exposes the shared WebSocket event names", () => {
    expect(WS_EVENTS).toEqual({
      CHAT: "chat",
      CANCEL: "cancel",
      RESUME_SESSION: "resume_session",
      CONFIRM_TOOL_EXECUTION: "confirm_tool_execution",
      DISMISS_TOOL_EXECUTION: "dismiss_tool_execution",
      UNDO_TOOL_EXECUTION: "undo_tool_execution",
      AGENT_EVENT: "agent_event",
    });
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
