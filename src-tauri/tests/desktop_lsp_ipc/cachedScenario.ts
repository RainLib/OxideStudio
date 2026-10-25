import type * as Monaco from "monaco-editor";
import type { LspClient } from "@/services/lsp/client/LspClient";
import { getSqlDocumentUri } from "@/services/lsp/document";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";
import { databaseDriverProfile, registerDatabaseCapabilities } from "@/features/database-drivers/model/runtimeCatalog";
import { createCachedSqlCompletionRequest, type CachedSqlCompletionCaches, type CachedSqlCompletionSourceOptions } from "@/features/query-editor/model/cachedSqlCompletion";
import { cachedMetadataKey, rememberCachedFields } from "@/features/query-editor/model/cached-completion/fieldCache";
import type { CachedSearchColumn } from "@/features/query-editor/model/cached-completion/metadataSearch";
import { createQueryCompletionProvider } from "@/features/query-editor/model/createQueryCompletionProvider";
import { registerLspCompletionProvider } from "@/features/query-editor/hooks/useLspCompletionProviderCoordinator";
import {attachCompletionContextRefresh} from "@/features/query-editor/model/completionContextRefresh";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
type Environment = {
  monaco: typeof import("monaco-editor/esm/vs/editor/editor.api.js");
  editor: Monaco.editor.IStandaloneCodeEditor;
  client: LspClient;
  check: (value: unknown, message: string) => asserts value;
  step: (name: string, action: () => Promise<void>) => Promise<void>;
};

/** Actual provider/coordinator/Monaco; the input is an explicit preloaded
 * metadata fixture. No table-loader or completion-algorithm replacement. */
