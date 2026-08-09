import { describe, expect, it } from "vitest";
import {
  completionFilterTextForQuery,
  completionMatchScore,
  completionMatches,
  ensurePinyinCompletionSupport,
  pinyinInitials,
} from "./completionMatch";

describe("SQL completion matching", () => {
  it("matches Chinese identifiers by full and skipped pinyin initials", async () => {
    await ensurePinyinCompletionSupport();
    expect(pinyinInitials("总租金")).toBe("zzj");
    expect(completionMatches("总租金", "zzj")).toBe(true);
    expect(completionMatches("总租金", "zj")).toBe(true);
    expect(completionMatches("租赁日期", "zlrq")).toBe(true);
    expect(completionMatches("租赁日期", "zzj")).toBe(false);
  });

  it("keeps prefix, camel-case and fuzzy identifier matching ordered", () => {
    expect(completionMatchScore("order_id", "order")).toBeGreaterThan(
      completionMatchScore("customer_order", "order"),
    );
    expect(completionMatches("userProfile", "up")).toBe(true);
    expect(completionMatches("created_at", "id")).toBe(false);
  });

  it("lets Monaco retain a pinyin match", () => {
    expect(completionFilterTextForQuery("总租金", "zzj")).toBe("zzj");
    expect(completionFilterTextForQuery("order_id", "order")).toBeUndefined();
  });
});
