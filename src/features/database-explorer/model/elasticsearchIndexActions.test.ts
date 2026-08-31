import { describe, expect, it } from "vitest";
import {
  isPartialSearchIndexClear,
  matchesElasticsearchIndexPattern,
  searchIndexClearTouched,
} from "./elasticsearchIndexActions";

describe("Elasticsearch index actions", () => {
  it("matches grouped wildcard targets without treating regex syntax specially", () => {
    expect(matchesElasticsearchIndexPattern("logs-2026.*", "logs-2026.08")).toBe(true);
    expect(matchesElasticsearchIndexPattern("logs-????.08", "logs-2026.08")).toBe(true);
    expect(matchesElasticsearchIndexPattern("logs-2026.*", "logs-2025.08")).toBe(false);
    expect(matchesElasticsearchIndexPattern("metrics[1]*", "metrics1-prod")).toBe(false);
  });

  it("refreshes only document tabs touched by the clear target", () => {
    expect(searchIndexClearTouched("orders", "orders")).toBe(true);
    expect(searchIndexClearTouched("orders", "orders-archive")).toBe(false);
    expect(searchIndexClearTouched("logs-*", "logs-2026.08")).toBe(true);
    expect(searchIndexClearTouched("logs-*", "metrics-2026.08")).toBe(false);
  });

  it("reports timeout, failures, conflicts, and skipped matches as partial", () => {
    const complete = {
      total: 4,
      deleted: 4,
      versionConflicts: 0,
      timedOut: false,
      failures: [],
    };
    expect(isPartialSearchIndexClear(complete)).toBe(false);
    expect(isPartialSearchIndexClear({ ...complete, deleted: 3 })).toBe(true);
    expect(isPartialSearchIndexClear({ ...complete, versionConflicts: 1 })).toBe(true);
    expect(isPartialSearchIndexClear({ ...complete, timedOut: true })).toBe(true);
    expect(isPartialSearchIndexClear({ ...complete, failures: ["shard"] })).toBe(true);
  });
});
