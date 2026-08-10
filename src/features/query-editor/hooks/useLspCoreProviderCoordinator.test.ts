import { describe, expect, it, vi } from "vitest";
import type { LspClient } from "@/services/lsp";
import { registerLspCoreProviders } from "./useLspCoreProviderCoordinator";

function coordinatorFixture() {
  const providers = new Map<string, any>();
  const disposed: string[] = [];
  const register = (name: string) =>
    vi.fn((_language: string, provider: any) => {
      providers.set(name, provider);
      return { dispose: () => disposed.push(name) };
    });
  const monaco = {
    languages: {
      registerDefinitionProvider: register("definition"),
      registerReferenceProvider: register("reference"),
      registerDocumentFormattingEditProvider: register("format"),
      registerDocumentRangeFormattingEditProvider: register("rangeFormat"),
      registerSignatureHelpProvider: register("signature"),
      registerRenameProvider: register("rename"),
      registerCodeActionProvider: register("codeAction"),
      registerDocumentSymbolProvider: register("symbol"),
      registerFoldingRangeProvider: register("folding"),
      registerSelectionRangeProvider: register("selection"),
      registerDocumentSemanticTokensProvider: register("semanticTokens"),
      registerInlayHintsProvider: register("inlayHints"),
      InlayHintKind: { Type: 1, Parameter: 2 },
    },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
    Uri: { parse: (value: string) => value },
    Range: class Range {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
  };
  const lspClient = {
    getReferences: vi.fn(async () => []),
    rename: vi.fn(async () => null),
    getCodeActions: vi.fn(async () => []),
    getInlayHints: vi.fn(async () => []),
  } as unknown as LspClient;

  const coordinator = registerLspCoreProviders({
    activeProjectId: "project-1",
    canUseLsp: true,
    documentUri: "oxide://query/active.postgres.sql",
    editorLanguageId: "pgsql",
    lspClient,
    monaco,
  });
  return { coordinator, disposed, lspClient, monaco, providers };
}

describe("LSP core provider coordinator", () => {
  it("registers and disposes the stable provider set as one lifecycle", () => {
    const { coordinator, disposed, providers } = coordinatorFixture();

    expect([...providers.keys()]).toEqual([
      "definition",
      "reference",
      "format",
      "rangeFormat",
      "signature",
      "rename",
      "codeAction",
      "symbol",
      "folding",
      "selection",
      "semanticTokens",
      "inlayHints",
    ]);

    coordinator.dispose();
    expect(disposed).toEqual([...providers.keys()]);
  });

  it("rejects provider calls from stale Monaco documents", async () => {
    const { lspClient, monaco, providers } = coordinatorFixture();
    const staleModel = {
      uri: { toString: () => "oxide://query/stale.postgres.sql" },
    };
    const activeModel = {
      uri: { toString: () => "oxide://query/active.postgres.sql" },
    };
    const position = { lineNumber: 3, column: 7 };

    await expect(
      providers.get("reference").provideReferences(staleModel, position),
    ).resolves.toEqual([]);
    expect(lspClient.getReferences).not.toHaveBeenCalled();

    await providers.get("reference").provideReferences(activeModel, position);
    expect(lspClient.getReferences).toHaveBeenCalledWith(
      "oxide://query/active.postgres.sql",
      2,
      6,
    );

    await expect(
      providers
        .get("rename")
        .provideRenameEdits(staleModel, position, "renamed"),
    ).resolves.toEqual({
      edits: [],
      rejectReason: "Database LSP is not active for this document.",
    });
    expect(lspClient.rename).not.toHaveBeenCalled();
    expect(monaco.languages.registerRenameProvider).toHaveBeenCalledTimes(1);
  });

  it("forwards an explicit code-action kind to avoid unrelated source work", async () => {
    const { lspClient, monaco, providers } = coordinatorFixture();
    const activeModel = {
      uri: { toString: () => "oxide://query/active.postgres.sql" },
    };
    const range = new monaco.Range(2, 3, 2, 3);

    await providers.get("codeAction").provideCodeActions(activeModel, range, {
      markers: [],
      only: "source",
    });

    expect(lspClient.getCodeActions).toHaveBeenCalledWith(
      "oxide://query/active.postgres.sql",
      {
        start: { line: 1, character: 2 },
        end: { line: 1, character: 2 },
      },
      [],
      ["source"],
    );
  });

  it("bounds the local INSERT hint fallback to the visible neighborhood", async () => {
    const { providers } = coordinatorFixture();
    const prefix = " ".repeat(40_000);
    const statement = "INSERT INTO users (id, name) VALUES (1, 'Ada');";
    const text = `${prefix}${statement}`;
    const getValueInRange = vi.fn((range: any) =>
      text.slice(range.startColumn - 1, range.endColumn - 1),
    );
    const model = {
      uri: { toString: () => "oxide://query/active.postgres.sql" },
      getOffsetAt: ({ column }: { column: number }) => column - 1,
      getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
      getValueLength: () => text.length,
      getValueInRange,
    };
    const valueOffset = text.indexOf("1, 'Ada'");

    const result = await providers.get("inlayHints").provideInlayHints(model, {
      startLineNumber: 1,
      startColumn: prefix.length + 1,
      endLineNumber: 1,
      endColumn: text.length + 1,
    });

    expect(getValueInRange).toHaveBeenCalledTimes(1);
    expect(getValueInRange.mock.calls[0]?.[0].startColumn).toBe(
      prefix.length - 32 * 1024 + 1,
    );
    expect(result.hints.map((hint: any) => hint.label)).toEqual(["id:", "name:"]);
    expect(result.hints[0]?.position.column).toBe(valueOffset + 1);
  });
});