export async function runCachedCompletionAcceptance(environment: Environment) {
  const {
    monaco,
    editor,
    client,
    step
  } = environment;
  const check: Environment["check"] = environment.check;
  const original = editor.getModel();
  const models = new Map<string, Monaco.editor.ITextModel>();
  class ObservedFields extends Map<string, CachedSearchColumn[]> {
    misses: string[] = [];
    get(key: string) {
      const value = super.get(key);
      if (!value) this.misses.push(key);
      return value;
    }
  }
  const fields = new ObservedFields();
  const caches: CachedSqlCompletionCaches = {
    fields,
    joinConstraints: new Map()
  };
  let options: CachedSqlCompletionSourceOptions = {
    activeProjectId: "desktop-cache-fixture",
    connectionId: "cached-connection",
    driver: "mysql",
    metadataRevision: 1,
    databaseName: "db",
    currentSchema: "app",
    schemaTables: [],
    sqlCompletion: {
      ...DEFAULT_APP_SETTINGS.editor.sqlCompletion,
      rankByUsage: false,
      appendSpace: false,
      snippets: []
    },
    sqlFormatting: DEFAULT_APP_SETTINGS.editor.sqlFormatting
  };
  const generations = {
      current: new Map<string, number>()
    },
    opened = {
      current: new Set<string>()
    },
    versions = {
      current: new Map<string, number>()
    },
    texts = {
      current: new Map<string, string>()
    };
  let current!: Monaco.editor.ITextModel,
    live = false;
  let context:CompletionContextState|undefined;
  let contextRefresh:ReturnType<typeof attachCompletionContextRefresh>|undefined;
  let contextWidgetWithdrawal=false,contextWidgetRecovery=false;
  let runtime!: ReturnType<Parameters<typeof registerLspCompletionProvider>[0]["getRuntime"]>;
  const trace:Array<Record<string,unknown>>=[];
  const traceEvent=(event:string,data:Record<string,unknown>={})=>{
    trace.push({event,at:performance.now(),uri:editor.getModel()?.uri.toString(),version:editor.getModel()?.getVersionId(),owner:runtime?.ownerKey,...data});
    if(trace.length>256)trace.shift();
  };
  let traceRequest=0;
  const tracedMonaco={...monaco,languages:{...monaco.languages,registerCompletionItemProvider:(language:string,provider:any)=>monaco.languages.registerCompletionItemProvider(language,{...provider,
    provideCompletionItems:async(model:any,position:any,requestContext:any,token:any)=>{
      const id=++traceRequest,uri=model.uri.toString(),version=model.getVersionId();traceEvent("provider-start",{id,requestedUri:uri,requestedVersion:version,position});
      const cancelled=token?.onCancellationRequested?.(()=>traceEvent("provider-cancel",{id,requestedUri:uri}));
      try{const result=await provider.provideCompletionItems(model,position,requestContext,token);
        traceEvent("provider-end",{id,requestedUri:uri,requestedVersion:version,cancelled:Boolean(token?.isCancellationRequested),labels:result?.suggestions?.slice(0,12).map((item:any)=>typeof item.label==="string"?item.label:item.label.label)});return result;
      }catch(error){traceEvent("provider-error",{id,message:String(error)});throw error;}finally{cancelled?.dispose();}
    },
  })}};
  const fixtureColumns: CachedSearchColumn[] = [{
    name: "租金总额",
    dataType: "decimal"
  }, {
    name: "amount",
    dataType: "decimal",
    comment: "营业收入 Revenue amount"
  }, {
    name: "rev_exact",
    dataType: "bigint"
  }];
  const seed = (table: string, columns: CachedSearchColumn[]) => rememberCachedFields(fields, cachedMetadataKey(options, "db", "app", [table]), columns);
  const rebuild = () => {
    const snapshot = options,
      uri = current.uri.toString();
    const provider = createQueryCompletionProvider({
      getCompletionContext:context?()=>context!:undefined,
      monaco,
      completionTriggerOriginRef: {
        current: null
      },
      documentUri: uri,
      effectiveConnectionId: "cached-connection",
      isCurrentLspModelUri: value => value === current.uri.toString(),
      activeTab: undefined,
      currentSchema: "app",
      activeConnection: undefined,
      metadataVersion: options.metadataRevision,
      editorSettings: {
        ...DEFAULT_APP_SETTINGS.editor,
        sqlCompletion: options.sqlCompletion
      },
      usageScope: "desktop-cache-fixture",
      completionRequestGenerationRef: generations,
      createCachedSqlCompletionRequest: request => createCachedSqlCompletionRequest(snapshot, caches, request),
      capabilities: {
        ...databaseDriverProfile(options.driver).capabilities,
        driver: options.driver,
        supportsSqlQuery: true
      },
      rankByUsage: false,
      completionOwnerKey: `${uri}:${options.metadataRevision}:${live}`,
      driver: options.driver,
      batchColumnSessionsRef: {
        current: new Map()
      },
      preferredElasticsearchIndex: undefined,
      lspReady: live,
      documentLanguageId: "sql",
      lspClient: client,
      openedDocumentsRef: opened,
      documentVersionsRef: versions,
      documentTextsRef: texts,
      mountedEditor: editor
    });
    runtime = {
      ...provider,
      ownerKey: `${uri}:${options.metadataRevision}:${live}`,
      usageScope: "desktop-cache-fixture",
      rankByUsage: false,
      recordUsage: () => {},
      triggerChainedCompletion: () => {}
    };
  };
  const select = (driver: string) => {
    options = {
      ...options,
      driver,
      metadataRevision: options.metadataRevision + 1
    };
    let model = models.get(driver);
    if (!model) {
      model = monaco.editor.createModel("", "sql", monaco.Uri.parse(getSqlDocumentUri(`cached-acceptance-${driver}`, driver)));
      models.set(driver, model);
    }
    current = model;
    editor.setModel(current);
    seed("ledger", fixtureColumns);
    seed("archive", [{
      name: "secret",
      dataType: "text",
      comment: "Revenue"
    }]);
    seed("users", [{
      name: "id",
      dataType: "bigint"
    }]);
    rebuild();
  };
  const documentAt = (marked: string) => {
    editor.trigger("cache.acceptance", "hideSuggestWidget", {});
    const at = marked.indexOf("<cursor>");
    check(at >= 0, "cache cursor marker");
    current.setValue(marked.replace("<cursor>", ""));
    const position = current.getPositionAt(at);
    editor.setPosition(position);
    return position;
  };
  const complete = async (marked: string) => {
    const position = documentAt(marked);
    const result = await runtime.provideCompletionItems(current, position, {
      triggerKind: 0
    }, {
      isCancellationRequested: false
    });
    return {
      result,
      position
    };
  };
  const accept = (item: any) => {
    check(item.range instanceof monaco.Range, "actual Monaco replacement range");
    editor.executeEdits("cache.acceptance", [{
      range: item.range,
      text: item.insertText,
      forceMoveMarkers: true
    }]);
  };
  const acceptWidget = async (marked: string, expected: string, label = "amount") => {
    const started=performance.now();
    const position = documentAt(marked);
    editor.focus();
    editor.setPosition(position);
    editor.trigger("cache.acceptance", "editor.action.triggerSuggest", {});
    const end = Date.now() + 10000;
    let widget: HTMLElement | null = null;
    while (Date.now() < end) {
      widget = document.querySelector<HTMLElement>(".suggest-widget.visible");
      if (widget?.textContent?.includes(label)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const visible=Boolean(widget?.textContent?.includes(label));
    const probe=visible?null:await runtime.provideCompletionItems(current,position,{triggerKind:0},{isCancellationRequested:false});
    check(visible, "real suggest widget contains the cached comment candidate; details="+JSON.stringify({label,text:widget?.textContent,uri:current.uri.toString(),position,sql:current.getValue(),focus:editor.hasTextFocus(),documentFocus:document.hasFocus(),suggestState:(editor.getContribution("editor.contrib.suggestController") as any)?.model?.state,directLabels:probe?.suggestions?.map((item:any)=>typeof item.label==="string"?item.label:item.label.label),trace}));
    check(widget, "real suggestion control exists");
    check(getComputedStyle(widget).display !== "none", "suggest control is rendered in the hidden WebView");
    const focusedLabel=widget.querySelector(".monaco-list-row.focused")?.textContent;
    editor.trigger("cache.acceptance", "acceptSelectedSuggestion", {});
    await new Promise(resolve => setTimeout(resolve, 50));
    check(current.getValue() === expected, "real suggest command inserts canonical field and consumes suffix; details="+JSON.stringify({label,expected,actual:current.getValue(),focusedLabel,uri:current.uri.toString(),trace}));
    return {milliseconds:performance.now()-started,uri:current.uri.toString(),label,version:current.getVersionId()};
  };
  select("mysql");
  const registration = registerLspCompletionProvider({
    editorLanguageId: "sql",
    getRuntime: () => runtime,
    monaco:tracedMonaco,
    triggerCharacters: ["."],
    usageCommandId: "oxide.sqlCompletion.recordUsage"
  });
  const suggestModel=(editor.getContribution("editor.contrib.suggestController") as any)?.model;
  check(Boolean(suggestModel?.onDidTrigger&&suggestModel?.onDidSuggest&&suggestModel?.onDidCancel),"actual Monaco suggest lifecycle is available for bounded tracing");
  const traceSubscriptions=[
    suggestModel.onDidTrigger((event:any)=>traceEvent("suggest-trigger",{auto:event.auto,position:event.position})),
    suggestModel.onDidCancel((event:any)=>traceEvent("suggest-cancel",{retrigger:event.retrigger})),
    suggestModel.onDidSuggest((event:any)=>traceEvent("suggest-result",{frozen:event.isFrozen,labels:event.completionModel.items.slice(0,12).map((item:any)=>typeof item.completion.label==="string"?item.completion.label:item.completion.label.label)})),
    editor.onDidBlurEditorWidget(()=>traceEvent("editor-blur")),editor.onDidFocusEditorWidget(()=>traceEvent("editor-focus")),
    editor.onDidChangeModel(()=>traceEvent("editor-model")),
  ];
  const rapidWidgetStress={rounds:5,drivers:["mysql","postgres","sqlite","sqlserver","hive","clickhouse"],samples:[] as Array<{driver:string;round:number;variant:string;milliseconds:number;uri:string;label:string;version:number}>};
  let fullDocumentSuggestionWidget = false,
    localMetadataSuggestionWidget = false;
  const localProjectionPerformanceSamples: Array<{
    columns: number;
    layers: number;
    rounds: number;
    warmup: number;
    fields: number;
    p50Milliseconds: number;
    p95Milliseconds: number;
    milliseconds: number[];
  }> = [];
  const uniqueInputPerformanceSamples: Array<{
    inputs: number;
    rounds: number;
    warmup: number;
    fields: number;
    milliseconds: number[];
    p50Milliseconds: number;
    p95Milliseconds: number;
  }> = [];
  let namespaceIsolation = false;
  let realSuggestionWidget = false,
    realEmptyLspMerge = false,
    realEmptyLocalMetadataMerge = false;
  const performanceSamples: Array<{
    columns: number;
    commentBytes: number;
    rounds: number;
    warmup: number;
    fields: number;
    incomplete: boolean;
    p50Milliseconds: number;
    p95Milliseconds: number;
    milliseconds: number[];
  }> = [];
  editor.updateOptions({
    quickSuggestions: false,
    suggestOnTriggerCharacters: false
  });
  try {
    await step("cached-provider-comment-pinyin-utf16-and-query-scope", async () => {
      for (const driver of ["mysql", "postgres", "sqlserver"]) {
        select(driver);
        for (const [query, name] of [["zj", "租金总额"], ["Revenue", "amount"]] as const) {
          const {
            result
          } = await complete(`/* 😀 中文 */\r\nSELECT * FROM ledger l WHERE l.${query}<cursor>suffix;`);
          const item = result.suggestions.find((item: any) => item.label === name);
          check(item, "actual cached search match");
          check(item.detail?.includes("decimal"), "cached type retained");
          check(item.filterText === query, "actual Monaco filter retains auxiliary match");
          accept(item);
          check(!current.getValue().includes("suffix") && current.getValue().includes(name), "whole cached member accepted");
          check(!current.getValue().includes("Revenue"), "comment never becomes SQL insertion");
        }
      }
      select("postgres");
      for (const marked of ["SELECT * FROM ledger l WHERE EXISTS(SELECT 1 FROM archive l) AND l.Revenue<cursor>;", "SELECT * FROM archive a UNION SELECT * FROM ledger l WHERE Revenue<cursor>;", "SELECT * FROM ledger l JOIN LATERAL (SELECT 1 FROM users u WHERE l.Revenue<cursor>"]) {
        const {
          result
        } = await complete(marked);
        check(result.suggestions.some((i: any) => i.label === "amount"), "cached query-owned source");
        check(!result.suggestions.some((i: any) => i.label === "secret"), "closed/sibling metadata cannot leak");
      }
      for (const marked of ["SELECT * FROM ledger l JOIN (SELECT 1 FROM users u WHERE l.Revenue<cursor>", "SELECT * FROM ledger x JOIN archive x ON true WHERE x.Revenue<cursor>", "SELECT * FROM ledger l; SELECT * FROM users u WHERE u.Revenue<cursor>;", "SELECT * FROM ledger WHERE 'Revenue<cursor>';"]) {
        const {
          result
        } = await complete(marked);
        check(!result.suggestions.some((i: any) => i.kind === monaco.languages.CompletionItemKind.Field), "invalid/out-of-scope cache binding rejected");
      }
      check(fields.misses.length === 0, "scope tests require no unseeded metadata lookup");
    });
    await step("cached-provider-following-from-and-full-document-query-ownership", async () => {
      for (const driver of ["mysql", "postgres", "sqlite", "sqlserver", "hive", "clickhouse"]) {
        select(driver);
        const {
          result
        } = await complete("/* 😀 */\r\nSELECT l.Revenue<cursor>suffix FROM ledger l;");
        const item = result.suggestions.find((item: any) => item.label === "amount");
        check(item, "following FROM supplies the semantic field");
        check(item.detail?.includes("decimal"), "following FROM retains physical type");
        accept(item);
        check(current.getValue() === "/* 😀 */\r\nSELECT l.amount FROM ledger l;", "SELECT field edit preserves following FROM and full UTF-16 suffix");
      }
      select("postgres");
      for (const marked of ["SELECT (SELECT l.Revenue<cursor> FROM users u) FROM ledger l", "SELECT l.Revenue<cursor> FROM ledger l UNION SELECT * FROM archive a", "SELECT * FROM archive a EXCEPT SELECT l.Revenue<cursor> FROM ledger l", "SELECT l.Revenue<cursor> FROM ledger l; SELECT * FROM archive a", "SELECT l.Revenue<cursor> FROM ledger l\n\nSELECT * FROM archive a", "SELECT l.Revenue<cursor> FROM users u, ledger l", "SELECT row_number() OVER (ORDER BY l.Revenue<cursor>) FROM ledger l", 'SELECT "from".Revenue<cursor> FROM ledger "from"']) {
        const {
          result
        } = await complete(marked);
        check(result.suggestions.some((item: any) => item.label === "amount"), "complete-document visible binding retained");
        check(!result.suggestions.some((item: any) => item.label === "secret"), "following sibling/input cannot leak metadata");
      }
      for (const marked of ["SELECT l.Revenue<cursor> FROM users u; SELECT * FROM ledger l", "WITH q AS (SELECT 1) SELECT l.Revenue<cursor> FROM users u\n\nSELECT * FROM ledger l", "SELECT l.Revenue<cursor> FROM users u UNION SELECT * FROM ledger l", "SELECT * FROM ledger l JOIN (SELECT l.Revenue<cursor> FROM users u) q ON true", "SELECT * FROM users u JOIN users v ON future.Revenue<cursor> JOIN ledger future ON true", "SELECT * FROM users u JOIN LATERAL (SELECT future.Revenue<cursor>) q ON true JOIN ledger future ON true", "WITH q AS (SELECT l.Revenue<cursor> FROM users u) SELECT * FROM ledger l", "SELECT Revenue<cursor> FROM ledger l, archive a", "SELECT Revenue<cursor> FROM ledger l,(SELECT secret FROM archive) q", "SELECT Revenue<cursor> FROM ledger l, fn(1)"]) {
        const {
          result
        } = await complete(marked);
        check(!result.suggestions.some((item: any) => item.kind === monaco.languages.CompletionItemKind.Field), "future/inaccessible full-document binding rejected");
      }
      for (const marked of ["WITH q(net) AS (SELECT amount FROM ledger) SELECT q.ne<cursor> FROM q", "SELECT d.ne<cursor> FROM users u,(SELECT amount AS net FROM ledger) d", "SELECT f.ne<cursor> FROM users u, fn(1) f(net)"]) {
        const {
          result
        } = await complete(marked);
        check(result.suggestions.some((item: any) => item.label === "net"), "local explicit output remains available before FROM");
      }
      select("mysql");
      await acceptWidget("SELECT l.Revenue<cursor>suffix FROM ledger l;", "SELECT l.amount FROM ledger l;");
      fullDocumentSuggestionWidget = true;
      check(fields.misses.length === 0, "complete-document binding performs no speculative metadata lookup");
    });
    await step("cached-provider-local-projection-metadata-and-quoted-declarations", async () => {
      for (const driver of ["mysql", "postgres", "sqlite", "sqlserver", "hive", "clickhouse"]) {
        select(driver);
        const marked = "/* 😀 */\r\nWITH q AS (SELECT amount AS net FROM ledger) SELECT q.yysr<cursor>suffix FROM q";
        const {
            result
          } = await complete(marked),
          item = result.suggestions.find((item: any) => item.label === "net");
        check(item, "direct local projection is searchable by inherited comment pinyin");
        check(item.detail?.includes("decimal"), "direct local type inherited");
        check(item.documentation?.value?.includes("营业收入"), "real source comment inherited");
        check(item.filterText === "yysr", "local auxiliary match survives Monaco filtering");
        accept(item);
        check(current.getValue() === "/* 😀 */\r\nWITH q AS (SELECT amount AS net FROM ledger) SELECT q.net FROM q", "local metadata canonical UTF-16 edit accepted");
      }
      select("postgres");
      for (const [marked, name] of [["WITH q(net) AS MATERIALIZED (SELECT amount FROM ledger) SELECT q.Revenue<cursor>suffix FROM q", "net"], ["WITH q(net) AS NOT MATERIALIZED (SELECT amount FROM ledger) SELECT q.Revenue<cursor>suffix FROM q", "net"], ['WITH q("net)total") AS (SELECT amount FROM ledger) SELECT q.Revenue<cursor>suffix FROM q', "net)total"], ['WITH q("net;total") AS (SELECT amount FROM ledger) SELECT q.Revenue<cursor>suffix FROM q', "net;total"], ["WITH a AS (SELECT amount FROM ledger),b AS (SELECT amount AS net FROM a) SELECT b.Revenue<cursor>suffix FROM b", "net"], ["SELECT d.Revenue<cursor>suffix FROM (SELECT amount FROM ledger) d(net)", "net"], ["WITH q AS (SELECT amount FROM ledger) SELECT r.Revenue<cursor>suffix FROM q r(net)", "net"]] as const) {
        const {
            result
          } = await complete(marked),
          item = result.suggestions.find((item: any) => item.label === name);
        check(item, "local declaration resolves the correct canonical column");
        check(item.detail?.includes("decimal"), "local declaration preserves source type");
        check(item.documentation?.value?.includes("Revenue"), "local declaration preserves true comment");
        accept(item);
        check(!current.getValue().includes("suffix") && current.getValue().includes(name), "local declaration consumes complete member suffix");
      }
      for (const marked of ["WITH q AS (SELECT amount*2 AS net FROM ledger) SELECT q.Revenue<cursor> FROM q", "WITH q AS (SELECT other.amount AS net FROM ledger l) SELECT q.Revenue<cursor> FROM q", "WITH q(net) AS (SELECT amount FROM ledger UNION SELECT secret FROM archive) SELECT q.Revenue<cursor> FROM q", "WITH RECURSIVE q(net) AS (SELECT net FROM q) SELECT q.Revenue<cursor> FROM q"]) {
        const {
          result
        } = await complete(marked);
        check(!result.suggestions.some((item: any) => item.kind === monaco.languages.CompletionItemKind.Field), "unknown/computed/ambiguous local output cannot borrow source comments");
      }
      await acceptWidget('WITH q("Net") AS (SELECT amount FROM ledger) SELECT q.Revenue<cursor>suffix FROM q', 'WITH q("Net") AS (SELECT amount FROM ledger) SELECT q."Net" FROM q', "Net");
      localMetadataSuggestionWidget = true;
      for (const [columns, layers, rounds, warmup] of [[3, 1, 30, 5], [3, 16, 20, 3], [10000, 1, 20, 3]] as const) {
        options = {
          ...options,
          metadataRevision: options.metadataRevision + 1
        };
        seed("ledger", columns === 3 ? fixtureColumns : Array.from({
          length: columns
        }, (_, i) => ({
          name: `v${i}`,
          dataType: "int",
          comment: "Revenue"
        })));
        rebuild();
        const definitions = columns === 3 ? ["q0 AS (SELECT amount AS net FROM ledger)", ...Array.from({
          length: layers - 1
        }, (_, i) => `q${i + 1} AS (SELECT net FROM q${i})`)] : ["q0 AS (SELECT * FROM ledger)"];
        const position = documentAt(`WITH ${definitions.join(",")} SELECT q${layers - 1}.Revenue<cursor> FROM q${layers - 1}`);
        for (let round = 0; round < warmup; round++) await runtime.provideCompletionItems(current, position, {
          triggerKind: 0
        }, {});
        const milliseconds: number[] = [];
        let found = 0;
        for (let round = 0; round < rounds; round++) {
          const started = performance.now();
          const result = await runtime.provideCompletionItems(current, position, {
            triggerKind: 0
          }, {});
          milliseconds.push(performance.now() - started);
          found = result.suggestions.filter((item: any) => item.kind === monaco.languages.CompletionItemKind.Field).length;
        }
        check(found === (columns === 3 ? 1 : 256), "local projection performance workload retains expected fields");
        const sorted = [...milliseconds].sort((a, b) => a - b);
        localProjectionPerformanceSamples.push({
          columns,
          layers,
          rounds,
          warmup,
          fields: found,
          p50Milliseconds: sorted[Math.ceil(rounds * .5) - 1]!,
          p95Milliseconds: sorted[Math.ceil(rounds * .95) - 1]!,
          milliseconds
        });
      }
      check(fields.misses.length === 0, "local metadata resolves only seeded physical sources");
    });
    await step("cached-provider-rapid-model-and-quoted-cte-widget-stress",async()=>{
      const originalCapabilities=rapidWidgetStress.drivers.map(driver=>({...databaseDriverProfile(driver).capabilities,driver}));
      registerDatabaseCapabilities(originalCapabilities.map(capabilities=>({...capabilities,identifierQuote:capabilities.driver==="sqlserver"?"[":["mysql","hive","clickhouse"].includes(capabilities.driver)?"`":'"'})));
      try {
      for(let round=0;round<rapidWidgetStress.rounds;round++)for(const driver of rapidWidgetStress.drivers){
        select(driver);
        const plain=await acceptWidget("WITH q AS (SELECT amount AS net FROM ledger) SELECT q.Revenue<cursor>suffix FROM q","WITH q AS (SELECT amount AS net FROM ledger) SELECT q.net FROM q","net");
        rapidWidgetStress.samples.push({driver,round,variant:"plain",...plain});
        const quoted=driver==="sqlserver"?"[Net 总额]":["mysql","hive","clickhouse"].includes(driver)?"`Net 总额`":'"Net 总额"';
        const marked="WITH q AS (SELECT amount AS "+quoted+" FROM ledger) SELECT q.Revenue<cursor>suffix FROM q",expected="WITH q AS (SELECT amount AS "+quoted+" FROM ledger) SELECT q."+quoted+" FROM q";
        const result=await acceptWidget(marked,expected,"Net 总额");rapidWidgetStress.samples.push({driver,round,variant:"quoted-unicode",...result});
        if(driver==="postgres"){
          const exact=await acceptWidget('WITH q("Net") AS (SELECT amount FROM ledger) SELECT q.Revenue<cursor>suffix FROM q','WITH q("Net") AS (SELECT amount FROM ledger) SELECT q."Net" FROM q',"Net");
          rapidWidgetStress.samples.push({driver,round,variant:"original-output-list",...exact});
        }
      }
      check(rapidWidgetStress.samples.length===65,"all rapid model/quoted CTE variants are accepted through the actual widget");
      } finally { registerDatabaseCapabilities(originalCapabilities); }
    });
    await step("cached-provider-source-identity-unique-inputs-and-bounded-proof", async () => {
      select("sqlserver");
      for (const marked of ["SELECT r.Revenue<cursor> FROM remote.db.app.ledger r", "WITH q AS (SELECT amount AS net FROM remote.db.app.ledger) SELECT q.Revenue<cursor> FROM q", "SELECT r.Revenue<cursor> FROM db..ledger r", "SELECT r.Revenue<cursor> FROM remote...ledger r", "SELECT r.Revenue<cursor> FROM x.remote.db.app.ledger r", "WITH q AS (SELECT amount AS net FROM ledger l JOIN remote.db.app.ledger r ON 1=1) SELECT q.Revenue<cursor> FROM q"]) {
        const {
          result
        } = await complete(marked);
        check(!result.suggestions.some((i: any) => i.kind === monaco.languages.CompletionItemKind.Field), "unknown namespace never reuses seeded local amount metadata");
      }
      rememberCachedFields(fields, cachedMetadataKey(options, "other", "app", ["ledger"]), [{
        name: "amount",
        dataType: "nvarchar",
        comment: "Revenue other"
      }]);
      const other = await complete("SELECT r.Revenue<cursor> FROM other.app.ledger r");
      check(other.result.suggestions.some((i: any) => i.label === "amount" && i.detail?.includes("nvarchar")), "explicit other database uses its own seeded snapshot");
      for (const marked of ["WITH q AS (SELECT amount AS net FROM ledger l JOIN archive a ON 1=1) SELECT q.Revenue<cursor> FROM q", "WITH q AS (SELECT l.amount AS net FROM ledger l JOIN remote.db.app.ledger r ON 1=1) SELECT q.Revenue<cursor> FROM q"]) {
        const {
          result
        } = await complete(marked);
        const item = result.suggestions.find((i: any) => i.label === "net");
        check(item?.detail?.includes("decimal"), "proven unique or explicitly qualified local input retains type");
        accept(item);
        check(current.getValue().includes("SELECT q.net FROM q"), "source proof accepts canonical output alias");
      }
      options = {
        ...options,
        metadataRevision: options.metadataRevision + 1
      };
      seed("ledger", fixtureColumns);
      seed("archive", [{
        name: "amount",
        dataType: "text",
        comment: "Revenue collision"
      }]);
      rebuild();
      const collision = await complete("WITH q AS (SELECT amount AS net FROM ledger l JOIN archive a ON 1=1) SELECT q.Revenue<cursor> FROM q");
      check(!collision.result.suggestions.some((i: any) => i.kind === monaco.languages.CompletionItemKind.Field), "real same-name collision cannot borrow either input comment");
      for (const inputs of [2, 8, 16]) {
        options = {
          ...options,
          metadataRevision: options.metadataRevision + 1
        };
        for (let i = 0; i < inputs; i++) seed(`u${i}`, i === 0 ? [{
          name: "amount",
          dataType: "decimal",
          comment: "Revenue"
        }] : [{
          name: `id${i}`,
          dataType: "bigint"
        }]);
        rebuild();
        const position = documentAt(`WITH q AS (SELECT amount AS net FROM ${Array.from({
          length: inputs
        }, (_, i) => `u${i}`).join(" CROSS JOIN ")}) SELECT q.Revenue<cursor> FROM q`);
        const rounds = 20,
          warmup = 3,
          milliseconds: number[] = [];
        let count = 0;
        for (let i = 0; i < warmup + rounds; i++) {
          const start = performance.now();
          const result = await runtime.provideCompletionItems(current, position, {
            triggerKind: 0
          }, {});
          if (i >= warmup) milliseconds.push(performance.now() - start);
          count = result.suggestions.filter((item: any) => item.kind === monaco.languages.CompletionItemKind.Field).length;
        }
        check(count === 1, "unique input proof returns exactly the source-owned output");
        const sorted = [...milliseconds].sort((a, b) => a - b);
        uniqueInputPerformanceSamples.push({
          inputs,
          rounds,
          warmup,
          fields: count,
          milliseconds,
          p50Milliseconds: sorted[Math.ceil(rounds * .5) - 1]!,
          p95Milliseconds: sorted[Math.ceil(rounds * .95) - 1]!
        });
      }
      options = {
        ...options,
        metadataRevision: options.metadataRevision + 1
      };
      for (let i = 0; i < 16; i++) seed(`t${i}`, [{
        name: "amount",
        dataType: "decimal",
        comment: "Revenue"
      }]);
      rebuild();
      const capped = await complete(`WITH q AS (SELECT ${Array.from({
        length: 17
      }, (_, i) => `x${i}.amount AS n${i}`).join(",")} FROM ${Array.from({
        length: 17
      }, (_, i) => `t${i} x${i}`).join(" CROSS JOIN ")}) SELECT q.Revenue<cursor> FROM q`);
      check(capped.result.suggestions.filter((i: any) => i.kind === monaco.languages.CompletionItemKind.Field).length === 16, "qualified projection proof stops at sixteen physical snapshots");
      check(capped.result.incomplete === true, "exhausted snapshot proof is explicitly incomplete");
      check(fields.misses.length === 0, "namespace and proof budgets perform no speculative remote lookup");
      namespaceIsolation = true;
    });
    await step("cached-provider-same-sql-refresh-capped-requery-and-live-empty-merge", async () => {
      select("mysql");
      documentAt("SELECT * FROM ledger l WHERE l.Revenue<cursor>;");
      const version = current.getVersionId();
      for (const [comment, type, present] of [["Revenue", "decimal", true], ["other", "bigint", false], ["Revenue", "bigint", true]] as const) {
        options = {
          ...options,
          metadataRevision: options.metadataRevision + 1
        };
        seed("ledger", [{
          name: "amount",
          dataType: type,
          comment
        }]);
        rebuild();
        const result = await runtime.provideCompletionItems(current, editor.getPosition()!, {
          triggerKind: 0
        }, {});
        const item = result.suggestions.find((i: any) => i.label === "amount");
        check(!!item === present, "cache refresh removes/restores comment match");
        if (item) check(item.detail?.includes(type), "cache refresh updates type");
        check(current.getVersionId() === version, "cache metadata refresh leaves SQL unchanged");
      }
      options = {
        ...options,
        metadataRevision: options.metadataRevision + 1
      };
      seed("ledger", [...Array.from({
        length: 300
      }, (_, i) => ({
        name: `v${String(i).padStart(3, "0")}`,
        dataType: "int",
        comment: "Revenue"
      })), {
        name: "rev",
        dataType: "bigint"
      }]);
      rebuild();
      let response = await complete("SELECT * FROM ledger l WHERE l.rev<cursor>;");
      check(response.result.incomplete === true, "cached incomplete reaches production provider");
      check(response.result.suggestions.filter((i: any) => i.kind === monaco.languages.CompletionItemKind.Field).length === 256, "cached field cap reaches Monaco");
      check(response.result.suggestions.some((i: any) => i.label === "rev"), "late exact name survives cached cap");
      response = await complete("SELECT * FROM ledger l WHERE l.v299<cursor>;");
      const late = response.result.suggestions.find((i: any) => i.label === "v299");
      check(late, "longer cached prefix retrieves late field");
      accept(late);
      check(current.getValue() === "SELECT * FROM ledger l WHERE l.v299;", "cached requery accepted");
      for (const [count, commentBytes, rounds, warmup] of [[3, 0, 30, 5], [300, 0, 30, 5], [10000, 0, 20, 3], [3, 128 * 1024, 10, 2]] as const) {
        options = {
          ...options,
          metadataRevision: options.metadataRevision + 1
        };
        seed("ledger", count === 3 ? fixtureColumns : Array.from({
          length: count
        }, (_, i) => ({
          name: `v${String(i).padStart(5, "0")}`,
          dataType: "int",
          comment: "Revenue"
        })));
        rebuild();
        const marked = (commentBytes ? `/*${"x".repeat(commentBytes)}*/` : "") + "SELECT * FROM ledger l WHERE l.Revenue<cursor>;";
        const position = documentAt(marked);
        for (let round = 0; round < warmup; round++) await runtime.provideCompletionItems(current, position, {
          triggerKind: 0
        }, {});
        const milliseconds: number[] = [];
        let result: {
          suggestions: any[];
          incomplete?: boolean;
        } = {
          suggestions: []
        };
        for (let round = 0; round < rounds; round++) {
          const started = performance.now();
          result = await runtime.provideCompletionItems(current, position, {
            triggerKind: 0
          }, {});
          milliseconds.push(performance.now() - started);
        }
        const found = result.suggestions.filter(i => i.kind === monaco.languages.CompletionItemKind.Field).length;
        check(found === Math.min(count === 3 ? 1 : count, 256), "renderer performance workload retains all expected bounded matches");
        const sorted = [...milliseconds].sort((a, b) => a - b);
        performanceSamples.push({
          columns: count,
          commentBytes,
          rounds,
          warmup,
          fields: found,
          incomplete: result.incomplete === true,
          p50Milliseconds: sorted[Math.ceil(rounds * .5) - 1]!,
          p95Milliseconds: sorted[Math.ceil(rounds * .95) - 1]!,
          milliseconds
        });
      }
      options = {
        ...options,
        metadataRevision: options.metadataRevision + 1
      };
      seed("ledger", fixtureColumns);
      live = true;
      rebuild();
      const uri = current.uri.toString(),
        id = "aaaaaaaa-1111-4111-8111-111111111111";
      await client.updateConfiguration({
        schemas: [{
          id,
          database: "app",
          tables: [{
            name: "ledger",
            columns: []
          }],
          functions: []
        }],
        fileSchemas: {
          [uri]: id
        },
        fileDialects: {
          [uri]: "mysql"
        }
      });
      const position = documentAt("SELECT * FROM ledger l WHERE l.Revenue<cursor>;");
      await client.didOpen(uri, current.getValue(), current.getVersionId(), "sql");
      opened.current.add(uri);
      versions.current.set(uri, current.getVersionId());
      texts.current.set(uri, current.getValue());
      const native = await client.getCompletionList(uri, position.lineNumber - 1, position.column - 1);
      check(!native.items.some(i => i.kind === 5), "actual LSP has no bound metadata fields");
      const merged = await runtime.provideCompletionItems(current, position, {
        triggerKind: 0
      }, {});
      check(merged.suggestions.some((i: any) => i.label === "amount"), "actual empty live response merges production cached comment result");
      realEmptyLspMerge = true;
      const localPosition = documentAt("WITH q AS (SELECT * FROM ledger) SELECT q.Revenue<cursor>suffix FROM q;");
      const localMerged = await runtime.provideCompletionItems(current, localPosition, {
        triggerKind: 0
      }, {});
      const nativeLocal = await client.getCompletionList(uri, localPosition.lineNumber - 1, localPosition.column - 1);
      check(!nativeLocal.items.some(item => item.label === "amount"), "actual native local output lacks source metadata field");
      check(localMerged.suggestions.some((item: any) => item.label === "amount" && item.detail?.includes("decimal") && item.documentation?.value?.includes("Revenue")), "actual live provider merges inherited cached local metadata");
      realEmptyLocalMetadataMerge = true;
      live = false;
      rebuild();
      check(fields.misses.length === 0, "refresh/requery hits only declared fixture snapshots");
    });
    await step("cached-provider-real-monaco-suggest-widget-acceptance", async () => {
      select("mysql");
      await acceptWidget("SELECT * FROM ledger l WHERE l.Revenue<cursor>suffix;", "SELECT * FROM ledger l WHERE l.amount;");
      realSuggestionWidget = true;
    });
    await step("cached-provider-real-widget-context-withdrawal-and-recovery",async()=>{
      select("mysql");
      context={connection:{},runtime:{},metadataVersion:1,projectId:"fixture",route:"db/app",generation:{},available:true,lspAllowed:false,metadataAllowed:true};
      seed("ledger",[{name:"old_revenue",dataType:"decimal",comment:"Revenue"}]);rebuild();
      const position=documentAt("WITH q AS (SELECT l.* FROM ledger l) SELECT q.Revenue<cursor>suffix FROM q;");
      const originalText=current.getValue(),originalVersion=current.getVersionId();
      const wait=async(predicate:()=>boolean)=>{const deadline=Date.now()+10000;while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));check(predicate(),"actual widget reached expected context state");};
      const widget=()=>editor.getDomNode()?.querySelector<HTMLElement>(".suggest-widget.visible");
      editor.focus();editor.setPosition(position);editor.trigger("context.acceptance","editor.action.triggerSuggest",{});
      await wait(()=>Boolean(widget()?.textContent?.includes("old_revenue")));
      let notify=()=>{};
      contextRefresh=attachCompletionContextRefresh({editor,read:()=>context!,subscribe:listener=>{notify=listener;return()=>{};},invalidate:()=>generations.current.clear()});
      context={...context,runtime:{},available:false,metadataAllowed:false};notify();
      await wait(()=>!widget());
      check(current.getValue()===originalText&&current.getVersionId()===originalVersion,"withdrawal does not edit the SQL or model version");
      const blocked=await runtime.provideCompletionItems(current,position,{triggerKind:0},{});
      check(blocked.suggestions.length===0,"pending replacement cannot offer the old field");contextWidgetWithdrawal=true;
      seed("ledger",[{name:"new_revenue",dataType:"bigint",comment:"Revenue"}]);
      context={...context,available:true,metadataAllowed:true,generation:{}};rebuild();notify();
      await wait(()=>Boolean(widget()?.textContent?.includes("new_revenue")));
      check(!widget()?.textContent?.includes("old_revenue"),"the visible restored list omits the old context field");
      editor.trigger("context.acceptance","acceptSelectedSuggestion",{});
      await new Promise(resolve=>setTimeout(resolve,50));
      check(current.getValue()==="WITH q AS (SELECT l.* FROM ledger l) SELECT q.new_revenue FROM q;","actual restored suggestion accepts the canonical CTE field and consumes the suffix");
      contextWidgetRecovery=true;contextRefresh.dispose();contextRefresh=undefined;
    });
    return {
      productionProvider: true,
      productionCoordinator: true,
      rapidWidgetStress,
      boundedSuggestTrace:trace,
      metadataFixturePreloaded: true,
      metadataRemoteLoaderTested: false,
      performanceScope: "single-run-warm-renderer-production-provider-preloaded-cache-no-remote-io-not-cold-or-full-workbench-performance",
      performanceSamples,
      realEmptyLspMerge,
      realEmptyLocalMetadataMerge,
      realSuggestionWidget,
      contextWidgetWithdrawal,
      contextWidgetRecovery,
      fullDocumentSuggestionWidget,
      localMetadataSuggestionWidget,
      localProjectionPerformanceSamples,
      uniqueInputPerformanceSamples,
      namespaceIsolation,
      nativeWindowVisible: false,
      metadataCacheMisses: fields.misses.length
    };
  } finally {
    for(const subscription of traceSubscriptions)subscription.dispose();
    contextRefresh?.dispose();
    registration.dispose();
    for (const uri of opened.current) await client.didClose(uri);
    editor.setModel(original);
    for (const model of models.values()) model.dispose();
  }
}
