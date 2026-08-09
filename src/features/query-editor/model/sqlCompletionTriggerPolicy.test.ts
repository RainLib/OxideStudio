import { describe, expect, it } from "vitest";
import { sqlCompletionTriggerDecision } from "./sqlCompletionTriggerPolicy";

describe("SQL completion trigger policy", () => {
  it("keeps explicit completion available in every mode", () => {
    expect(sqlCompletionTriggerDecision("manual", "SELECT ", true)).toEqual({
      allowed: true,
      reason: "explicit",
    });
  });

  it("requires a prefix or qualifier in prefix mode", () => {
    expect(sqlCompletionTriggerDecision("require-prefix", "SELECT cus", false).allowed).toBe(true);
    expect(sqlCompletionTriggerDecision("require-prefix", "SELECT c.", false).reason).toBe("qualifier");
    expect(sqlCompletionTriggerDecision("require-prefix", "SELECT ", false).allowed).toBe(false);
  });

  it("opens automatically at meaningful SQL positions", () => {
    expect(sqlCompletionTriggerDecision("positional", "SELECT ", false).reason).toBe("position");
    expect(sqlCompletionTriggerDecision("positional", "WHERE amount = ", false).reason).toBe("position");
    expect(sqlCompletionTriggerDecision("positional", "SELECT amount ", false).allowed).toBe(false);
  });

  it("never completes inside comments or string literals", () => {
    expect(sqlCompletionTriggerDecision("positional", "SELECT '-- fro", true).reason).toBe("suppressed");
    expect(sqlCompletionTriggerDecision("positional", "SELECT 1 -- fro", true).reason).toBe("suppressed");
    expect(sqlCompletionTriggerDecision("positional", "SELECT /* fro", false).reason).toBe("suppressed");
  });
});
