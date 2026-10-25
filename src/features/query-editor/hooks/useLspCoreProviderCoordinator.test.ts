import { describe, expect, it, vi } from "vitest";
import type { LspClient } from "@/services/lsp";
import { registerLspCoreProviders } from "./useLspCoreProviderCoordinator";
import type { LspCoreProviderCoordinatorOptions } from "./useLspCoreProviderCoordinator";
import type {CompletionContextState} from "@/services/lsp/semanticContext";

function coordinatorFixture(serverDialect?: string, options: Partial<LspCoreProviderCoordinatorOptions> = {}) {
  let publish!: (value: { version?: number;analysisToken?:string }) => void;
  const unsubscribe = vi.fn();
  const providers = new Map<string, any>();
  const disposed: string[] = [];
  const register = (name: string) =>
    vi.fn((_language: string, provider: any) => {
      providers.set(name, provider);
      return { dispose: () => disposed.push(name) };
    });
  const monaco = {
    editor: { getModel: vi.fn(() => null as any) },
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
    getSessionKey: () => "fixture-session",
    getReferences: vi.fn(async () => []),
    getDefinitions: vi.fn(async () => []),
    prepareRename: vi.fn(async () => null),
    getDocumentSymbols: vi.fn(async () => []),
    getDocumentStructure:vi.fn(async()=>({items:[]})),
    getDocumentSemantics:vi.fn(async()=>({value:null})),
    getFoldingRanges: vi.fn(async () => []),
    getSelectionRanges: vi.fn(async () => []),
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
    serverDialect,
    lspClient,
    monaco,
    subscribeAnalysis: ({ onPublication }) => { publish = onPublication; return { dispose: unsubscribe }; },
    ...options,
  });
  return { coordinator, disposed, lspClient, monaco, providers, publish, unsubscribe };
}

