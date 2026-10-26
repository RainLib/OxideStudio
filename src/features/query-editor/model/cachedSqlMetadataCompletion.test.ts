// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";
import { getSqlDocumentUri } from "@/services/lsp/document";
import type { LspClient } from "@/services/lsp/client";
import type { DatabaseCapabilities, DatabaseDriver, TableInfo } from "@/services/tauri/types";
import { createCachedSqlCompletionRequest, type CachedSqlCompletionCaches } from "./cachedSqlCompletion";
import { createQueryCompletionProvider } from "./createQueryCompletionProvider";
import {type CompletionContextState} from "@/services/lsp/semanticContext";
import {createCompletionContextReader} from "./completionContextState";
import {useConnectionSemanticStore} from "@/services/lsp/connectionSemanticState";
import {useConnectionStore} from "@/store/useConnectionStore";
import {useSchemaStore} from "@/store/useSchemaStore";
import {useProjectStore} from "@/store/useProjectStore";
import {databaseDriverProfile, registerDatabaseCapabilities} from "@/features/database-drivers/model/runtimeCatalog";
import {defaultDatabaseCapabilities} from "@/lib/databaseDialect";
const metadata = vi.hoisted(() => ({
  loadTableMetadata: vi.fn()
}));
const redis=vi.hoisted(()=>({loadRedisCommandDocumentation:vi.fn(),loadRedisCompletionKeys:vi.fn()}));
vi.mock("@/lib/redisCompletionSource",()=>redis);
vi.mock("@/services/tableMetadataCache", () => metadata);
class Range {
  constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {}
}
const monaco = {
  Range,
  languages: {
    CompletionItemKind: {
      Field: 5,
      Struct: 22,
      Reference: 18,
      Keyword: 17,
      Snippet: 27,
      Function: 1,
      Operator: 11
    },
    CompletionItemInsertTextRule: {
      None: 0,
      InsertAsSnippet: 4
    }
  }
};
const columns = [{
  name: "租金总额",
  data_type: "decimal",
  nullable: false
}, {
  name: "amount",
  data_type: "decimal",
  nullable: false,
  comment: "营业收入 Revenue amount"
}, {
  name: "rev_exact",
  data_type: "bigint",
  nullable: false
}];
function fixture(marked: string, driver: DatabaseDriver = "mysql", shared?: {
  caches: CachedSqlCompletionCaches;
  generations: Map<string, number>;
}, revision = 1, lspReady = false, getCompletionContext?: () => CompletionContextState) {
  const offset = marked.indexOf("<cursor>");
  let text = marked.replace("<cursor>", "");
  let version = 1;
  const uri = getSqlDocumentUri("fallback-test", driver);
  const positionAt = (offset: number) => {
    const before = text.slice(0, offset).split("\n");
    return {
      lineNumber: before.length,
      column: before[before.length - 1]!.length + 1
    };
  };
  const offsetAt = (p: {
    lineNumber: number;
    column: number;
  }) => text.split("\n").slice(0, p.lineNumber - 1).reduce((n, s) => n + s.length + 1, 0) + p.column - 1;
  const model = {
    uri: {
      toString: () => uri
    },
    getVersionId: () => version,
    getValue: () => text,
    getOffsetAt: offsetAt,
    getPositionAt: positionAt,
    getLineContent: (line: number) => text.split("\n")[line - 1]!.replace(/\r$/u, ""),
    getValueInRange: (range: Range) => text.slice(offsetAt({
      lineNumber: range.startLineNumber,
      column: range.startColumn
    }), offsetAt({
      lineNumber: range.endLineNumber,
      column: range.endColumn
    })),
    getWordUntilPosition: (p: {
      lineNumber: number;
      column: number;
    }) => {
      const prefix = text.split("\n")[p.lineNumber - 1]!.slice(0, p.column - 1);
      const word = prefix.match(/[\p{L}\p{N}_]+$/u)?.[0] || "";
      return {
        word,
        startColumn: p.column - word.length,
        endColumn: p.column
      };
    }
  };
  const caches = shared?.caches ?? {
    fields: new Map(),
    joinConstraints: new Map()
  };
  const generations = shared?.generations ?? new Map();
  const options = {
    connectionId: "connection",
    activeProjectId: "project",
    databaseName: "db",
    currentSchema: "app",
    driver,
    metadataRevision: revision,
    schemaTables: [] as TableInfo[],
    sqlCompletion: {
      ...DEFAULT_APP_SETTINGS.editor.sqlCompletion,
      appendSpace: false,
      snippets: [],
      rankByUsage: false
    },
    sqlFormatting: DEFAULT_APP_SETTINGS.editor.sqlFormatting
  };
  const client = {
    getDocumentCompletions:vi.fn().mockResolvedValue(null),
    getCompletionList: vi.fn().mockResolvedValue({
      items: [],
      isIncomplete: false,
      resolveProvider: false
    }),
    didOpen: vi.fn(),
    didChange: vi.fn(),
    resolveCompletionItem: vi.fn(async item=>({...item,detail:"resolved detail"}))
  } as unknown as LspClient;
  const provider = createQueryCompletionProvider({
    getCompletionContext,
    monaco: monaco as any,
    completionTriggerOriginRef: {
      current: "explicit"
    },
    documentUri: uri,
    effectiveConnectionId: "connection",
    isCurrentLspModelUri: value => value === uri,
    activeTab: undefined,
    currentSchema: "app",
    activeConnection: undefined,
    metadataVersion: revision,
    editorSettings: {
      ...DEFAULT_APP_SETTINGS.editor,
      sqlCompletion: options.sqlCompletion
    },
    usageScope: "fallback-test",
    completionRequestGenerationRef: {
      current: generations
    },
    createCachedSqlCompletionRequest: request => createCachedSqlCompletionRequest(options, caches, request),
    capabilities: {
      ...defaultDatabaseCapabilities(driver),
      driver,
      supportsSqlQuery: true
    } as DatabaseCapabilities,
    rankByUsage: false,
    completionOwnerKey: "fallback-test",
    driver,
    batchColumnSessionsRef: {
      current: new Map()
    },
    preferredElasticsearchIndex: undefined,
    lspReady,
    documentLanguageId: "sql",
    lspClient: client,
    openedDocumentsRef: {
      current: new Set()
    },
    documentVersionsRef: {
      current: new Map()
    },
    documentTextsRef: {
      current: new Map()
    },
    mountedEditor: {
      getModel: () => model
    }
  });
  const request = (token = {}) => provider.provideCompletionItems(model, positionAt(offset), {
    triggerKind: 0
  }, token);
  const accept = (suggestion: any) => {
    const range = suggestion.range as Range;
    const from = offsetAt({
      lineNumber: range.startLineNumber,
      column: range.startColumn
    });
    const to = offsetAt({
      lineNumber: range.endLineNumber,
      column: range.endColumn
    });
    return text.slice(0, from) + suggestion.insertText + text.slice(to);
  };
  return {
    request,
    provider,
    accept,
    client,
    caches,
    generations,
    options,
    model,
    position: positionAt(offset),
    replace: () => {
      version++;
      text += " ";
    },
    text: () => text
  };
}
const fields = (result: any) => result.suggestions.filter((item: any) => item.kind === 5);
beforeEach(() => {
  metadata.loadTableMetadata.mockReset().mockImplementation(async (options: any) => ({
    columns: options.table === "archive" ? [{
      name: "secret",
      data_type: "text",
      nullable: false,
      comment: "Revenue"
    }] : options.table === "users" ? [{
      name: "id",
      data_type: "bigint",
      nullable: false
    }] : columns
  }));
});
describe("production completion provider cached metadata search", () => {
  it.each(["mysql", "postgres", "sqlite"] as const)("completes an empty multiline SELECT list before the adapter FROM clause (%s)", async driver => {
    const f=fixture("SELECT \n<cursor>\n\nFROM adapter\nLIMIT 100;",driver);
    const result=await f.request();
    expect(fields(result).map((item:any)=>item.label)).toContain("amount");
    expect(metadata.loadTableMetadata).toHaveBeenCalledWith(expect.objectContaining({table:"adapter",schema:"app"}));
  });
  it("continues fields after accepting SELECT immediately before existing whitespace",async()=>{
    const f=fixture("SELECT<cursor> \nFROM adapter\nLIMIT 100;","postgres");
    const item=fields(await f.request()).find((item:any)=>item.label==="amount");
    expect(item).toBeDefined();expect(f.accept(item)).toBe("SELECT amount \nFROM adapter\nLIMIT 100;");
  });
  it("offers a qualified table picker and chains its selected projection",async()=>{
    const f=fixture("SELECT \n<cursor>\nLIMIT 100;","postgres");f.options.schemaTables=[{name:"adapter",schema:"app"}];
    const result=await f.request(),item=result.suggestions.find((item:any)=>item.label?.label==="adapter"&&item.label.description==="db.app");
    expect(item).toBeDefined();expect(item.insertText).toBe("${1} FROM app.adapter$0");
    expect(item.command.arguments.slice(2)).toEqual([true,"fallback-test"]);expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it.each(["SELECT <cursor> FROM adapter","SELECT <cursor> FROM missing JOIN users ON true","SELECT 1 + <cursor>"])("does not add a second FROM or replace an expression: %s",async sql=>{
    const f=fixture(sql,"postgres");f.options.schemaTables=[{name:"adapter",schema:"app"}];
    expect((await f.request()).suggestions.some((item:any)=>item.label?.label==="adapter"&&item.label.description==="db.app")).toBe(false);
  });
  it("does not grant Redis reads when only document-local inference is available",async()=>{
    const context:CompletionContextState={connection:{},runtime:{},metadataVersion:1,projectId:"project",route:"app",generation:{},available:true,lspAllowed:false,metadataAllowed:false};
    const f=fixture("GET <cursor>","redis",undefined,1,false,()=>context);
    expect((await f.request()).suggestions).toEqual([]);expect(redis.loadRedisCommandDocumentation).not.toHaveBeenCalled();
  });
  it("does not publish late Redis metadata after the source generation changes",async()=>{
    let context:CompletionContextState={connection:{},runtime:{},metadataVersion:1,projectId:"project",route:"app",generation:{},available:true,lspAllowed:true,metadataAllowed:true};
    let complete!:(value:unknown[])=>void;redis.loadRedisCommandDocumentation.mockReturnValueOnce(new Promise(done=>{complete=done;}));
    const f=fixture("GET <cursor>","redis",undefined,1,false,()=>context),pending=f.request();
    context={...context,execution:{}};complete([]);
    expect((await pending).suggestions).toEqual([]);expect(redis.loadRedisCompletionKeys).not.toHaveBeenCalled();
  });
  it.each([{activeOperations:1},{openTransactions:1},{uncertain:true}])("keeps nested document projections with held driver state %o and reads no physical metadata",async patch=>{
    const saved={semantic:useConnectionSemanticStore.getState(),connections:useConnectionStore.getState(),schema:useSchemaStore.getState(),project:useProjectStore.getState()};
    try{
      const connection={id:"connection",name:"Local declarations",driver:"mysql" as const};
      useConnectionStore.setState({connections:[connection as any],activeConnectionId:"connection",connectionRuntimeStates:{connection:{status:"connected",updatedAt:1}}});
      useSchemaStore.setState({metadataVersion:1,currentSchema:"app"});useProjectStore.setState({activeProjectId:"project"});
      const owner={},authority=useConnectionSemanticStore.getState();authority.claim(owner);authority.listening(owner);
      authority.accept(owner,{connectionId:"connection",session:"fixture",revision:1,connected:true,activeOperations:0,openTransactions:0,uncertain:false,...patch});
      const processSnapshot={ready:false,generation:{}};
      const read=createCompletionContextReader({connectionId:"connection",connection:connection as any,lspClient:{getRuntimeSnapshot:()=>processSnapshot},metadataVersion:1,projectId:"project",currentSchema:"app",route:"[null,null,null,null]"});
      const f=fixture("WITH seed AS (SELECT CAST(1 AS DECIMAL(10,2)) AS declared_amount), q AS (SELECT s.declared_amount AS declared_total FROM seed s) SELECT q.decl<cursor>Suffix FROM q","mysql",undefined,1,true,read);
      const result=await f.request();const item=fields(result).find((value:any)=>value.label==="declared_total");
      expect(item).toBeDefined();expect(f.accept(item)).toContain("SELECT q.declared_total FROM q");
      expect(metadata.loadTableMetadata).not.toHaveBeenCalled();expect(f.client.getCompletionList).not.toHaveBeenCalled();
      expect(f.caches.fields.size).toBe(0);
    }finally{useConnectionSemanticStore.setState(saved.semantic);useConnectionStore.setState(saved.connections);useSchemaStore.setState(saved.schema);useProjectStore.setState(saved.project);}
  });
  const liveContext = ():CompletionContextState => ({connection:{},runtime:{},metadataVersion:1,projectId:"project",route:"db/app",generation:{},available:true,lspAllowed:true,metadataAllowed:true});
  it("drops an old metadata completion after a same-id session replacement without editing SQL",async()=>{
    let context=liveContext(),finish!: (value:unknown)=>void;
    metadata.loadTableMetadata.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const f=fixture("SELECT r.Revenue<cursor> FROM ledger r","mysql",undefined,1,false,()=>context);
    const pending=f.request();await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));context={...context,runtime:{}};finish({columns});
    expect(fields(await pending)).toEqual([]);expect(f.caches.fields.size).toBe(0);
  });
  it.each(["metadataVersion","route","projectId","generation"] as const)("rejects a delayed cached list after %s changes",async key=>{
    let context=liveContext(),finish!: (value:unknown)=>void;
    metadata.loadTableMetadata.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const f=fixture("SELECT r.Revenue<cursor> FROM ledger r","mysql",undefined,1,false,()=>context);
    const pending=f.request();await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));context={...context,[key]:key==="metadataVersion"?2:key==="generation"?{}:"changed"};finish({columns});
    expect(fields(await pending)).toEqual([]);
  });
  it("does not read or expose old physical cache while fresh metadata is unavailable",async()=>{
    const context={...liveContext(),metadataAllowed:false};
    const f=fixture("SELECT r.Revenue<cursor> FROM ledger r","mysql",undefined,1,false,()=>context);
    expect(fields(await f.request())).toEqual([]);expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it("keeps declared CTE output names without borrowing blocked physical types or comments",async()=>{
    const context={...liveContext(),metadataAllowed:false,lspAllowed:false};
    const f=fixture("WITH q(net) AS (SELECT r.amount FROM ledger r) SELECT q.ne<cursor> FROM q","mysql",undefined,1,false,()=>context);
    const suggestions=fields(await f.request());expect(suggestions.map((item:any)=>item.label)).toEqual(["net"]);
    expect(JSON.stringify(suggestions)).not.toContain("decimal");expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it("does not request stale LSP proposals before its source configuration is ready",async()=>{
    const context={...liveContext(),metadataAllowed:false,lspAllowed:false};
    const f=fixture("SELECT r.Revenue<cursor> FROM ledger r","mysql",undefined,1,true,()=>context);
    await f.request();expect(f.client.getCompletionList).not.toHaveBeenCalled();
  });
  it("does not lazily resolve a displayed item after its semantic context changes",async()=>{
    let context=liveContext();
    const f=fixture("SELECT l.a<cursor> FROM ledger l","mysql",undefined,1,true,()=>context);
    vi.mocked(f.client.getCompletionList).mockResolvedValue({items:[{label:"amount",kind:5,data:{key:1}}],isIncomplete:false,resolveProvider:true});
    const suggestion=(await f.request()).suggestions.find((item:any)=>item.label==="amount");expect(suggestion).toBeDefined();
    context={...context,runtime:{}};
    await expect(f.provider.resolveCompletionItem(suggestion,{})).resolves.toBe(suggestion);
    expect(f.client.resolveCompletionItem).not.toHaveBeenCalled();
  });
  it("discards lazy enrichment that finishes after a context replacement",async()=>{
    let context=liveContext(),finish!: (value:any)=>void;
    const f=fixture("SELECT l.a<cursor> FROM ledger l","mysql",undefined,1,true,()=>context);
    vi.mocked(f.client.getCompletionList).mockResolvedValue({items:[{label:"amount",kind:5,data:{key:1}}],isIncomplete:false,resolveProvider:true});
    vi.mocked(f.client.resolveCompletionItem).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const suggestion=(await f.request()).suggestions.find((item:any)=>item.label==="amount");
    const pending=f.provider.resolveCompletionItem(suggestion,{});expect(finish).toBeTypeOf("function");
    context={...context,metadataVersion:2};finish({label:"amount",detail:"stale detail"});
    await expect(pending).resolves.toBe(suggestion);expect(suggestion.detail).not.toBe("stale detail");
  });
  it("bounds distinct physical snapshots across qualified projection inputs", async () => {
    const targets = Array.from({
        length: 17
      }, (_, i) => `t${i} x${i}`),
      outputs = Array.from({
        length: 17
      }, (_, i) => `x${i}.amount AS n${i}`);
    const f = fixture(`WITH q AS (SELECT ${outputs.join(",")} FROM ${targets.join(" CROSS JOIN ")}) SELECT q.Revenue<cursor> FROM q`, "postgres");
    const result = await f.request();
    expect(fields(result)).toHaveLength(16);
    expect("incomplete" in result && result.incomplete).toBe(true);
    expect(metadata.loadTableMetadata).toHaveBeenCalledTimes(16);
    expect(metadata.loadTableMetadata.mock.calls.every(([options]: any[]) => options.table !== "t16")).toBe(true);
  });
  it("checks a remote namespace before reading a same-key local snapshot", async () => {
    const shared = {
      caches: {
        fields: new Map(),
        joinConstraints: new Map()
      },
      generations: new Map<string, number>()
    };
    const local = fixture("SELECT l.Revenue<cursor> FROM ledger l", "sqlserver", shared);
    expect(fields(await local.request()).some((item: any) => item.label === "amount")).toBe(true);
    const remote = fixture("SELECT r.Revenue<cursor> FROM remote.db.app.ledger r", "sqlserver", shared);
    expect(fields(await remote.request())).toEqual([]);
    expect(metadata.loadTableMetadata).toHaveBeenCalledOnce();
  });
  it.each(["SELECT l.Revenue<cursor> FROM other.app.ledger l", "WITH q AS (SELECT amount AS net FROM other.app.ledger) SELECT q.Revenue<cursor> FROM q"])("routes a supported explicit database without replacing its identity: %s", async marked => {
    const f = fixture(marked, "sqlserver");
    expect(fields(await f.request()).length).toBeGreaterThan(0);
    expect(metadata.loadTableMetadata).toHaveBeenCalledWith(expect.objectContaining({
      databaseName: "other",
      schema: "app",
      table: "ledger"
    }));
  });
  it.each(["SELECT * FROM remote.db.app.le<cursor>", "SELECT * FROM other.le<cursor>", "SELECT * FROM other.app.le<cursor>"])("does not suggest local catalog objects in another namespace: %s", async marked => {
    const f = fixture(marked, "sqlserver");
    f.options.schemaTables = [{
      name: "ledger",
      type: "table"
    } as TableInfo];
    expect((await f.request()).suggestions.some((item: any) => item.kind === 22)).toBe(false);
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it("retains catalog suggestions for the declared local namespace", async () => {
    const f = fixture("SELECT * FROM db.app.le<cursor>", "sqlserver");
    f.options.schemaTables = [{
      name: "ledger",
      type: "table"
    } as TableInfo];
    expect((await f.request()).suggestions.some((item: any) => item.label === "ledger")).toBe(true);
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it.each(["SELECT * FROM remote.db.app.ledger r JOIN us<cursor>", "SELECT * FROM ledger l JOIN remote.db.app.us<cursor>"])("does not fabricate local foreign-key joins across a remote namespace: %s", async marked => {
    const f = fixture(marked, "sqlserver");
    await f.request();
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it("does not interpret a successful match as unique when another input cannot be read", async () => {
    metadata.loadTableMetadata.mockImplementation(async (options: any) => {
      if (options.table === "users") throw new Error("metadata unavailable");
      return {
        columns
      };
    });
    const f = fixture("WITH q AS (SELECT amount AS net FROM ledger l JOIN users u ON true) SELECT q.Revenue<cursor> FROM q", "postgres");
    expect(fields(await f.request())).toEqual([]);
    expect(metadata.loadTableMetadata).toHaveBeenCalledTimes(2);
  });
  it("distinguishes a complete empty schema from an unreadable schema", async () => {
    metadata.loadTableMetadata.mockImplementation(async (options: any) => ({
      columns: options.table === "users" ? [] : columns
    }));
    const f = fixture("WITH q AS (SELECT amount AS net FROM ledger l JOIN users u ON true) SELECT q.Revenue<cursor> FROM q", "postgres");
    expect(fields(await f.request()).some((item: any) => item.label === "net" && item.detail.includes("decimal"))).toBe(true);
    expect(metadata.loadTableMetadata).toHaveBeenCalledTimes(2);
  });
  it.each(["WITH q AS (SELECT amount AS net FROM ledger l JOIN fn() f ON true) SELECT q.Revenue<cursor> FROM q", "WITH q AS (SELECT amount AS net FROM ledger l JOIN remote.db.app.users u ON true) SELECT q.Revenue<cursor> FROM q", "WITH q AS (SELECT amount AS net FROM ledger l JOIN a.b.c.d.e u ON true) SELECT q.Revenue<cursor> FROM q"])("withholds unique inference across unknown inputs: %s", async marked => {
    const f = fixture(marked, "postgres");
    expect(fields(await f.request())).toEqual([]);
    expect(metadata.loadTableMetadata.mock.calls.every(([options]: any[]) => options.table === "ledger")).toBe(true);
  });
  it("preserves a qualified local source even when another input is remote", async () => {
    const f = fixture("WITH q AS (SELECT l.amount AS net FROM ledger l JOIN remote.db.app.users u ON true) SELECT q.Revenue<cursor> FROM q", "sqlserver");
    expect(fields(await f.request()).some((item: any) => item.label === "net" && item.detail.includes("decimal"))).toBe(true);
    expect(metadata.loadTableMetadata).toHaveBeenCalledOnce();
    expect(metadata.loadTableMetadata).toHaveBeenCalledWith(expect.objectContaining({
      table: "ledger"
    }));
  });
  it("bounds visible inputs before starting metadata reads", async () => {
    const sources = ["ledger l", ...Array.from({
      length: 16
    }, (_, i) => `users u${i}`)];
    const f = fixture(`WITH q AS (SELECT amount AS net FROM ${sources.join(" CROSS JOIN ")}) SELECT q.Revenue<cursor> FROM q`, "postgres");
    const result = await f.request();
    expect(fields(result)).toEqual([]);
    expect("incomplete" in result && result.incomplete).toBe(true);
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it.each(["SELECT r.Revenue<cursor> FROM [remote].[db].[app].[ledger] r", "SELECT r.Revenue<cursor> FROM [remote].[db]..[ledger] r", "SELECT r.Revenue<cursor> FROM remote...ledger r", "WITH q AS (SELECT amount AS net FROM remote.db.app.ledger) SELECT q.Revenue<cursor> FROM q", "SELECT r.Revenue<cursor> FROM remote.db.app.ledger r(net)", "SELECT r.Revenue<cursor> FROM [other]..[ledger] r"])("never resolves a remote or omitted-schema identity through the local cache: %s", async marked => {
    const f = fixture(marked, "sqlserver");
    expect(fields(await f.request())).toEqual([]);
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it.each(["WITH q AS (SELECT amount AS net FROM ledger l JOIN users u ON true) SELECT q.Revenue<cursor> FROM q", "WITH q AS (SELECT amount AS net FROM users u JOIN ledger l ON true) SELECT q.Revenue<cursor> FROM q", "WITH q AS (SELECT amount AS net FROM ledger l, users u) SELECT q.Revenue<cursor> FROM q", "SELECT d.Revenue<cursor> FROM (SELECT amount AS net FROM users u JOIN ledger l ON true) d", "WITH a AS (SELECT id FROM users),q AS (SELECT amount AS net FROM a JOIN ledger l ON true) SELECT q.Revenue<cursor> FROM q"])("infers an unqualified direct projection only after all bound inputs prove uniqueness: %s", async marked => {
    const f = fixture(marked, "postgres");
    const net = fields(await f.request()).find((item: any) => item.label === "net");
    expect(net).toBeDefined();
    expect(net.detail).toContain("decimal");
    expect(net.documentation.value).toContain("Revenue");
    expect(metadata.loadTableMetadata.mock.calls.map(([options]: any[]) => options.table).sort()).toEqual(["ledger", "users"]);
  });
  it("keeps projection renames out of the physical metadata cache", async () => {
    const shared = {
      caches: {
        fields: new Map(),
        joinConstraints: new Map()
      },
      generations: new Map<string, number>()
    };
    const local = fixture("WITH q AS (SELECT amount AS net FROM ledger) SELECT q.Revenue<cursor> FROM q", "postgres", shared);
    expect(fields(await local.request()).some((item: any) => item.label === "net")).toBe(true);
    const physical = fixture("SELECT l.Revenue<cursor> FROM ledger l", "postgres", shared);
    const names = fields(await physical.request()).map((item: any) => item.label);
    expect(names).toContain("amount");
    expect(names).not.toContain("net");
    expect(metadata.loadTableMetadata).toHaveBeenCalledOnce();
  });
  it.each(["mysql", "postgres", "sqlite", "sqlserver", "hive", "clickhouse"])("preserves local pinyin/comment metadata and canonical edits for %s", async driver => {
    const f = fixture("/* 😀 */\r\nWITH q AS (SELECT amount AS net FROM ledger) SELECT q.yysr<cursor>suffix FROM q", driver);
    const item = fields(await f.request()).find((item: any) => item.label === "net");
    expect(item.detail).toContain("decimal");
    expect(item.documentation.value).toContain("营业收入");
    expect(item.filterText).toBe("yysr");
    expect(f.accept(item)).toBe("/* 😀 */\r\nWITH q AS (SELECT amount AS net FROM ledger) SELECT q.net FROM q");
    expect(metadata.loadTableMetadata).toHaveBeenCalledOnce();
  });
  it("rebuilds inherited metadata after revisions without changing SQL", async () => {
    const shared = {
      caches: {
        fields: new Map(),
        joinConstraints: new Map()
      },
      generations: new Map<string, number>()
    };
    const sql = "WITH q AS (SELECT amount AS net FROM ledger) SELECT q.Revenue<cursor> FROM q";
    const first = fixture(sql, "postgres", shared, 1);
    expect(fields(await first.request()).some((item: any) => item.label === "net")).toBe(true);
    metadata.loadTableMetadata.mockResolvedValue({
      columns: [{
        name: "amount",
        data_type: "bigint",
        comment: "other"
      }]
    });
    const second = fixture(sql, "postgres", shared, 2);
    expect(fields(await second.request())).toEqual([]);
    metadata.loadTableMetadata.mockResolvedValue({
      columns: [{
        name: "amount",
        data_type: "bigint",
        comment: "Revenue"
      }]
    });
    const third = fixture(sql, "postgres", shared, 3),
      item = fields(await third.request()).find((item: any) => item.label === "net");
    expect(item.detail).toContain("bigint");
    expect(first.text()).toBe(second.text());
    expect(second.text()).toBe(third.text());
    expect(metadata.loadTableMetadata).toHaveBeenCalledTimes(3);
  });
  it("keeps SQL Server TOP as a projection modifier", async () => {
    const f = fixture("WITH q AS (SELECT TOP (10) amount AS net FROM ledger) SELECT q.Revenue<cursor> FROM q", "sqlserver");
    expect(fields(await f.request()).some((item: any) => item.label === "net" && item.detail.includes("decimal"))).toBe(true);
  });
  it("restricts a qualified wildcard to its own joined input", async () => {
    const f = fixture("WITH q AS (SELECT l.* FROM ledger l JOIN archive a ON true) SELECT q.Revenue<cursor> FROM q", "postgres");
    const result = fields(await f.request());
    expect(result.some((item: any) => item.label === "amount")).toBe(true);
    expect(result.some((item: any) => item.label === "secret")).toBe(false);
    expect(metadata.loadTableMetadata).toHaveBeenCalledOnce();
    expect(metadata.loadTableMetadata).toHaveBeenCalledWith(expect.objectContaining({
      table: "ledger"
    }));
  });
  it.each(["WITH q AS (SELECT amount FROM ledger) SELECT r.Revenue<cursor> FROM q r(net)", "WITH q(orig) AS (SELECT amount FROM ledger) SELECT r.Revenue<cursor> FROM q r(net)", "WITH q AS (SELECT ((amount)) AS net FROM ledger) SELECT q.Revenue<cursor> FROM q", "WITH q(z,net,r) AS (SELECT * FROM ledger) SELECT q.Revenue<cursor> FROM q", "WITH q AS (SELECT l.amount /* source */ AS net FROM ledger l JOIN archive a ON true) SELECT q.Revenue<cursor> FROM q"])("resolves ordinal renames and direct identity without looking up local names: %s", async marked => {
    const f = fixture(marked, "postgres");
    const net = fields(await f.request()).find((item: any) => item.label === "net");
    expect(net).toBeDefined();
    expect(net.detail).toContain("decimal");
    expect(net.documentation.value).toContain("Revenue");
    expect(metadata.loadTableMetadata).toHaveBeenCalledOnce();
    expect(metadata.loadTableMetadata).toHaveBeenCalledWith(expect.objectContaining({
      table: "ledger"
    }));
  });
  it.each(["Net", "window", "net;total"])("inserts the exact local name with necessary quotes: %s", async name => {
    const f = fixture(`WITH q("${name}") AS (SELECT amount FROM ledger) SELECT q.Revenue<cursor> FROM q`, "postgres");
    const item = fields(await f.request()).find((item: any) => item.label === name);
    expect(item).toBeDefined();
    expect(item.detail).toContain("decimal");
    expect(f.accept(item)).toContain(`q."${name}" FROM q`);
  });
  it.each([
    ["mysql", "`Net 总额`"], ["postgres", '"Net 总额"'],
    ["sqlite", '"Net 总额"'], ["sqlserver", "[Net 总额]"],
    ["hive", "`Net 总额`"], ["clickhouse", "`Net 总额`"],
  ] as const)("accepts comment-matched quoted CTE output and the entire suffix for %s", async (driver, quoted) => {
    const capabilities = {...databaseDriverProfile(driver).capabilities, driver};
    registerDatabaseCapabilities({...capabilities, identifierQuote: quoted[0]!});
    try {
    const f = fixture(`WITH q AS (SELECT amount AS ${quoted} FROM ledger) SELECT q.Revenue<cursor>suffix FROM q`, driver);
    const item = fields(await f.request()).find((item: any) => item.label === "Net 总额");
    expect(item).toBeDefined();
    expect(item.detail).toContain("decimal");
    expect(item.documentation.value).toContain("Revenue");
    expect(f.accept(item)).toBe(`WITH q AS (SELECT amount AS ${quoted} FROM ledger) SELECT q.${quoted} FROM q`);
    expect(metadata.loadTableMetadata).toHaveBeenCalledOnce();
    expect(metadata.loadTableMetadata).toHaveBeenCalledWith(expect.objectContaining({table: "ledger"}));
    } finally {
      registerDatabaseCapabilities(capabilities);
    }
  });
  it("preserves quoted source identity and PostgreSQL case folding", async () => {
    metadata.loadTableMetadata.mockResolvedValue({
      columns: [{
        name: "Amount",
        data_type: "numeric",
        comment: "Revenue"
      }]
    });
    const quoted = fixture('WITH q AS (SELECT "Amount" AS net FROM ledger) SELECT q.Revenue<cursor> FROM q', "postgres");
    expect(fields(await quoted.request()).some((item: any) => item.label === "net" && item.detail.includes("numeric"))).toBe(true);
    const unquoted = fixture('WITH q AS (SELECT Amount AS net FROM ledger) SELECT q.Revenue<cursor> FROM q', "postgres");
    expect(fields(await unquoted.request())).toEqual([]);
  });
  it("uses Oracle folding for source columns and quotes lowercase local names", async () => {
    metadata.loadTableMetadata.mockResolvedValue({
      columns: [{
        name: "AMOUNT",
        data_type: "NUMBER",
        comment: "Revenue"
      }]
    });
    const f = fixture('WITH q("net") AS (SELECT amount FROM ledger) SELECT q.Revenue<cursor> FROM q', "oracle");
    const item = fields(await f.request()).find((item: any) => item.label === "net");
    expect(item.detail).toContain("NUMBER");
    expect(f.accept(item)).toContain('q."net" FROM q');
  });
  it.each(["WITH q AS (SELECT amount * 2 AS net FROM ledger) SELECT q.Revenue<cursor> FROM q", "WITH q AS (SELECT other.amount AS net FROM ledger l) SELECT q.Revenue<cursor> FROM q", "WITH q AS (SELECT ledger.amount AS net FROM ledger l) SELECT q.Revenue<cursor> FROM q", "WITH q AS (SELECT amount AS net FROM ledger l JOIN users u ON true) SELECT q.Revenue<cursor> FROM q", "WITH q(net) AS (SELECT amount FROM ledger UNION ALL SELECT secret FROM archive) SELECT q.Revenue<cursor> FROM q", "WITH RECURSIVE q(net) AS (SELECT net FROM q) SELECT q.Revenue<cursor> FROM q"])("does not borrow comments for computed, ambiguous, invalid or recursive outputs: %s", async marked => {
    if (marked.includes("JOIN users")) metadata.loadTableMetadata.mockImplementation(async (options: any) => ({
      columns: options.table === "users" ? [{
        name: "amount",
        data_type: "text",
        comment: "Revenue collision"
      }] : columns
    }));
    const f = fixture(marked, "postgres");
    expect(fields(await f.request())).toEqual([]);
    expect(metadata.loadTableMetadata).toHaveBeenCalledTimes(marked.includes("JOIN users") ? 2 : 0);
  });
  it.each(["WITH q AS (SELECT amount /* keep source */ AS net FROM ledger) SELECT q.Revenue<cursor> FROM q", "WITH q AS (SELECT DISTINCT amount AS net FROM ledger) SELECT q.Revenue<cursor> FROM q", "WITH q AS (SELECT amount AS net FROM ledger l JOIN users u ON true) SELECT q.ne<cursor> FROM q"])("keeps direct identity and explicit unknown names separate: %s", async marked => {
    if (marked.includes("JOIN")) metadata.loadTableMetadata.mockImplementation(async (options: any) => ({
      columns: options.table === "users" ? [{
        name: "amount",
        data_type: "text",
        comment: "Revenue collision"
      }] : columns
    }));
    const f = fixture(marked, "postgres");
    const net = fields(await f.request()).find((item: any) => item.label === "net");
    expect(net).toBeDefined();
    if (marked.includes("JOIN")) {
      expect(net.detail).toContain("CTE");
      expect(net.documentation.value).not.toContain("Revenue");
      expect(metadata.loadTableMetadata).toHaveBeenCalledTimes(2);
    } else {
      expect(net.detail).toContain("decimal");
      expect(net.documentation.value).toContain("Revenue");
      expect(metadata.loadTableMetadata).toHaveBeenCalledOnce();
    }
  });
  it("keeps schema-qualified physical names independent of same-named CTEs", async () => {
    const f = fixture("WITH q(net) AS MATERIALIZED (SELECT 1) SELECT p.Revenue<cursor> FROM other.q p", "postgres");
    expect(fields(await f.request()).some((item: any) => item.label === "amount")).toBe(true);
    expect(metadata.loadTableMetadata).toHaveBeenCalledWith(expect.objectContaining({
      table: "q",
      schema: "other"
    }));
  });
  it("does not interpret SQL Server table hints as WITH declarations", async () => {
    const f = fixture("SELECT Revenue<cursor> FROM ledger l WITH (NOLOCK), archive a", "sqlserver");
    expect(fields(await f.request())).toEqual([]);
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it.each(["WITH q AS (SELECT amount AS net FROM ledger) SELECT q.Revenue<cursor> FROM q", "WITH q(net) AS MATERIALIZED (SELECT amount FROM ledger) SELECT q.Revenue<cursor> FROM q", "WITH q(net) AS NOT MATERIALIZED (SELECT amount FROM ledger) SELECT q.Revenue<cursor> FROM q", "SELECT d.Revenue<cursor> FROM (SELECT amount AS net FROM ledger) d", "WITH a AS (SELECT amount FROM ledger), b(net) AS (SELECT amount FROM a) SELECT b.Revenue<cursor> FROM b", "WITH q AS (SELECT l.* FROM ledger l) SELECT q.Revenue<cursor> FROM q", "SELECT d.Revenue<cursor> FROM (SELECT amount FROM ledger) d(net)"])("inherits real metadata through local direct projections: %s", async marked => {
    const f = fixture(marked, "postgres");
    const item = fields(await f.request()).find((item: any) => item.label === (marked.includes("net") ? "net" : "amount"));
    expect(item).toBeDefined();
    expect(item.detail).toContain("decimal");
    expect(item.documentation.value).toContain("营业收入");
    expect(metadata.loadTableMetadata.mock.calls.every(([options]: any[]) => options.table === "ledger")).toBe(true);
    expect(metadata.loadTableMetadata).toHaveBeenCalledOnce();
  });
  it.each(['WITH q("net)total") AS (SELECT amount FROM ledger) SELECT q.Revenue<cursor> FROM q', 'SELECT d.Revenue<cursor> FROM (SELECT amount FROM ledger) d("net)total")'])("keeps quoted delimiters inside local output names: %s", async marked => {
    const f = fixture(marked, "postgres");
    const item = fields(await f.request()).find((item: any) => item.label === "net)total");
    expect(item).toBeDefined();
    expect(item.detail).toContain("decimal");
    expect(f.accept(item)).toContain('."net)total"');
    expect(metadata.loadTableMetadata.mock.calls.every(([options]: any[]) => options.table === "ledger")).toBe(true);
  });
  it.each(["<cursor>SELECT * FROM ledger l", "/* comment */ <cursor>SELECT * FROM ledger l", "SELECT 1; <cursor>SELECT * FROM ledger l"])("does not borrow future fields before a query starts: %s", async marked => {
    const f = fixture(marked, "postgres");
    expect(fields(await f.request())).toEqual([]);
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it.each(["SELECT ledger.rev<cursor> FROM ledger EXCEPT SELECT * FROM archive", "SELECT ledger.rev<cursor> FROM ledger QUALIFY row_number() OVER () = 1", "SELECT ledger.rev<cursor> FROM ledger WINDOW w AS (ORDER BY amount)"])("does not turn following clause words into table aliases: %s", async marked => {
    const f = fixture(marked, marked.includes("QUALIFY") ? "clickhouse" : "postgres");
    expect(fields(await f.request()).some((item: any) => item.label === "amount")).toBe(true);
  });
  it.each(["SELECT d.ne<cursor> FROM users u,(SELECT amount AS net FROM ledger) d", 'SELECT d.ne<cursor> FROM (SELECT "odd)from" AS net FROM ledger) d', "SELECT f.ne<cursor> FROM users u, fn(1) AS f(net)", "SELECT l.ne<cursor> FROM ledger AS l(net)"])("uses local outputs and reads only their explicit physical source: %s", async marked => {
    const f = fixture(marked, "postgres");
    expect(fields(await f.request()).some((item: any) => item.label === "net")).toBe(true);
    expect(metadata.loadTableMetadata).toHaveBeenCalledTimes(marked.includes("fn(") ? 0 : 1);
    expect(metadata.loadTableMetadata.mock.calls.every(([options]: any[]) => options.table === "ledger")).toBe(true);
  });
  it.each(["SELECT rev<cursor> FROM ledger l,(SELECT secret FROM archive) d", "SELECT rev<cursor> FROM ledger l, fn(1)", "SELECT rev<cursor> FROM ledger l, fn(1) f", "SELECT rev<cursor> FROM ledger l, users u(id)"])("includes unknown local inputs in ambiguity checks: %s", async marked => {
    const f = fixture(marked, "postgres");
    expect(fields(await f.request())).toEqual([]);
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it("accepts quoted keyword aliases while preserving the qualifier", async () => {
    const f = fixture('SELECT "from".rev<cursor> FROM ledger "from"', "postgres");
    const item = fields(await f.request()).find((item: any) => item.label === "amount");
    expect(item).toBeDefined();
    expect(f.accept(item)).toBe('SELECT "from".amount FROM ledger "from"');
  });
  it.each(["SELECT l.rev<cursor> FROM archive a, ledger l", "SELECT * FROM archive a, ledger l WHERE l.rev<cursor>", "SELECT row_number() OVER (ORDER BY l.rev<cursor>) FROM ledger l", "SELECT * FROM archive a INTERSECT SELECT l.rev<cursor> FROM ledger l EXCEPT SELECT * FROM archive a", "SELECT * FROM archive a MINUS SELECT l.rev<cursor> FROM ledger l"])("binds comma inputs, window expressions and set-operation branches: %s", async marked => {
    const f = fixture(marked, marked.includes("MINUS") ? "oracle" : "postgres");
    expect(fields(await f.request()).some((item: any) => item.label === "amount")).toBe(true);
    expect(metadata.loadTableMetadata.mock.calls.every(([options]: any[]) => options.table === "ledger")).toBe(true);
  });
  it.each(["SELECT rev<cursor> FROM ledger l, archive a", "SELECT rev<cursor> FROM ledger l, users u JOIN archive a ON true", "SELECT * FROM ledger l, (SELECT l.rev<cursor> FROM users u) q"])("rejects ambiguous or inaccessible comma inputs: %s", async marked => {
    const f = fixture(marked, "postgres");
    expect(fields(await f.request())).toEqual([]);
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it.each(["WITH q(net) AS (SELECT amount FROM ledger) SELECT q.ne<cursor> FROM q", "SELECT d.ne<cursor> FROM (SELECT amount AS net FROM ledger) d", "WITH RECURSIVE first AS (SELECT q.ne<cursor> FROM q), q(net) AS (SELECT 1) SELECT * FROM first"])("keeps declared local columns before a following FROM: %s", async marked => {
    const f = fixture(marked, "postgres");
    const net = fields(await f.request()).find((item: any) => item.label === "net");
    expect(net).toBeDefined();
    expect(f.accept(net)).toContain(".net FROM");
    expect(metadata.loadTableMetadata).toHaveBeenCalledTimes(marked.includes("SELECT 1") ? 0 : 1);
    expect(metadata.loadTableMetadata.mock.calls.every(([options]: any[]) => options.table === "ledger")).toBe(true);
  });
  it.each(["WITH first AS (SELECT q.ne<cursor> FROM q), q(net) AS (SELECT 1) SELECT * FROM first", "WITH q(net) AS (SELECT 1) SELECT q.ne<cursor> FROM users u", "WITH q(net) AS (SELECT 1) SELECT q.ne<cursor> FROM q renamed", "WITH q(net) AS (SELECT 1) SELECT q.ne<cursor> FROM users u\n\nSELECT * FROM q"])("does not invent undeclared or unbound local columns: %s", async marked => {
    const f = fixture(marked, "postgres");
    expect(fields(await f.request())).toEqual([]);
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it.each(["mysql", "postgres", "sqlite", "sqlserver", "hive", "clickhouse"])("binds a SELECT member before its following FROM for %s", async driver => {
    const f = fixture("/* 😀 */\r\nSELECT l.rev<cursor>suffix FROM ledger l;", driver);
    const amount = fields(await f.request()).find((item: any) => item.label === "amount");
    expect(amount).toBeDefined();
    expect(amount.detail).toContain("decimal");
    expect(f.accept(amount)).toBe("/* 😀 */\r\nSELECT l.amount FROM ledger l;");
    expect(metadata.loadTableMetadata).toHaveBeenCalledWith(expect.objectContaining({
      table: "ledger"
    }));
  });
  it.each(["SELECT rev<cursor> FROM ledger l", "SELECT (SELECT l.rev<cursor> FROM users u) FROM ledger l", "SELECT * FROM archive a WHERE EXISTS(SELECT l.rev<cursor> FROM ledger l)", "SELECT l.rev<cursor> FROM ledger l UNION ALL SELECT * FROM archive a", "SELECT * FROM archive a UNION ALL SELECT l.rev<cursor> FROM ledger l", "SELECT l.rev<cursor> FROM ledger l; SELECT * FROM archive a", "SELECT l.rev<cursor> FROM ledger l\n\nSELECT * FROM archive a", "SELECT l.rev<cursor> FROM ledger l JOIN (SELECT * FROM archive l) a ON true", "SELECT * FROM ledger l JOIN LATERAL (SELECT l.rev<cursor> FROM users u) a ON true", "SELECT * FROM ledger l CROSS APPLY (SELECT l.rev<cursor> FROM users u) a", "SELECT l.rev<cursor>, '(;)' FROM ledger l", 'SELECT "l(x)".rev<cursor> FROM ledger "l(x)"'])("binds full-document sources without crossing query ownership: %s", async marked => {
    const f = fixture(marked, "postgres");
    expect(fields(await f.request()).some((item: any) => item.label === "amount")).toBe(true);
    expect(metadata.loadTableMetadata.mock.calls.every(([options]: any[]) => options.table !== "archive")).toBe(true);
  });
  it.each(["SELECT l.rev<cursor> FROM users u; SELECT * FROM ledger l", "SELECT l.rev<cursor> FROM users u\n\nSELECT * FROM ledger l", "SELECT l.rev<cursor> FROM users u UNION ALL SELECT * FROM ledger l", "SELECT * FROM ledger l UNION ALL SELECT l.rev<cursor> FROM users u", "SELECT * FROM ledger l JOIN (SELECT l.rev<cursor> FROM users u) q ON true", "SELECT * FROM ledger l JOIN LATERAL (SELECT future.rev<cursor> FROM users u) q ON true JOIN ledger future ON true", "SELECT * FROM users u JOIN users v ON future.rev<cursor> JOIN ledger future ON true", "WITH q AS (SELECT l.rev<cursor> FROM users u) SELECT * FROM ledger l", "SELECT rev<cursor> FROM ledger l JOIN archive a ON true", "SELECT x.rev<cursor> FROM ledger x JOIN archive x ON true"])("rejects future/inaccessible full-document sources: %s", async marked => {
    const f = fixture(marked, "postgres");
    expect(fields(await f.request())).toEqual([]);
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it.each(["mysql", "postgres", "sqlite", "sqlserver", "hive", "clickhouse"])("matches comments and replaces complete UTF-16 members for %s", async driver => {
    const f = fixture("/* 😀 */\r\nSELECT * FROM ledger l WHERE l.rev<cursor>suffix;", driver);
    const result = await f.request();
    const items = fields(result);
    expect(items.map((i: any) => i.label)).toEqual(["rev_exact", "amount"]);
    const amount = items.find((i: any) => i.label === "amount");
    expect(amount.detail).toContain("decimal");
    expect(amount.filterText).toBe("rev");
    expect(f.accept(amount)).toBe("/* 😀 */\r\nSELECT * FROM ledger l WHERE l.amount;");
    expect(f.client.getCompletionList).not.toHaveBeenCalled();
    expect(metadata.loadTableMetadata).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project",
      connectionId: "connection",
      schema: "app",
      databaseName: "db",
      table: "ledger"
    }));
  });
  it.each(["zj", "yysr", "营业", "rva"])("retains pinyin/Chinese/fuzzy auxiliary query %s", async query => {
    const f = fixture(`SELECT * FROM ledger l WHERE l.${query}<cursor>`);
    const items = fields(await f.request());
    const name = query === "zj" ? "租金总额" : "amount";
    const item = items.find((i: any) => i.label === name);
    expect(item).toBeDefined();
    expect(item.filterText).toBe(query);
    expect(f.accept(item)).not.toContain(query);
  });
  it("merges cached comments through a healthy but empty live provider", async () => {
    const f = fixture("SELECT * FROM ledger l WHERE l.rev<cursor>", "mysql", undefined, 1, true);
    expect(fields(await f.request()).some((i: any) => i.label === "amount")).toBe(true);
    expect(f.client.getCompletionList).toHaveBeenCalledOnce();
  });
  it.each([["SELECT * FROM ledger l WHERE EXISTS(SELECT 1 FROM archive l) AND l.rev<cursor>", "amount"], ["SELECT * FROM archive a UNION SELECT * FROM ledger l WHERE rev<cursor>", "amount"], ["SELECT * FROM ledger l WHERE EXISTS(SELECT 1 FROM users u WHERE l.rev<cursor>", "amount"], ["SELECT * FROM ledger l JOIN LATERAL (SELECT 1 FROM users u WHERE l.rev<cursor>", "amount"], ["SELECT * FROM archive a JOIN (SELECT * FROM ledger l WHERE EXISTS(SELECT 1 FROM users u WHERE l.rev<cursor>", "amount"]])("uses the visible binding for complex query %s", async (marked, name) => {
    const f = fixture(marked, "postgres");
    const items = fields(await f.request());
    expect(items.some((i: any) => i.label === name)).toBe(true);
    expect(items.some((i: any) => i.label === "secret")).toBe(false);
  });
  it.each(["SELECT * FROM ledger l JOIN (SELECT 1 FROM users u WHERE l.rev<cursor>", "SELECT * FROM ledger x JOIN archive x ON true WHERE x.rev<cursor>", "SELECT * FROM ledger l; SELECT * FROM users u WHERE u.rev<cursor>", "SELECT * FROM ledger l JOIN archive a ON true WHERE rev<cursor>", "SELECT * FROM ledger WHERE 'rev<cursor>'", "SELECT * FROM ledger WHERE 1 /* rev<cursor> */"])("rejects inaccessible/ambiguous/noise bindings for %s", async marked => {
    const f = fixture(marked, "postgres");
    expect(fields(await f.request())).toEqual([]);
  });
  it("keys cached fields by metadata revision without changing SQL", async () => {
    const f = fixture("SELECT * FROM ledger l WHERE l.rev<cursor>");
    expect(fields(await f.request()).some((i: any) => i.label === "amount")).toBe(true);
    metadata.loadTableMetadata.mockResolvedValue({
      columns: [{
        name: "amount",
        data_type: "bigint",
        comment: "other"
      }]
    });
    const newer = fixture("SELECT * FROM ledger l WHERE l.rev<cursor>", "mysql", f, 2);
    expect(fields(await newer.request()).some((i: any) => i.label === "amount")).toBe(false);
    expect(metadata.loadTableMetadata).toHaveBeenCalledTimes(2);
  });
  it("bounds matching fields after ranking and signals a requery", async () => {
    metadata.loadTableMetadata.mockResolvedValue({
      columns: [...Array.from({
        length: 600
      }, (_, i) => ({
        name: `v${String(i).padStart(3, "0")}`,
        data_type: "int",
        comment: "Revenue"
      })), {
        name: "rev",
        data_type: "bigint"
      }]
    });
    const f = fixture("SELECT * FROM ledger l WHERE l.rev<cursor>");
    const result = await f.request();
    expect(fields(result)).toHaveLength(256);
    expect(fields(result)[0].label).toBe("rev");
    expect(result).toMatchObject({
      incomplete: true
    });
    const precise = fixture("SELECT * FROM ledger l WHERE l.v599<cursor>", "mysql", f);
    expect(fields(await precise.request()).map((i: any) => i.label)).toEqual(["v599"]);
  });
  it("discards a cancelled or edited metadata request", async () => {
    let finish!: (value: any) => void;
    metadata.loadTableMetadata.mockReturnValue(new Promise(resolve => {
      finish = resolve;
    }));
    const f = fixture("SELECT * FROM ledger l WHERE l.rev<cursor>");
    const pending = f.request();
    f.replace();
    finish({
      columns
    });
    expect(fields(await pending)).toEqual([]);
  });
  it("does not let an older metadata load overwrite a newer revision", async () => {
    let finish!: (value: any) => void;
    metadata.loadTableMetadata.mockReturnValueOnce(new Promise(resolve => {
      finish = resolve;
    })).mockResolvedValue({
      columns: [{
        name: "amount",
        data_type: "bigint",
        comment: "other"
      }]
    });
    const old = fixture("SELECT * FROM ledger l WHERE l.rev<cursor>");
    const pending = old.request();
    const newer = fixture("SELECT * FROM ledger l WHERE l.rev<cursor>", "mysql", old, 2);
    expect(fields(await newer.request()).some((item: any) => item.label === "amount")).toBe(false);
    finish({
      columns
    });
    expect(fields(await pending)).toEqual([]);
    expect(fields(await newer.request()).some((item: any) => item.label === "amount")).toBe(false);
  });
  it.each([["postgres", '"rev<cursor>suffix"', 'a"b', '"a""b"'], ["mysql", '`rev<cursor>suffix`', 'a`b', '`a``b`'], ["sqlserver", '[rev<cursor>suffix]', 'a]b', '[a]]b]'], ["postgres", 'rev<cursor>suffix', 'gross.amount', '"gross.amount"'], ["mysql", 'rev<cursor>suffix', 'gross.amount', '`gross.amount`']])("replaces a complete quoted metadata atom for %s", async (driver, fragment, name, expected) => {
    metadata.loadTableMetadata.mockResolvedValue({
      columns: [{
        name,
        data_type: "decimal",
        comment: "Revenue"
      }]
    });
    const f = fixture(`SELECT * FROM ledger l WHERE l.${fragment};`, driver);
    const item = fields(await f.request()).find((i: any) => i.label === name);
    expect(item).toBeDefined();
    expect(f.accept(item)).toBe(`SELECT * FROM ledger l WHERE l.${expected};`);
  });
  it("does not fetch metadata after cancellation", async () => {
    const f = fixture("SELECT * FROM ledger l WHERE l.rev<cursor>");
    expect(fields(await f.request({
      isCancellationRequested: true
    }))).toEqual([]);
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it("does not pin an unbounded number of table snapshots", async () => {
    const shared = {
      caches: {
        fields: new Map(),
        joinConstraints: new Map()
      },
      generations: new Map<string, number>()
    };
    for (let i = 0; i < 129; i++) {
      const f = fixture(`SELECT * FROM ledger_${i} l WHERE l.rev<cursor>`, "mysql", shared);
      await f.request();
    }
    expect(shared.caches.fields.size).toBe(128);
    const first = fixture("SELECT * FROM ledger_0 l WHERE l.rev<cursor>", "mysql", shared);
    await first.request();
    expect(metadata.loadTableMetadata).toHaveBeenCalledTimes(130);
  });
  it("limits documentation and declines oversized snapshot retention", async () => {
    metadata.loadTableMetadata.mockResolvedValue({
      columns: Array.from({
        length: 520
      }, (_, i) => ({
        name: `v${i}`,
        data_type: "int",
        comment: "Revenue" + "x".repeat(10000)
      }))
    });
    const f = fixture("SELECT * FROM ledger l WHERE l.rev<cursor>");
    const result = await f.request();
    expect(fields(result)).toHaveLength(256);
    expect(fields(result)[0].documentation.value.length).toBeLessThanOrEqual(8192);
    expect(f.caches.fields.size).toBe(0);
  });
  it("keeps auxiliary comment searches within a UTF-8 budget", async () => {
    metadata.loadTableMetadata.mockResolvedValue({
      columns: [{
        name: "amount",
        data_type: "decimal",
        comment: "界".repeat(700) + "needle"
      }]
    });
    const f = fixture("SELECT * FROM ledger l WHERE l.needle<cursor>");
    expect(fields(await f.request())).toEqual([]);
  });
  it("does not interpret quoted SQL keywords or completed sibling CTEs as inputs", async () => {
    const f = fixture('WITH q AS(SELECT "FROM archive l" FROM users) SELECT * FROM ledger l WHERE l.rev<cursor>');
    const items = fields(await f.request());
    expect(items.some((i: any) => i.label === "amount")).toBe(true);
    expect(items.some((i: any) => i.label === "secret")).toBe(false);
  });
  it("fails closed on exhausted query nesting budget", async () => {
    const f = fixture("SELECT * FROM ledger l WHERE " + "(".repeat(130) + "SELECT l.rev<cursor>");
    expect(fields(await f.request())).toEqual([]);
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it("never loads a partial FROM target and reports a bounded relation list", async () => {
    const f = fixture("SELECT * FROM archive_<cursor>");
    f.options.schemaTables = Array.from({
      length: 600
    }, (_, i) => ({
      name: `archive_${i}`
    }));
    const result = await f.request();
    expect(result.suggestions.filter((i: any) => i.kind === 22)).toHaveLength(512);
    expect(result).toMatchObject({
      incomplete: true
    });
    expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
  });
  it("shares concurrent metadata work within one completion request", async () => {
    let finish!: (value: any) => void;
    metadata.loadTableMetadata.mockReturnValue(new Promise(resolve => {
      finish = resolve;
    }));
    const f = fixture("SELECT * FROM ledger l WHERE l.rev<cursor>");
    const request = createCachedSqlCompletionRequest(f.options, f.caches, {
      model: f.model,
      monaco,
      position: f.position,
      textBeforeCursor: f.text(),
      completionDriver: "mysql",
      token: {}
    });
    const first = request.metadataSuggestions(),
      second = request.metadataSuggestions();
    expect(metadata.loadTableMetadata).toHaveBeenCalledOnce();
    finish({
      columns
    });
    expect(await first).toEqual(await second);
  });
});
