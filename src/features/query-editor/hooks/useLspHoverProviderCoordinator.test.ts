import { describe, expect, it, vi } from "vitest";
import type { LspClient } from "@/services/lsp";
import {
  registerLspHoverProvider,
  type LspHoverProviderRuntime,
} from "./useLspHoverProviderCoordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function fixture() {
  let provider: any;
  const dispose = vi.fn();
  const monaco = {
    languages: {
      registerHoverProvider: vi.fn((_language: string, nextProvider: any) => {
        provider = nextProvider;
        return { dispose };
      }),
    },
    Range: class Range {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
  };
  const uri = "oxide://query/active.postgres.sql";
  let runtime: LspHoverProviderRuntime = {
    activeProjectId: "project-1",
    canUseLsp: true,
    currentSchema: "public",
    databaseName: "app",
    documentLanguageId: "postgres",
    documentUri: uri,
    driver: "postgres",
    effectiveConnectionId: "connection-1",
    metadataRevision: 1,
    openedDocumentsRef: { current: new Set([uri]) },
    documentVersionsRef: { current: new Map([[uri, 1]]) },
    documentTextsRef: { current: new Map([[uri, "SELECT users"]]) },
    schemaTables: [],
    supportsTableBrowsing: false,
    targetSchema: "public",
  };
  const lspClient = {
    didOpen: vi.fn(async () => undefined),
    didChange: vi.fn(async () => undefined),
    getHover: vi.fn(async () => null),
  } as unknown as LspClient;
  const coordinator = registerLspHoverProvider({
    editorLanguageId: "pgsql",
    getRuntime: () => runtime,
    lspClient,
    monaco,
  });
  const model = {
    uri: { toString: () => uri },
    getValue: () => "SELECT users",
    getVersionId: () => 1,
    getLineContent: () => "SELECT users",
    getWordAtPosition: () => ({ startColumn: 8, endColumn: 13 }),
  };
  return {
    coordinator,
    dispose,
    lspClient,
    model,
    monaco,
    provider: () => provider,
    setRuntime: (next: LspHoverProviderRuntime) => {
      runtime = next;
    },
    runtime: () => runtime,
  };
}

describe("LSP hover provider coordinator", () => {
  it("owns registration and disposal as one lifecycle", () => {
    const { coordinator, dispose, monaco } = fixture();

    expect(monaco.languages.registerHoverProvider).toHaveBeenCalledTimes(1);
    coordinator.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("drops a hover response after its connection owner changes", async () => {
    const state = fixture();
    const response = deferred<any>();
    vi.mocked(state.lspClient.getHover).mockReturnValue(response.promise);

    const pending = state
      .provider()
      .provideHover(state.model, { lineNumber: 1, column: 10 });
    state.setRuntime({
      ...state.runtime(),
      effectiveConnectionId: "connection-2",
    });
    response.resolve({ contents: "stale", range: null });

    await expect(pending).resolves.toBeNull();
  });

  it("returns active server hover with a Monaco fallback range", async () => {
    const state = fixture();
    vi.mocked(state.lspClient.getHover).mockResolvedValue({
      contents: "active hover",
      range: undefined,
    });

    const hover = await state
      .provider()
      .provideHover(state.model, { lineNumber: 1, column: 10 });

    expect(hover.contents).toEqual([{ value: "active hover" }]);
    expect(hover.range).toMatchObject({
      startLineNumber: 1,
      startColumn: 8,
      endLineNumber: 1,
      endColumn: 13,
    });
  });
});
