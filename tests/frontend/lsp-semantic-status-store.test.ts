import { beforeEach, describe, expect, it } from "vitest";
import {
  resetLspSemanticStatusStoreForTests,
  useLspSemanticStatusStore,
} from "@/store/useLspSemanticStatusStore";

describe("LSP semantic status telemetry", () => {
  beforeEach(resetLspSemanticStatusStoreForTests);

  it("counts stale responses and sync failures without storing query content", () => {
    const store = useLspSemanticStatusStore.getState();
    store.setStatus("connection-a", {
      state: "full",
      totalObjects: 2,
      cacheHits: 1,
      cacheMisses: 1,
      failedObjects: 0,
    });
    store.recordTelemetry("connection-a", "stale");
    store.recordTelemetry("connection-a", "syncFailure");
    store.recordTelemetry("connection-a", "restart", 143.6);

    const status = useLspSemanticStatusStore.getState().byConnectionId["connection-a"];
    expect(status?.telemetry).toMatchObject({
      staleResponses: 1,
      syncFailures: 1,
      restarts: 1,
      lastRecoveryMs: 144,
    });
    expect(JSON.stringify(status)).not.toContain("SELECT");
  });
});
