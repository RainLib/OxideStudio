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
    formatDocument: vi.fn(async () => []),
    formatRange: vi.fn(async () => []),
    getSignatureHelp: vi.fn(async () => null),
    getSemanticTokens: vi.fn(async () => ({
      resultId: "tokens-1",
      data: [0, 0, 4, 1, 0],
    })),
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

  it("reuses semantic tokens only for the same Monaco model version", async () => {
    const { lspClient, providers } = coordinatorFixture();
    let version = 4;
    const model = {
      uri: { toString: () => "oxide://query/active.postgres.sql" },
      getVersionId: () => version,
    };
    const provider = providers.get("semanticTokens");
    const token = { isCancellationRequested: false };

    const first = await provider.provideDocumentSemanticTokens(
      model,
      null,
      token,
    );
    const cached = await provider.provideDocumentSemanticTokens(
      model,
      first.resultId,
      token,
    );
    expect(lspClient.getSemanticTokens).toHaveBeenCalledTimes(1);
    expect(Array.from(cached.data)).toEqual([0, 0, 4, 1, 0]);
    expect(cached.data).not.toBe(first.data);

    version = 5;
    await provider.provideDocumentSemanticTokens(model, cached.resultId, token);
    expect(lspClient.getSemanticTokens).toHaveBeenCalledTimes(2);

    provider.releaseDocumentSemanticTokens(cached.resultId);
    await provider.provideDocumentSemanticTokens(model, null, token);
    expect(lspClient.getSemanticTokens).toHaveBeenCalledTimes(3);
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
      getPositionAt: (offset: number) => ({
        lineNumber: 1,
        column: offset + 1,
      }),
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

    // The local INSERT parse remains viewport-bounded. A separate bounded
    // document scan may inspect dollar-quoted routine state before that range.
    expect(getValueInRange).toHaveBeenCalledTimes(2);
    expect(getValueInRange.mock.calls).toContainEqual([
      expect.objectContaining({
        startColumn: prefix.length - 32 * 1024 + 1,
      }),
    ]);
    expect(
      Math.max(
        ...getValueInRange.mock.calls.map(
          ([callRange]: [{ startColumn: number; endColumn: number }]) =>
            callRange.endColumn - callRange.startColumn,
        ),
      ),
    ).toBeLessThanOrEqual(64 * 1024);
    expect(result.hints.map((hint: any) => hint.label)).toEqual([
      "id:",
      "name:",
    ]);
    expect(result.hints[0]?.position.column).toBe(valueOffset + 1);
  });

  it("keeps the local INSERT SELECT fallback active inside a dollar-quoted routine", async () => {
    const { providers } = coordinatorFixture();
    const text = [
      "CREATE FUNCTION copy_rows() RETURNS void AS $oxide$",
      "BEGIN",
      "  INSERT INTO users (id, name) SELECT source_id, source_name FROM staging;",
      "END",
      "$oxide$ LANGUAGE plpgsql;",
    ].join("\n");
    const lines = text.split("\n");
    const lineOffsets = lines.map((_, index) =>
      lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0),
    );
    const getOffsetAt = ({
      lineNumber,
      column,
    }: {
      lineNumber: number;
      column: number;
    }) => (lineOffsets[lineNumber - 1] ?? text.length) + column - 1;
    const getPositionAt = (offset: number) => {
      let lineIndex = 0;
      while (
        lineIndex + 1 < lineOffsets.length &&
        (lineOffsets[lineIndex + 1] ?? text.length) <= offset
      ) {
        lineIndex += 1;
      }
      return {
        lineNumber: lineIndex + 1,
        column: offset - (lineOffsets[lineIndex] ?? 0) + 1,
      };
    };
    const model = {
      uri: { toString: () => "oxide://query/active.postgres.sql" },
      getOffsetAt,
      getPositionAt,
      getValueLength: () => text.length,
      getValueInRange: (range: any) =>
        text.slice(
          getOffsetAt({
            lineNumber: range.startLineNumber,
            column: range.startColumn,
          }),
          getOffsetAt({
            lineNumber: range.endLineNumber,
            column: range.endColumn,
          }),
        ),
    };

    const result = await providers.get("inlayHints").provideInlayHints(model, {
      startLineNumber: 3,
      startColumn: 3,
      endLineNumber: 3,
      endColumn: lines[2]!.length + 1,
    });

    expect(result.hints.map((hint: any) => hint.label)).toEqual([
      "id:",
      "name:",
    ]);
    expect(result.hints.map((hint: any) => hint.position.lineNumber)).toEqual([
      3, 3,
    ]);
  });

  it("drops stale signature and inlay responses after the model changes", async () => {
    const { lspClient, providers } = coordinatorFixture();
    let version = 1;
    let resolveSignature!: (value: any) => void;
    let resolveHints!: (value: any[]) => void;
    vi.mocked(lspClient.getSignatureHelp).mockReturnValue(
      new Promise((resolve) => {
        resolveSignature = resolve;
      }),
    );
    vi.mocked(lspClient.getInlayHints).mockReturnValue(
      new Promise((resolve) => {
        resolveHints = resolve;
      }),
    );
    const model = {
      uri: { toString: () => "oxide://query/active.postgres.sql" },
      getVersionId: () => version,
    };
    const signature = providers
      .get("signature")
      .provideSignatureHelp(
        model,
        { lineNumber: 1, column: 4 },
        { isCancellationRequested: false },
      );
    const hints = providers
      .get("inlayHints")
      .provideInlayHints(
        model,
        { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
        { isCancellationRequested: false },
      );
    version = 2;
    resolveSignature({ signatures: [{ label: "count(value)" }] });
    resolveHints([]);

    await expect(signature).resolves.toBeNull();
    await expect(hints).resolves.toMatchObject({ hints: [] });
  });

  it("does not return formatting edits for a changed model", async () => {
    const { lspClient, providers } = coordinatorFixture();
    let version = 3;
    let resolveDocument!: (value: any[]) => void;
    let resolveRange!: (value: any[]) => void;
    vi.mocked(lspClient.formatDocument).mockReturnValue(
      new Promise((resolve) => {
        resolveDocument = resolve;
      }),
    );
    vi.mocked(lspClient.formatRange).mockReturnValue(
      new Promise((resolve) => {
        resolveRange = resolve;
      }),
    );
    const model = {
      uri: { toString: () => "oxide://query/active.postgres.sql" },
      getVersionId: () => version,
    };
    const documentEdits = providers
      .get("format")
      .provideDocumentFormattingEdits(
        model,
        { tabSize: 2, insertSpaces: true },
        { isCancellationRequested: false },
      );
    const rangeEdits = providers
      .get("rangeFormat")
      .provideDocumentRangeFormattingEdits(
        model,
        { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
        { tabSize: 2, insertSpaces: true },
        { isCancellationRequested: false },
      );
    version = 4;
    resolveDocument([{ newText: "SELECT 1", range: {} }]);
    resolveRange([{ newText: "SELECT 1", range: {} }]);

    await expect(documentEdits).resolves.toEqual([]);
    await expect(rangeEdits).resolves.toEqual([]);
  });
});
