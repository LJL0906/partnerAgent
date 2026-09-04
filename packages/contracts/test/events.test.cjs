const { WS_EVENTS } = require("../dist");

describe("WS_EVENTS", () => {
  it("exposes the shared WebSocket event names", () => {
    expect(WS_EVENTS).toEqual({
      CHAT: "chat",
      CANCEL: "cancel",
      RESUME_SESSION: "resume_session",
      AGENT_EVENT: "agent_event",
    });
  });
});
