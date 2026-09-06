const contracts = require("../dist");
const { WS_CONTROL_EVENTS, WS_SERVER_EVENTS } = contracts;

describe("legacy Agent WebSocket contract", () => {
  it("does not export the removed request event map", () => {
    expect(contracts.WS_EVENTS).toBeUndefined();
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
