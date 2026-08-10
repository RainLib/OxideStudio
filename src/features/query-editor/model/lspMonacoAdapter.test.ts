import { describe, expect, it } from "vitest";
import { shouldApplyLspDiagnostics } from "./lspMonacoAdapter";

describe("LSP Monaco diagnostics adapter", () => {
  it("rejects a versioned diagnostic response for an older LSP document", () => {
    expect(
      shouldApplyLspDiagnostics({
        diagnosticsVersion: 4,
        currentDocumentVersion: 5,
        modelText: "SELECT 2",
        synchronizedText: "SELECT 2",
      }),
    ).toBe(false);
  });

  it("rejects unversioned diagnostics while Monaco is ahead of the LSP shadow", () => {
    expect(
      shouldApplyLspDiagnostics({
        modelText: "SELECT changed",
        synchronizedText: "SELECT previous",
      }),
    ).toBe(false);
  });

  it("keeps diagnostics when the current model and synchronized document agree", () => {
    expect(
      shouldApplyLspDiagnostics({
        diagnosticsVersion: 5,
        currentDocumentVersion: 5,
        modelText: "SELECT valid",
        synchronizedText: "SELECT valid",
      }),
    ).toBe(true);
  });
});