describe("LSP core provider coordinator", () => {
  it.each(["document","range"])("withholds %s formatting until preferences are confirmed without blocking navigation",async kind=>{
    const f=coordinatorFixture("postgres",{canFormat:()=>false}),model={uri:{toString:()=>"oxide://query/active.postgres.sql"}};
    const edits=kind==="document"?await f.providers.get("format").provideDocumentFormattingEdits(model,{tabSize:2}):await f.providers.get("rangeFormat").provideDocumentRangeFormattingEdits(model,new f.monaco.Range(1,1,1,2),{tabSize:2});
    expect(edits).toEqual([]);expect(f.lspClient.formatDocument).not.toHaveBeenCalled();expect(f.lspClient.formatRange).not.toHaveBeenCalled();
    await f.providers.get("definition").provideDefinition(model,{lineNumber:1,column:1});expect(f.lspClient.getDefinitions).toHaveBeenCalledOnce();f.coordinator.dispose();
  });
  it.each(["document","range"])("rejects %s edits when preferences become unconfirmed in flight",async kind=>{
    let ready=true,resolve!:(value:any[])=>void;const response=new Promise<any[]>(done=>{resolve=done;});
    const f=coordinatorFixture("postgres",{canFormat:()=>ready}),model={uri:{toString:()=>"oxide://query/active.postgres.sql"}};
    vi.mocked(f.lspClient.formatDocument).mockReturnValue(response);vi.mocked(f.lspClient.formatRange).mockReturnValue(response);
    const pending=kind==="document"?f.providers.get("format").provideDocumentFormattingEdits(model,{tabSize:2}):f.providers.get("rangeFormat").provideDocumentRangeFormattingEdits(model,new f.monaco.Range(1,1,1,2),{tabSize:2});
    await vi.waitFor(()=>expect(kind==="document"?f.lspClient.formatDocument:f.lspClient.formatRange).toHaveBeenCalledOnce());ready=false;resolve([{range:{start:{line:0,character:0},end:{line:0,character:1}},newText:"STALE"}]);expect(await pending).toEqual([]);f.coordinator.dispose();
  });
  it("does not issue formatting RPC after its queued sync outlives preference readiness",async()=>{
    let ready=true,release!:()=>void;const syncing=new Promise<void>(done=>{release=done;});
    const f=coordinatorFixture("postgres",{canFormat:()=>ready,syncDocument:()=>syncing}),model={uri:{toString:()=>"oxide://query/active.postgres.sql"}};
    const pending=f.providers.get("format").provideDocumentFormattingEdits(model,{tabSize:2});ready=false;release();expect(await pending).toEqual([]);expect(f.lspClient.formatDocument).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it("triggers unparenthesized EXEC signatures using configured server dialect", () => {
    for (const dialect of ["sqlserver", "mssql", "tsql"]) {
      const { providers } = coordinatorFixture(dialect);
      expect(providers.get("signature").signatureHelpTriggerCharacters).toEqual(["(", ",", " ", "="]);
      expect(providers.get("signature").signatureHelpRetriggerCharacters).toEqual([",", "="]);
    }
    const { providers } = coordinatorFixture("postgres");
    expect(providers.get("signature").signatureHelpTriggerCharacters).toEqual(["(", ","]);
  });
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

  it("caches the document dollar-quote scan for an unchanged inlay range", async () => {
    const { providers } = coordinatorFixture();
    const prefix = "x".repeat(40_000);
    const text = `${prefix}INSERT INTO users (id) VALUES (1);`;
    const getValueInRange = vi.fn((range: any) =>
      text.slice(range.startColumn - 1, range.endColumn - 1),
    );
    const model = {
      uri: { toString: () => "oxide://query/active.postgres.sql" },
      getVersionId: () => 7,
      getOffsetAt: ({ column }: { column: number }) => column - 1,
      getPositionAt: (offset: number) => ({
        lineNumber: 1,
        column: offset + 1,
      }),
      getValueLength: () => text.length,
      getValueInRange,
    };
    const range = {
      startLineNumber: 1,
      startColumn: prefix.length + 1,
      endLineNumber: 1,
      endColumn: text.length + 1,
    };

    await providers.get("inlayHints").provideInlayHints(model, range);
    await providers.get("inlayHints").provideInlayHints(model, range);

    // Each request reads the visible fallback range. The full document scan
    // starts at column one and is reused for the unchanged model version.
    expect(
      getValueInRange.mock.calls.filter(
        ([callRange]: [{ startColumn: number }]) => callRange.startColumn === 1,
      ),
    ).toHaveLength(1);
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

function refreshModel() {
  const text = "INSERT INTO ledger VALUES(1);";
  return {
    uri: { toString: () => "oxide://query/active.postgres.sql" },
    getVersionId: () => 42,
    getValue: () => text,
    getValueLength: () => text.length,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    getOffsetAt: ({ column }: { column: number }) => column - 1,
    getValueInRange: (range: { startColumn: number; endColumn: number }) => text.slice(range.startColumn - 1, range.endColumn - 1),
    isDisposed: () => false,
  };
}
const hintRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 30 };
function semanticFixture(options:Partial<LspCoreProviderCoordinatorOptions>={}){
  let state:CompletionContextState={connection:{},runtime:{},execution:{},metadataVersion:1,projectId:"project-1",route:"app",generation:{},available:true,lspAllowed:true,metadataAllowed:true,analysisToken:"current-token"};
  const listeners=new Set<()=>void>(),editor={trigger:vi.fn()};
  const model=refreshModel(),uri=model.uri.toString();
  const f=coordinatorFixture(undefined,{serverDialect:"postgres",documentVersionsRef:{current:new Map([[uri,7]])},documentTextsRef:{current:new Map([[uri,model.getValue()]])},...options,getSemanticContext:()=>state,
    subscribeSemanticContext:notify=>{listeners.add(notify);return ()=>listeners.delete(notify);},editor});
  f.monaco.editor.getModel.mockReturnValue(model);
  return {...f,editor,listeners,change:(patch:Partial<CompletionContextState>)=>{state={...state,...patch};for(const listener of listeners)listener();}};
}
const providerCases=[
  {name:"definition",method:"getDefinitions",invoke:(p:any,m:any)=>p.provideDefinition(m,{lineNumber:1,column:1},{}),result:[{uri:"file:///stale.sql",range:{start:{line:0,character:0},end:{line:0,character:1}}}],empty:[]},
  {name:"reference",method:"getReferences",invoke:(p:any,m:any)=>p.provideReferences(m,{lineNumber:1,column:1},{},{}),result:[{uri:"file:///stale.sql",range:{start:{line:0,character:0},end:{line:0,character:1}}}],empty:[]},
  {name:"signature",method:"getSignatureHelp",invoke:(p:any,m:any)=>p.provideSignatureHelp(m,{lineNumber:1,column:1},{}),result:{signatures:[{label:"stale(value)"}]},empty:null},
  {name:"rename",method:"prepareRename",invoke:(p:any,m:any)=>p.resolveRenameLocation(m,{lineNumber:1,column:1},{}),result:{start:{line:0,character:0},end:{line:0,character:1}},empty:{rejectReason:expect.any(String)}},
  {name:"rename",method:"rename",invoke:(p:any,m:any)=>p.provideRenameEdits(m,{lineNumber:1,column:1},"new",{}),result:{changes:{"file:///stale.sql":[]}},empty:{edits:[]}},
  {name:"codeAction",method:"getCodeActions",invoke:(p:any,m:any)=>p.provideCodeActions(m,hintRange,{markers:[]},{}),result:[{title:"stale",edit:{changes:{}}}],empty:{actions:[]}},
];
describe("provider connection context fences",()=>{
  it.each(providerCases)("keeps committed server $method when the renderer metadata cache is incomplete",async item=>{
    const f=semanticFixture();f.change({syntaxAllowed:true,lspAllowed:true,metadataAllowed:false});
    await item.invoke(f.providers.get(item.name),refreshModel());expect((f.lspClient as any)[item.method]).toHaveBeenCalledOnce();expect((f.lspClient as any).getDocumentSemantics).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it.each(["semanticTokens","inlayHints"])("retains proven server %s during progressive catalog loading",async name=>{
    const f=semanticFixture(),model=refreshModel();f.change({syntaxAllowed:true,lspAllowed:true,metadataAllowed:false});
    if(name==="semanticTokens")await f.providers.get(name).provideDocumentSemanticTokens(model,null,{});else await f.providers.get(name).provideInlayHints(model,hintRange,{});
    expect(name==="semanticTokens"?f.lspClient.getSemanticTokens:f.lspClient.getInlayHints).toHaveBeenCalledOnce();expect((f.lspClient as any).getDocumentSemantics).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it.each([
    {name:"symbol",method:"getDocumentSymbols",invoke:(p:any,m:any)=>p.provideDocumentSymbols(m,{})},
    {name:"folding",method:"getFoldingRanges",invoke:(p:any,m:any)=>p.provideFoldingRanges(m,{},{})},
    {name:"selection",method:"getSelectionRanges",invoke:(p:any,m:any)=>p.provideSelectionRanges(m,[],{})},
  ])("preserves committed server $method independently of renderer cache completeness",async item=>{
    const f=semanticFixture();f.change({syntaxAllowed:true,lspAllowed:true,metadataAllowed:false});await item.invoke(f.providers.get(item.name),refreshModel());
    expect((f.lspClient as any)[item.method]).toHaveBeenCalledOnce();expect((f.lspClient as any).getDocumentStructure).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it.each(providerCases.flatMap(item=>["context","shadow","cancel"].map(reason=>({...item,reason}))))("drops nonempty local $method after $reason",async item=>{
    const model=refreshModel(),versions={current:new Map([[model.uri.toString(),7]])},f=semanticFixture({documentVersionsRef:versions}),token={isCancellationRequested:false};f.change({syntaxAllowed:true,lspAllowed:false,metadataAllowed:false});
    let finish!:(value:any)=>void;(f.lspClient as any).getDocumentSemantics.mockImplementation(()=>new Promise(done=>{finish=done;}));
    const provider=f.providers.get(item.name);
    const target=new Proxy(provider,{get(object,key){const method=object[key];return typeof method==="function"?(...args:any[])=>method(...args.slice(0,-1),token):method;}});
    const pending=item.invoke(target,model);await vi.waitFor(()=>expect((f.lspClient as any).getDocumentSemantics).toHaveBeenCalledOnce());
    if(item.reason==="context")f.change({syntaxAllowed:false});else if(item.reason==="shadow")versions.current.set(model.uri.toString(),8);else token.isCancellationRequested=true;
    finish({value:item.result});const result=await pending;
    if(item.empty===null)expect(result).toBeNull();else expect(result).toMatchObject(item.empty);expect((f.lspClient as any)[item.method]).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it("requires the current acknowledged SQL before a document semantic request",async()=>{
    const f=semanticFixture({documentVersionsRef:{current:new Map()},documentTextsRef:{current:new Map()}});f.change({syntaxAllowed:true,lspAllowed:false,metadataAllowed:false});
    expect(await f.providers.get("definition").provideDefinition(refreshModel(),{lineNumber:1,column:1},{})).toEqual([]);
    expect((f.lspClient as any).getDocumentSemantics).not.toHaveBeenCalled();expect(f.lspClient.getDefinitions).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it.each(providerCases)("uses document-local $method while the server source grant is withdrawn",async item=>{
    const f=semanticFixture();f.change({syntaxAllowed:true,lspAllowed:false,metadataAllowed:false});
    await item.invoke(f.providers.get(item.name),refreshModel());
    expect((f.lspClient as any)[item.method]).not.toHaveBeenCalled();
    expect((f.lspClient as any).getDocumentSemantics).toHaveBeenCalledOnce();f.coordinator.dispose();
  });
  it.each(["semanticTokens","inlayHints"])("does not borrow physical %s while the server source grant is withdrawn",async name=>{
    const f=semanticFixture(),model=refreshModel();f.change({syntaxAllowed:true,lspAllowed:false,metadataAllowed:false});
    if(name==="semanticTokens")await f.providers.get(name).provideDocumentSemanticTokens(model,null,{});else await f.providers.get(name).provideInlayHints(model,hintRange,{});
    expect(name==="semanticTokens"?f.lspClient.getSemanticTokens:f.lspClient.getInlayHints).not.toHaveBeenCalled();
    expect((f.lspClient as any).getDocumentSemantics).toHaveBeenCalledOnce();f.coordinator.dispose();
  });
  it("replaces only the symbol provider identity when the grant changes without editing SQL",()=>{
    const f=semanticFixture(),before=new Map(f.providers),model=refreshModel();
    f.change({available:false,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false});
    expect(f.providers.get("symbol")).not.toBe(before.get("symbol"));
    for(const [name,provider] of before)if(name!=="symbol")expect(f.providers.get(name)).toBe(provider);
    expect(f.disposed).toEqual(["symbol"]);expect(model.getVersionId()).toBe(42);
    f.coordinator.dispose();expect(f.disposed.filter(name=>name==="symbol")).toHaveLength(2);
  });
  it("invalidates the symbol cache on a current analysis publication but ignores stale provenance",()=>{
    const f=semanticFixture(),before=f.providers.get("symbol");
    f.publish({version:6,analysisToken:"current-token"});f.publish({version:7,analysisToken:"old-token"});
    expect(f.providers.get("symbol")).toBe(before);
    f.publish({version:7,analysisToken:"current-token"});
    expect(f.providers.get("symbol")).not.toBe(before);expect(f.disposed).toEqual(["symbol"]);f.coordinator.dispose();
  });
  it("does not leave duplicate symbol registrations across grant withdrawal and recovery",()=>{
    const f=semanticFixture(),seen=new Set([f.providers.get("symbol")]);
    for(let index=0;index<8;index++){
      f.change({metadataVersion:index+2,metadataAllowed:index%2===0});
      expect(seen.has(f.providers.get("symbol"))).toBe(false);seen.add(f.providers.get("symbol"));
    }
    expect(f.disposed).toEqual(Array(8).fill("symbol"));
    f.coordinator.dispose();f.coordinator.dispose();
    expect(f.disposed.filter(name=>name==="symbol")).toHaveLength(9);
    expect(f.disposed).toHaveLength(20);
  });
  it("does not recreate disposed symbol providers from late contexts or publications",()=>{
    const f=semanticFixture(),before=f.providers.get("symbol");f.coordinator.dispose();
    f.change({generation:{}});f.publish({version:7,analysisToken:"current-token"});f.coordinator.dispose();
    expect(f.providers.get("symbol")).toBe(before);expect(f.monaco.languages.registerDocumentSymbolProvider).toHaveBeenCalledOnce();
    expect(f.listeners.size).toBe(0);expect(f.disposed).toHaveLength(12);
  });
  it("uses a schema-free symbol snapshot instead of the metadata-bearing standard RPC",async()=>{
    const model=refreshModel(),uri=model.uri.toString(),f=semanticFixture({serverDialect:"postgres",documentVersionsRef:{current:new Map([[uri,7]])},documentTextsRef:{current:new Map([[uri,model.getValue()]])}});
    f.change({syntaxAllowed:true,lspAllowed:false,metadataAllowed:false});await f.providers.get("symbol").provideDocumentSymbols(model,{});
    expect(f.lspClient.getDocumentSymbols).not.toHaveBeenCalled();expect((f.lspClient as any).getDocumentStructure).toHaveBeenCalledWith({uri,version:7,dialect:"postgres",kind:"symbols"});f.coordinator.dispose();
  });
  it("keeps a current syntax-granted outline when physical availability is false",async()=>{
    const model=refreshModel(),uri=model.uri.toString(),f=semanticFixture({serverDialect:"postgres",documentVersionsRef:{current:new Map([[uri,7]])},documentTextsRef:{current:new Map([[uri,model.getValue()]])}});
    f.change({available:false,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false});await f.providers.get("symbol").provideDocumentSymbols(model,{});
    expect((f.lspClient as any).getDocumentStructure).toHaveBeenCalledOnce();expect(f.lspClient.getDocumentSymbols).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it.each(["format","rangeFormat"])("keeps schema-free %s available under a syntax-only grant",async name=>{
    const f=semanticFixture(),model=refreshModel();f.change({available:false,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false});
    if(name==="format")await f.providers.get(name).provideDocumentFormattingEdits(model,{tabSize:2},{});else await f.providers.get(name).provideDocumentRangeFormattingEdits(model,hintRange,{tabSize:2},{});
    expect(name==="format"?f.lspClient.formatDocument:f.lspClient.formatRange).toHaveBeenCalledOnce();f.coordinator.dispose();
  });
  it("does not send a scoped structure request until the exact SQL shadow is acknowledged",async()=>{
    const f=semanticFixture({documentVersionsRef:{current:new Map()},documentTextsRef:{current:new Map()}});f.change({syntaxAllowed:true,lspAllowed:false,metadataAllowed:false});
    expect(await f.providers.get("symbol").provideDocumentSymbols(refreshModel(),{})).toEqual([]);expect((f.lspClient as any).getDocumentStructure).not.toHaveBeenCalled();expect(f.lspClient.getDocumentSymbols).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it("rejects scoped data after a same-text wire revision changes",async()=>{
    const model=refreshModel(),uri=model.uri.toString(),versions={current:new Map([[uri,7]])},f=semanticFixture({documentVersionsRef:versions});f.change({syntaxAllowed:true,lspAllowed:false,metadataAllowed:false});
    let finish!:(value:any)=>void;(f.lspClient as any).getDocumentStructure.mockImplementation(()=>new Promise(done=>{finish=done;}));const pending=f.providers.get("symbol").provideDocumentSymbols(model,{});
    await vi.waitFor(()=>expect((f.lspClient as any).getDocumentStructure).toHaveBeenCalledOnce());versions.current.set(uri,8);finish({items:[{name:"old",kind:13,range:{start:{line:0,character:0},end:{line:0,character:1}},selectionRange:{start:{line:0,character:0},end:{line:0,character:1}}}]});
    expect(await pending).toEqual([]);f.coordinator.dispose();
  });
  it("rejects a late scoped response after its syntax source is withdrawn",async()=>{
    const f=semanticFixture();f.change({syntaxAllowed:true,lspAllowed:false,metadataAllowed:false});let finish!:(value:any)=>void;(f.lspClient as any).getDocumentStructure.mockImplementation(()=>new Promise(done=>{finish=done;}));
    const pending=f.providers.get("symbol").provideDocumentSymbols(refreshModel(),{});await vi.waitFor(()=>expect((f.lspClient as any).getDocumentStructure).toHaveBeenCalledOnce());f.change({syntaxAllowed:false});finish({items:[]});expect(await pending).toEqual([]);f.coordinator.dispose();
  });
  it.each([undefined,"old-token"])("ignores analysis refresh from an unbound configuration token %s",async analysisToken=>{
    const f=semanticFixture(),model=refreshModel(),tokens=f.providers.get("semanticTokens");
    await tokens.provideDocumentSemanticTokens(model,null,{});f.publish({version:7,analysisToken});
    await tokens.provideDocumentSemanticTokens(model,null,{});expect(f.lspClient.getSemanticTokens).toHaveBeenCalledOnce();
    f.publish({version:7,analysisToken:"current-token"});await tokens.provideDocumentSemanticTokens(model,null,{});
    expect(f.lspClient.getSemanticTokens).toHaveBeenCalledTimes(2);f.coordinator.dispose();
  });
  it.each(providerCases)("does not dispatch $method against unverified metadata",async item=>{
    const f=semanticFixture();f.change({lspAllowed:false,metadataAllowed:false});
    const result=await item.invoke(f.providers.get(item.name),refreshModel());
    if(item.empty===null)expect(result).toBeNull();else expect(result).toMatchObject(item.empty);
    expect((f.lspClient as any)[item.method]).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it.each(providerCases)("drops $method after a same-document driver operation",async item=>{
    const f=semanticFixture();let finish!:(value:any)=>void;
    vi.mocked((f.lspClient as any)[item.method]).mockReturnValue(new Promise(done=>{finish=done;}));
    const pending=item.invoke(f.providers.get(item.name),refreshModel());
    f.change({execution:{}});finish(item.result);
    const result=await pending;if(item.empty===null)expect(result).toBeNull();else expect(result).toMatchObject(item.empty);
    f.coordinator.dispose();
  });
  it.each(providerCases)("rechecks authority after document synchronization before $method",async item=>{
    let state:CompletionContextState={connection:{},runtime:{},metadataVersion:1,projectId:"p",route:"app",generation:{},available:true,lspAllowed:true,metadataAllowed:true};
    let complete!:(value:void)=>void;const synchronized=new Promise<void>(done=>{complete=done;});
    const f=coordinatorFixture(undefined,{getSemanticContext:()=>state,syncDocument:()=>synchronized});
    const pending=item.invoke(f.providers.get(item.name),refreshModel());
    expect((f.lspClient as any)[item.method]).not.toHaveBeenCalled();state={...state,execution:{}};complete();
    const result=await pending;if(item.empty===null)expect(result).toBeNull();else expect(result).toMatchObject(item.empty);
    expect((f.lspClient as any)[item.method]).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it("clears cached tokens and notifies inlays immediately without rerendering or editing",async()=>{
    const f=semanticFixture(),model=refreshModel(),tokens=f.providers.get("semanticTokens"),inlays=f.providers.get("inlayHints"),changed=vi.fn();
    inlays.onDidChangeInlayHints(changed);await tokens.provideDocumentSemanticTokens(model,null,{});
    f.change({execution:{},lspAllowed:false,metadataAllowed:false});
    expect(Array.from((await tokens.provideDocumentSemanticTokens(model,null,{})).data)).toEqual([]);
    expect(f.lspClient.getSemanticTokens).toHaveBeenCalledOnce();await Promise.resolve();expect(changed).toHaveBeenCalledOnce();
    expect(f.editor.trigger).toHaveBeenCalledWith("oxide.semanticContext","closeParameterHints",{});
    f.change({generation:{},lspAllowed:true,metadataAllowed:true});await tokens.provideDocumentSemanticTokens(model,null,{});
    expect(f.lspClient.getSemanticTokens).toHaveBeenCalledTimes(2);expect(model.getVersionId()).toBe(42);
    f.coordinator.dispose();expect(f.listeners.size).toBe(0);
  });
  it("keeps explicit INSERT hints while a transaction prevents physical inference",async()=>{
    const f=semanticFixture();f.change({lspAllowed:false,metadataAllowed:false});
    const text="INSERT INTO ledger(explicit_amount) VALUES(1);",base=refreshModel();
    const model={...base,getValue:()=>text,getValueLength:()=>text.length,getValueInRange:(range:any)=>text.slice(range.startColumn-1,range.endColumn-1)};
    const result=await f.providers.get("inlayHints").provideInlayHints(model,{...hintRange,endColumn:text.length+1},{});
    expect(result.hints.map((hint:any)=>hint.label)).toEqual(["explicit_amount:"]);
    expect(f.lspClient.getInlayHints).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  const localCases=[
    {name:"format",method:"formatDocument",invoke:(p:any,m:any)=>p.provideDocumentFormattingEdits(m,{tabSize:2},{}),result:[]},
    {name:"rangeFormat",method:"formatRange",invoke:(p:any,m:any)=>p.provideDocumentRangeFormattingEdits(m,hintRange,{tabSize:2},{}),result:[]},
    {name:"symbol",method:"getDocumentSymbols",invoke:(p:any,m:any)=>p.provideDocumentSymbols(m,{}),result:[]},
    {name:"folding",method:"getFoldingRanges",invoke:(p:any,m:any)=>p.provideFoldingRanges(m,{},{}),result:[]},
    {name:"selection",method:"getSelectionRanges",invoke:(p:any,m:any)=>p.provideSelectionRanges(m,[],{}),result:[]},
  ];
  it.each(localCases)("keeps document-only $method available without physical metadata",async item=>{
    const f=semanticFixture();f.change({lspAllowed:false,metadataAllowed:false});await item.invoke(f.providers.get(item.name),refreshModel());
    if(["symbol","folding","selection"].includes(item.name)){expect((f.lspClient as any).getDocumentStructure).toHaveBeenCalledOnce();expect((f.lspClient as any)[item.method]).not.toHaveBeenCalled();}
    else expect((f.lspClient as any)[item.method]).toHaveBeenCalledOnce();f.coordinator.dispose();
  });
  it.each(localCases)("rejects stale document-only $method results across a context switch",async item=>{
    const f=semanticFixture();let finish!:(value:any[])=>void;
    vi.mocked((f.lspClient as any)[item.method]).mockReturnValue(new Promise(done=>{finish=done;}));
    const pending=item.invoke(f.providers.get(item.name),refreshModel());
    await vi.waitFor(()=>expect((f.lspClient as any)[item.method]).toHaveBeenCalledOnce());
    f.change({runtime:{}});finish(item.result);expect(await pending).toEqual([]);f.coordinator.dispose();
  });
});
describe("core provider metadata refresh", () => {
  it("invalidates tokens and notifies inlays without recreating providers or editing SQL", async () => {
    const f = coordinatorFixture(), model = refreshModel(), changed = vi.fn();
    const tokens = f.providers.get("semanticTokens"), inlays = f.providers.get("inlayHints");
    inlays.onDidChangeInlayHints(changed);
    await tokens.provideDocumentSemanticTokens(model, null, {});
    await tokens.provideDocumentSemanticTokens(model, null, {});
    expect(f.lspClient.getSemanticTokens).toHaveBeenCalledOnce();
    f.publish({ version: 7 });
    await tokens.provideDocumentSemanticTokens(model, null, {});
    expect(f.lspClient.getSemanticTokens).toHaveBeenCalledTimes(2); expect(changed).toHaveBeenCalledOnce();
    expect(f.monaco.languages.registerInlayHintsProvider).toHaveBeenCalledOnce(); expect(model.getVersionId()).toBe(42); f.coordinator.dispose();
  });
  it("drops an inlay response that predates a metadata publication", async () => {
    const f = coordinatorFixture(), model = refreshModel(); let resolve!: (hints: any[]) => void;
    vi.mocked(f.lspClient.getInlayHints).mockReturnValue(new Promise(done => { resolve = done; }));
    const pending = f.providers.get("inlayHints").provideInlayHints(model, hintRange, {});
    f.publish({ version: 1 }); resolve([{ position: { line: 0, character: 26 }, label: "old:" }]);
    await expect(pending).resolves.toMatchObject({ hints: [] }); f.coordinator.dispose();
  });
  it("does not let a late token result overwrite the new generation", async () => {
    const f = coordinatorFixture(), model = refreshModel(), provider = f.providers.get("semanticTokens"); let resolve!: (value: any) => void;
    vi.mocked(f.lspClient.getSemanticTokens).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue({ resultId: "new", data: [0, 0, 2, 3, 0] });
    const old = provider.provideDocumentSemanticTokens(model, null, {}); f.publish({ version: 7 });
    const fresh = await provider.provideDocumentSemanticTokens(model, null, {}); resolve({ resultId: "old", data: [0, 0, 1, 0, 0] });
    expect(Array.from((await old).data)).toEqual([]); expect((await provider.provideDocumentSemanticTokens(model, null, {})).resultId).toBe("new");
    expect(fresh.resultId).toBe("new"); expect(f.lspClient.getSemanticTokens).toHaveBeenCalledTimes(2); f.coordinator.dispose();
  });
  it("compares publications to the LSP shadow version rather than Monaco's counter", async () => {
    const model = refreshModel(), uri = model.uri.toString(), changed = vi.fn();
    const f = coordinatorFixture(undefined, { documentVersionsRef: { current: new Map([[uri, 7]]) }, documentTextsRef: { current: new Map([[uri, model.getValue()]]) } });
    f.monaco.editor.getModel.mockReturnValue(model); f.providers.get("inlayHints").onDidChangeInlayHints(changed);
    for (const version of [6, undefined, 42]) f.publish({ version }); await Promise.resolve(); expect(changed).not.toHaveBeenCalled();
    f.publish({ version: 7 }); await Promise.resolve(); expect(changed).toHaveBeenCalledOnce(); f.coordinator.dispose();
  });
  it("ignores unsynchronized text, disposed models and missing shadow state", async () => {
    const model = refreshModel(), uri = model.uri.toString(), versions = new Map([[uri, 7]]), texts = new Map([[uri, "old"]]), changed = vi.fn();
    const f = coordinatorFixture(undefined, { documentVersionsRef: { current: versions }, documentTextsRef: { current: texts } });
    f.monaco.editor.getModel.mockReturnValue(model); f.providers.get("inlayHints").onDidChangeInlayHints(changed);
    f.publish({ version: 7 }); await Promise.resolve(); expect(changed).not.toHaveBeenCalled();
    texts.set(uri, model.getValue()); f.publish({ version: 7 }); await Promise.resolve(); expect(changed).toHaveBeenCalledOnce();
    model.isDisposed = () => true; f.publish({ version: 7 }); model.isDisposed = () => false; versions.clear(); f.publish({ version: 7 }); await Promise.resolve();
    expect(changed).toHaveBeenCalledOnce(); f.coordinator.dispose();
  });
  it("skips pre-cancelled work and rejects an in-flight cancelled response", async () => {
    const f = coordinatorFixture(), model = refreshModel(), provider = f.providers.get("inlayHints");
    await provider.provideInlayHints(model, hintRange, { isCancellationRequested: true });
    await f.providers.get("semanticTokens").provideDocumentSemanticTokens(model, null, { isCancellationRequested: true });
    expect(f.lspClient.getInlayHints).not.toHaveBeenCalled(); expect(f.lspClient.getSemanticTokens).not.toHaveBeenCalled();
    let resolve!: (value: any[]) => void; vi.mocked(f.lspClient.getInlayHints).mockReturnValue(new Promise(done => { resolve = done; }));
    const token = { isCancellationRequested: false }, pending = provider.provideInlayHints(model, hintRange, token);
    token.isCancellationRequested = true; resolve([]); await expect(pending).resolves.toMatchObject({ hints: [] }); f.coordinator.dispose();
  });
  it("drops pending work after disposal and releases subscriptions exactly once", async () => {
    const f = coordinatorFixture(), model = refreshModel(); let hints!: (value: any[]) => void, tokens!: (value: any) => void;
    vi.mocked(f.lspClient.getInlayHints).mockReturnValue(new Promise(done => { hints = done; }));
    vi.mocked(f.lspClient.getSemanticTokens).mockReturnValue(new Promise(done => { tokens = done; }));
    const pendingHints = f.providers.get("inlayHints").provideInlayHints(model, hintRange, {}), pendingTokens = f.providers.get("semanticTokens").provideDocumentSemanticTokens(model, null, {});
    f.coordinator.dispose(); f.coordinator.dispose(); f.publish({ version: 7 }); hints([]); tokens({ data: [0, 0, 1, 1, 0] });
    await expect(pendingHints).resolves.toMatchObject({ hints: [] }); expect(Array.from((await pendingTokens).data)).toEqual([]);
    expect(f.unsubscribe).toHaveBeenCalledOnce(); expect(f.disposed.length).toBe(f.providers.size);
  });
  it("keeps a burst to one notification for each registered renderer consumer", async () => {
    const f = coordinatorFixture(), inlays = vi.fn(), tokens = vi.fn();
    f.providers.get("inlayHints").onDidChangeInlayHints(inlays); f.providers.get("semanticTokens").onDidChange(tokens);
    for (let i = 0; i < 20; i++) f.publish({ version: 7 }); await Promise.resolve();
    expect(inlays).toHaveBeenCalledOnce(); expect(tokens).toHaveBeenCalledOnce(); expect(f.providers.size).toBe(12); f.coordinator.dispose();
  });
});

describe("format failure ownership",()=>{
  it.each(["dispose","context","cancel","edit"])("does not publish a stale formatting failure after %s",async reason=>{
    const onDocumentFormatResult=vi.fn(),f=semanticFixture({onDocumentFormatResult});let reject!:(error:Error)=>void;
    vi.mocked(f.lspClient.formatDocument).mockReturnValue(new Promise((_resolve,fail)=>{reject=fail;}));
    let version=42;const model={...refreshModel(),getVersionId:()=>version},token={isCancellationRequested:false};
    const pending=f.providers.get("format").provideDocumentFormattingEdits(model,{tabSize:2},token);
    await vi.waitFor(()=>expect(f.lspClient.formatDocument).toHaveBeenCalledOnce());
    if(reason==="dispose")f.coordinator.dispose();else if(reason==="context")f.change({generation:{}});else if(reason==="cancel")token.isCancellationRequested=true;else version++;
    reject(new Error("old source failure"));expect(await pending).toEqual([]);expect(onDocumentFormatResult).not.toHaveBeenCalled();f.coordinator.dispose();
  });
  it("still reports a current formatting failure to its owner",async()=>{
    const onDocumentFormatResult=vi.fn(),f=semanticFixture({onDocumentFormatResult}),error=new Error("current source failure");
    vi.mocked(f.lspClient.formatDocument).mockRejectedValue(error);
    expect(await f.providers.get("format").provideDocumentFormattingEdits(refreshModel(),{tabSize:2},{})).toEqual([]);
    expect(onDocumentFormatResult).toHaveBeenCalledExactlyOnceWith({ok:false,error});f.coordinator.dispose();
  });
});
