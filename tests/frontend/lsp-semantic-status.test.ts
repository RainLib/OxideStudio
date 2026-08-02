import { describe, expect, it } from "vitest";
import { lspSemanticStatusPresentation } from "@/lib/lspSemanticStatus";

const telemetry = { staleResponses: 0, syncFailures: 0, restarts: 0 };

describe("LSP semantic status presentation", () => {
  it("keeps a syncing schema distinct from a ready language-service process", () => {
    expect(
      lspSemanticStatusPresentation({
        state: "syncing",
        totalObjects: 0,
        cacheHits: 0,
        cacheMisses: 0,
        failedObjects: 0,
        updatedAt: 1,
        telemetry,
      }),
    ).toMatchObject({ label: "schema syncing", attention: true });
  });

  it("surfaces partial metadata failures without hiding fallback completion", () => {
    expect(
      lspSemanticStatusPresentation({
        state: "limited",
        totalObjects: 8,
        cacheHits: 2,
        cacheMisses: 6,
        failedObjects: 1,
        updatedAt: 1,
        telemetry,
      }),
    ).toMatchObject({ label: "schema limited", attention: true });
  });

  it("describes cached metadata as ready", () => {
    expect(
      lspSemanticStatusPresentation({
        state: "cached",
        totalObjects: 4,
        cacheHits: 4,
        cacheMisses: 0,
        failedObjects: 0,
        updatedAt: 1,
        telemetry,
      }),
    ).toMatchObject({ label: "schema cached", attention: false });
  });

  it("adds privacy-bounded recovery telemetry to the status-bar title", () => {
    const presentation = lspSemanticStatusPresentation({
      state: "full", totalObjects: 1, cacheHits: 0, cacheMisses: 1,
      failedObjects: 0, updatedAt: 1,
      telemetry: { staleResponses: 2, syncFailures: 1, restarts: 1, lastRecoveryMs: 42 },
    });
    expect(presentation?.title).toContain("1 restart · 2 stale syncs · 1 sync failure · last recovery 42ms");
  });
});
