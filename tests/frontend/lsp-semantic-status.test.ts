import { describe, expect, it } from "vitest";
import { lspSemanticStatusPresentation } from "@/lib/lspSemanticStatus";

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
      }),
    ).toMatchObject({ label: "schema cached", attention: false });
  });
});
