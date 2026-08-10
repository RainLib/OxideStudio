import { describe, expect, it } from "vitest";
import {
  flattenLspSelectionRanges,
  isPublishDiagnosticsParams,
  lspDiagnosticToMonacoMarker,
  lspDocumentationForMonaco,
  toMonacoRange,
  toMonacoWorkspaceEdit,
} from "@/features/query-editor";
import { DiagnosticSeverity } from "@/services/lsp/types";

class TestRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

function createMonaco(models: Record<string, number> = {}) {
  return {
    Range: TestRange,
    Uri: {
      parse: (uri: string) => ({ uri }),
    },
    editor: {
      getModel: (resource: { uri: string }) => {
        const version = models[resource.uri];
        return version === undefined
          ? null
          : { getVersionId: () => version };
      },
    },
    MarkerSeverity: {
      Error: 8,
      Warning: 4,
      Info: 2,
      Hint: 1,
    },
  };
}

describe("query editor LSP Monaco adapter", () => {
  it("converts zero-based LSP ranges to one-based Monaco ranges", () => {
    expect(
      toMonacoRange(createMonaco(), {
        start: { line: 2, character: 4 },
        end: { line: 3, character: 8 },
      }),
    ).toEqual(new TestRange(3, 5, 4, 9));
  });

  it("preserves workspace edit resources, versions, ranges and text", () => {
    const uri = "file:///project/query.sql";
    const result = toMonacoWorkspaceEdit(createMonaco({ [uri]: 17 }), {
      changes: {
        [uri]: [
          {
            range: {
              start: { line: 0, character: 7 },
              end: { line: 0, character: 12 },
            },
            newText: "accounts",
          },
        ],
      },
    });

    expect(result.edits).toEqual([
      {
        resource: { uri },
        textEdit: {
          range: new TestRange(1, 8, 1, 13),
          text: "accounts",
        },
        versionId: 17,
      },
    ]);
  });

  it("flattens selection ranges from the narrow range to its parents", () => {
    const result = flattenLspSelectionRanges(createMonaco(), {
      range: {
        start: { line: 4, character: 2 },
        end: { line: 4, character: 9 },
      },
      parent: {
        range: {
          start: { line: 3, character: 0 },
          end: { line: 5, character: 1 },
        },
      },
    });

    expect(result).toEqual([
      { range: new TestRange(5, 3, 5, 10) },
      { range: new TestRange(4, 1, 6, 2) },
    ]);
  });

  it("keeps point diagnostics visible and maps severity and metadata", () => {
    const marker = lspDiagnosticToMonacoMarker(createMonaco(), {
      range: {
        start: { line: 6, character: 3 },
        end: { line: 6, character: 3 },
      },
      severity: DiagnosticSeverity.Error,
      code: 42601,
      message: "syntax error",
      source: "sqls",
    });

    expect(marker).toEqual({
      severity: 8,
      code: "42601",
      message: "syntax error",
      source: "sqls",
      startLineNumber: 7,
      startColumn: 4,
      endLineNumber: 7,
      endColumn: 5,
    });
  });

  it("normalizes documentation and validates publish-diagnostics payloads", () => {
    expect(lspDocumentationForMonaco("plain text")).toBe("plain text");
    expect(lspDocumentationForMonaco({ value: "plaintext by default" })).toBe(
      "plaintext by default",
    );
    expect(
      lspDocumentationForMonaco({ kind: "markdown", value: "**markdown**" }),
    ).toEqual({
      value: "**markdown**",
      isTrusted: false,
      supportHtml: false,
    });
    expect(lspDocumentationForMonaco({})).toBeUndefined();

    expect(
      isPublishDiagnosticsParams({ uri: "file:///query.sql", diagnostics: [] }),
    ).toBe(true);
    expect(isPublishDiagnosticsParams({ diagnostics: [] })).toBe(false);
    expect(isPublishDiagnosticsParams(null)).toBe(false);
  });
});
