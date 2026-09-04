const {
  ACTION_EXECUTION_STATUSES,
  ACTION_PLAN_STATUSES,
  ACTION_TIMELINESS_STATUSES,
  BUSINESS_OBJECT_ACTIONS,
  CANDIDATE_STATUSES,
  CONFIRMATION_DECISIONS,
  ERRORS,
  GOAL_STATUSES,
  UNDO_BLOCKING_REASON_CODES,
  WS_CONTROL_EVENTS,
} = require("../dist");

describe("Local Core v1 contract constants", () => {
  it("freezes the P0-4 goal and action states", () => {
    expect(GOAL_STATUSES).toEqual([
      "planning",
      "active",
      "completed",
      "paused",
      "abandoned",
      "expired",
    ]);
    expect(ACTION_EXECUTION_STATUSES).toEqual([
      "todo",
      "in_progress",
      "paused",
      "done",
      "cancelled",
    ]);
    expect(ACTION_PLAN_STATUSES).toEqual([
      "normal",
      "rescheduled",
    ]);
    expect(ACTION_TIMELINESS_STATUSES).toEqual([
      "no_deadline",
      "not_due",
      "overdue",
      "not_applicable",
    ]);
  });

  it("uses the persisted candidate lifecycle", () => {
    expect(CANDIDATE_STATUSES).toEqual([
      "pending",
      "confirmed",
      "confirmed_after_edit",
      "cancelled",
      "expired",
    ]);
    expect(CONFIRMATION_DECISIONS).toEqual([
      "confirm",
      "modify_confirm",
      "cancel",
    ]);
    expect(BUSINESS_OBJECT_ACTIONS).toEqual([
      "create",
      "update",
      "status_change",
      "archive",
      "soft_delete",
      "permanent_delete",
      "restore",
      "undo",
    ]);
    expect(BUSINESS_OBJECT_ACTIONS).not.toContain("delete");
  });

  it("exposes non-TTL undo eligibility reasons", () => {
    expect(UNDO_BLOCKING_REASON_CODES).toEqual([
      "not_reversible",
      "version_conflict",
      "incompatible_follow_up",
      "permanent_delete",
      "original_action_not_found",
    ]);
  });

  it("exposes v1 subscription controls", () => {
    expect(WS_CONTROL_EVENTS).toEqual({
      SUBSCRIBE: "subscribe",
      UNSUBSCRIBE: "unsubscribe",
      SUBSCRIPTION_ACK: "subscription_ack",
      PING: "ping",
      PONG: "pong",
    });
  });

  it("exposes the REST scaffold not-implemented error", () => {
    expect(ERRORS.NOT_IMPLEMENTED_001).toBe("NOT_IMPLEMENTED_001");
  });
});
