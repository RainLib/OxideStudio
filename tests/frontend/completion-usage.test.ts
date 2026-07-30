// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  completionUsageScope,
  completionUsageScore,
  recordCompletionUsage,
  resetCompletionUsageCacheForTests,
  usageRankedCompletionSortText,
} from "@/lib/completionUsage";

describe("SQL completion usage ranking", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetCompletionUsageCacheForTests();
  });

  it("persists frequency and recency within the database scope", () => {
    const scope = completionUsageScope([
      "project-1",
      "connection-1",
      "app",
      "public",
      "postgres",
    ]);
    recordCompletionUsage(scope, "users.email", 1_000);
    recordCompletionUsage(scope, "users.email", 2_000);

    expect(completionUsageScore(scope, "USERS.EMAIL", 2_000)).toBe(50);
    expect(completionUsageScore(`${scope}:other`, "users.email", 2_000)).toBe(0);

    resetCompletionUsageCacheForTests();
    expect(completionUsageScore(scope, "users.email", 2_000)).toBe(50);
  });

  it("boosts used candidates without crossing the LSP semantic sort group", () => {
    expect(usageRankedCompletionSortText("2:users.email", 50)).toBe(
      "2:949:users.email",
    );
    expect(usageRankedCompletionSortText("2:users.email", 0)).toBe(
      "2:users.email",
    );
    expect("2:949:users.email" < "2:users.name").toBe(true);
    expect("2:949:users.email" > "1:orders").toBe(true);
  });
});
