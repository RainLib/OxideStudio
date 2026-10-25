// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LspClient } from "@/services/lsp";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import {
  registerLspHoverProvider,
  useLspHoverProviderCoordinator,
  type LspHoverProviderRuntime,
} from "./useLspHoverProviderCoordinator";

const metadataMocks = vi.hoisted(() => ({
  loadTableMetadata: vi.fn(),
  loadTableDdl: vi.fn(),
}));

vi.mock("@/services/tableMetadataCache", () => metadataMocks);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function fixture() {
  let provider: any;
  const dispose = vi.fn(function (this: { _isDisposed: boolean }) {
    this._isDisposed = true;
  });
  const monaco = {
    languages: {
      registerHoverProvider: vi.fn((_language: string, nextProvider: any) => {
        provider = nextProvider;
        return { _isDisposed: false, dispose };
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
    showTableDdlHoverPreview: true,
    supportsTableBrowsing: false,
    targetSchema: "public",
  };
  const lspClient = {
    didOpen: vi.fn(async () => undefined),
    didChange: vi.fn(async () => undefined),
    getHover: vi.fn(async () => null),
    getDocumentSemantics:vi.fn(async()=>({value:null})),
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
  it("uses an injected owner synchronizer without reopening its document through the legacy path",async()=>{
    const f=fixture(),sync=vi.fn().mockResolvedValue(undefined);f.setRuntime({...f.runtime(),syncDocument:sync});vi.mocked(f.lspClient.getHover).mockResolvedValue({contents:"owned hover"});
    expect(await f.provider().provideHover(f.model,{lineNumber:1,column:10})).not.toBeNull();expect(sync).toHaveBeenCalledWith(f.model);expect(f.lspClient.didOpen).not.toHaveBeenCalled();expect(f.lspClient.didChange).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it("does not query hover against an old shadow when its owner cannot synchronize",async()=>{
    const f=fixture();f.setRuntime({...f.runtime(),syncDocument:vi.fn().mockRejectedValue(new Error("sync failed"))});
    expect(await f.provider().provideHover(f.model,{lineNumber:1,column:10})).toBeNull();expect(f.lspClient.getHover).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it("does not start a hover RPC after its queued owner sync loses context",async()=>{
    const f=fixture(),pending=deferred<void>();f.setRuntime({...f.runtime(),syncDocument:()=>pending.promise});const request=f.provider().provideHover(f.model,{lineNumber:1,column:10});
    f.setRuntime({...f.runtime(),canUseLsp:false});pending.resolve();expect(await request).toBeNull();expect(f.lspClient.getHover).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  beforeEach(() => {
    metadataMocks.loadTableMetadata.mockResolvedValue({
      columns: [],
      indexes: [],
      constraints: [],
      ddl: null,
      viewDefinition: null,
      source: "cache",
      updatedAt: 1,
    });
    metadataMocks.loadTableDdl.mockResolvedValue("CREATE TABLE users (id bigint)");
  });
  it("owns registration and disposal as one lifecycle", () => {
    const { coordinator, dispose, monaco } = fixture();

    expect(monaco.languages.registerHoverProvider).toHaveBeenCalledTimes(1);
    coordinator.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("binds Monaco disposal before returning the React effect cleanup", async () => {
    const state = fixture();
    const container = document.createElement("div");
    const root = createRoot(container);

    function Harness() {
      useLspHoverProviderCoordinator({
        ...state.runtime(),
        editorLanguageId: "pgsql",
        isActivePane: true,
        lspClient: state.lspClient,
        monaco: state.monaco,
      });
      return null;
    }

    await act(async () => root.render(createElement(Harness)));
    await act(async () => root.unmount());

    expect(state.dispose).toHaveBeenCalledTimes(1);
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

  it("loads DDL only when the table hover preference is enabled", async () => {
    const state = fixture();
    state.setRuntime({
      ...state.runtime(),
      schemaTables: [{ name: "users", type: "BASE TABLE" }],
      supportsTableBrowsing: true,
      showTableDdlHoverPreview: true,
    });
    const model = {
      ...state.model,
      getLineContent: () => "SELECT * FROM users",
      getValue: () => "SELECT * FROM users",
      getWordAtPosition: () => ({ startColumn: 15, endColumn: 20 }),
    };

    const hover = await state
      .provider()
      .provideHover(model, { lineNumber: 1, column: 15 });

    expect(metadataMocks.loadTableDdl).toHaveBeenCalledOnce();
    expect(hover.contents[0].value).toContain("CREATE TABLE users");

    metadataMocks.loadTableDdl.mockClear();
    state.setRuntime({
      ...state.runtime(),
      showTableDdlHoverPreview: false,
    });
    const metadataOnly = await state
      .provider()
      .provideHover(model, { lineNumber: 1, column: 15 });
    expect(metadataMocks.loadTableDdl).not.toHaveBeenCalled();
    expect(metadataOnly.contents[0].value).not.toContain("DDL preview");
  });

  it("does not duplicate table metadata requests when the interactive widget owns them", async () => {
    const state = fixture();
    metadataMocks.loadTableMetadata.mockClear();
    metadataMocks.loadTableDdl.mockClear();
    state.setRuntime({
      ...state.runtime(),
      schemaTables: [{ name: "users", type: "BASE TABLE" }],
      supportsTableBrowsing: true,
      showTableDdlHoverPreview: true,
      interactiveTableHover: true,
    });
    const model = {
      ...state.model,
      getLineContent: () => "SELECT * FROM users",
      getValue: () => "SELECT * FROM users",
      getWordAtPosition: () => ({ startColumn: 15, endColumn: 20 }),
    };

    const hover = await state
      .provider()
      .provideHover(model, { lineNumber: 1, column: 17 });

    expect(metadataMocks.loadTableMetadata).not.toHaveBeenCalled();
    expect(metadataMocks.loadTableDdl).not.toHaveBeenCalled();
    expect(state.lspClient.getHover).not.toHaveBeenCalled();
    expect(hover).toBeNull();
  });

  const context=():CompletionContextState=>({connection:{},runtime:{},execution:{},metadataVersion:1,projectId:"project-1",route:"app",generation:{},available:true,lspAllowed:true,metadataAllowed:true});
  it("preserves committed LSP hover while independently withholding incomplete renderer metadata",async()=>{
    const f=fixture(),current={...context(),syntaxAllowed:true,lspAllowed:true,metadataAllowed:false};f.setRuntime({...f.runtime(),getSemanticContext:()=>current,supportsTableBrowsing:true,schemaTables:[{name:"users"}]});
    vi.mocked(f.lspClient.getHover).mockResolvedValue({contents:"confirmed server type"});
    expect(await f.provider().provideHover(f.model,{lineNumber:1,column:10})).toMatchObject({contents:[{value:"confirmed server type"}]});
    expect(f.lspClient.getHover).toHaveBeenCalledOnce();expect((f.lspClient as any).getDocumentSemantics).not.toHaveBeenCalled();expect(metadataMocks.loadTableMetadata).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it.each([true,false])("keeps only document-local hover while physical availability is %s",async available=>{
    const f=fixture(),current={...context(),available,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false};
    f.setRuntime({...f.runtime(),serverDialect:"postgres",getSemanticContext:()=>current,supportsTableBrowsing:true,schemaTables:[{name:"users"}]});
    (f.lspClient as any).getDocumentSemantics.mockResolvedValue({value:{contents:"local CTE integer"}});
    expect(await f.provider().provideHover(f.model,{lineNumber:1,column:10})).toMatchObject({contents:[{value:"local CTE integer"}]});
    expect(f.lspClient.getHover).not.toHaveBeenCalled();expect(metadataMocks.loadTableMetadata).not.toHaveBeenCalled();expect(metadataMocks.loadTableDdl).not.toHaveBeenCalled();
    expect((f.lspClient as any).getDocumentSemantics).toHaveBeenCalledWith({uri:f.runtime().documentUri,version:1,dialect:"postgres",operation:{kind:"hover",position:{line:0,character:9}}});f.coordinator.dispose();
  });
  it.each(["context","shadow","cancel","dispose"])("drops nonempty document-local hover after %s",async reason=>{
    const f=fixture(),response=deferred<any>(),token={isCancellationRequested:false};let current={...context(),syntaxAllowed:true,lspAllowed:false,metadataAllowed:false};
    f.setRuntime({...f.runtime(),getSemanticContext:()=>current});(f.lspClient as any).getDocumentSemantics.mockReturnValue(response.promise);
    const pending=f.provider().provideHover(f.model,{lineNumber:1,column:10},token);await vi.waitFor(()=>expect((f.lspClient as any).getDocumentSemantics).toHaveBeenCalledOnce());
    if(reason==="context")current={...current,syntaxAllowed:false};else if(reason==="shadow")f.runtime().documentVersionsRef.current.set(f.runtime().documentUri,2);else if(reason==="cancel")token.isCancellationRequested=true;else f.coordinator.dispose();
    response.resolve({value:{contents:"stale local type"}});expect(await pending).toBeNull();f.coordinator.dispose();
  });
  it("does not read retained server or table metadata while authority is unavailable",async()=>{
    const state=fixture(),current={...context(),lspAllowed:false,metadataAllowed:false};
    state.setRuntime({...state.runtime(),getSemanticContext:()=>current,supportsTableBrowsing:true,schemaTables:[{name:"users"}]});
    expect(await state.provider().provideHover(state.model,{lineNumber:1,column:10})).toBeNull();
    expect(state.lspClient.getHover).not.toHaveBeenCalled();expect(metadataMocks.loadTableMetadata).not.toHaveBeenCalled();
    state.coordinator.dispose();
  });
  it("rejects an in-flight hover on a driver event without a runtime rerender",async()=>{
    const state=fixture(),response=deferred<any>();let current=context();
    state.setRuntime({...state.runtime(),getSemanticContext:()=>current});
    vi.mocked(state.lspClient.getHover).mockReturnValue(response.promise);
    const pending=state.provider().provideHover(state.model,{lineNumber:1,column:10});
    await vi.waitFor(()=>expect(state.lspClient.getHover).toHaveBeenCalledOnce());
    current={...current,execution:{}};response.resolve({contents:"stale physical type"});
    expect(await pending).toBeNull();state.coordinator.dispose();
  });
  it.each(["cancel","dispose"])("drops an asynchronous hover after %s",async reason=>{
    const state=fixture(),response=deferred<any>(),token={isCancellationRequested:false};
    vi.mocked(state.lspClient.getHover).mockReturnValue(response.promise);
    const pending=state.provider().provideHover(state.model,{lineNumber:1,column:10},token);
    await vi.waitFor(()=>expect(state.lspClient.getHover).toHaveBeenCalledOnce());
    if(reason==="cancel")token.isCancellationRequested=true;else state.coordinator.dispose();
    response.resolve({contents:"stale"});expect(await pending).toBeNull();
  });
});
