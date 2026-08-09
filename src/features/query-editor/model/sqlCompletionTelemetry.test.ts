import { beforeEach, describe, expect, it } from "vitest";
import {
  recordSqlCompletionTelemetry,
  resetSqlCompletionTelemetryForTests,
  sqlCompletionTelemetrySnapshot,
} from "./sqlCompletionTelemetry";

describe("SQL completion telemetry", () => {
  beforeEach(resetSqlCompletionTelemetryForTests);

  it("aggregates content-free outcomes and latency", () => {
    recordSqlCompletionTelemetry({
      scope: "project/connection",
      outcome: "lsp",
      durationMs: 10,
      suggestionCount: 8,
    });
    recordSqlCompletionTelemetry({
      scope: "project/connection",
      outcome: "discarded",
      durationMs: 30,
      suggestionCount: 0,
      reason: "modelChanged",
    });

    expect(sqlCompletionTelemetrySnapshot("project/connection")).toMatchObject({
      requests: 2,
      lsp: 1,
      discarded: 1,
      averageDurationMs: 20,
      p95DurationMs: 30,
      reasons: { modelChanged: 1 },
    });
  });
});
