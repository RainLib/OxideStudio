/** @vitest-environment happy-dom */
import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {DEFAULT_APP_SETTINGS} from "@/lib/appSettings";
import {defaultDatabaseCapabilities} from "@/lib/databaseDialect";
import {InlineCompletionCache} from "@/lib/inlineCompletion";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import {useInlineCompletionProvider} from "./useInlineCompletionProvider";
const api=vi.hoisted(()=>({ai:vi.fn(),project:vi.fn()}));
vi.mock("@/services/tauri/ai.service",()=>({aiService:{inlineCompletion:api.ai}}));
vi.mock("@/services/tauri/project-files.service",()=>({projectFilesService:{getCompletionContext:api.project}}));
const cleanups:Array<()=>Promise<void>>=[];
beforeEach(()=>{vi.clearAllMocks();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;});
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();vi.useRealTimers();});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function fixture(options:{held?:boolean;offline?:boolean;ai?:boolean;project?:boolean;text?:string;console?:boolean}={}){
  let state:CompletionContextState={connection:{},runtime:{},execution:{},metadataVersion:1,projectId:"p",route:"r",generation:{},available:!options.offline,syntaxAllowed:true,lspAllowed:!options.held,metadataAllowed:!options.held,analysisToken:"first"};
  const uri="oxide://query/inline.postgres.sql";const marked=options.text||"SELECT q.fi",cursor=marked.indexOf("|");let text=marked.replace("|",""),version=1,dead=false,notify=()=>{};
  let provider:any;const dispose=vi.fn();
  class Range {constructor(public startLineNumber:number,public startColumn:number,public endLineNumber:number,public endColumn:number){}}
  const monaco={Range,languages:{registerInlineCompletionsProvider:vi.fn((_language,value)=>{provider=value;return {dispose};}),InlineCompletionTriggerKind:{Explicit:1},CompletionItemKind:{Field:4,Variable:5}}};
  const model={uri:{toString:()=>uri},getValue:()=>text,getVersionId:()=>version,isDisposed:()=>dead,getOffsetAt:({column}:{column:number})=>column-1,getPositionAt:(offset:number)=>({lineNumber:1,column:offset+1}),
    getLineContent:()=>text,getLineMaxColumn:()=>text.length+1,getWordUntilPosition:({column}:{column:number})=>{const word=text.slice(0,column-1).match(/[\w$]+$/)?.[0]||"";return {word,startColumn:column-word.length,endColumn:column};},getValueInRange:(range:Range)=>text.slice(range.startColumn-1,range.endColumn-1)};
  const editor={getModel:()=>model,getSelection:()=>({isEmpty:()=>true}),trigger:vi.fn()};
  const client={didOpen:vi.fn().mockResolvedValue(undefined),didChange:vi.fn().mockResolvedValue(undefined),getInlineCompletionContext:vi.fn().mockResolvedValue({candidates:[{label:"field_old",kind:5}]}),validateInlineCompletion:vi.fn().mockResolvedValue([])};
  const cache=new InlineCompletionCache(),cacheSet=vi.spyOn(cache,"set"),cacheClear=vi.spyOn(cache,"clear"),abort={current:null as AbortController|null},listeners={current:new Set<()=>void>()},changed=vi.fn();listeners.current.add(changed);
  const settings={...DEFAULT_APP_SETTINGS.editor,inlineCompletion:{...DEFAULT_APP_SETTINGS.editor.inlineCompletion,enabled:true,automaticSuggestions:false,includeSchemaMetadata:true,includeProjectContext:!!options.project}};
  const config={kind:"openai-compatible" as const,baseUrl:"https://example.invalid",apiKey:"test",model:"test"};const statuses=vi.fn();
  const getSemanticContext=()=>state,subscribeSemanticContext=(listener:()=>void)=>{notify=listener;return ()=>{notify=()=>{};};};
  const inlineProviderConfig=()=>options.ai?config:null;
  function Probe(){useInlineCompletionProvider({editorSettings:settings,isActivePane:true,monaco:monaco as any,inlineCompletionAbortRef:abort,setInlineCompletionStatus:statuses,inlineCompletionCacheRef:{current:cache},inlineProviderConfig,
    editorLanguageId:"sql",inlineCompletionListenersRef:listeners,documentUri:uri,mountedEditor:editor,isElasticsearchConsole:!!options.console,preferredElasticsearchIndex:"ledger",elasticsearchServerVersion:undefined,
    driver:options.console?"elasticsearch":"postgres",capabilities:defaultDatabaseCapabilities(options.console?"elasticsearch":"postgres"),lspReady:true,canUseLsp:true,documentLanguageId:"postgres",lspClient:client as any,
    openedDocumentsRef:{current:new Set()},documentVersionsRef:{current:new Map()},documentTextsRef:{current:new Map()},usageScope:"test",inlineCompletionProtocol:"chat-completions",inlineCompletionModel:"test",activeTab:undefined,
    projectId:"p",projectRootPath:"/project",inlineBaseUrl:"",inlineApiKey:"",inlineTimeoutMs:1000,rankByUsage:false,getSemanticContext,subscribeSemanticContext});return null;}
  const root=createRoot(document.createElement("div"));await act(async()=>root.render(<Probe/>));let mounted=true;
  const unmount=async()=>{if(mounted){mounted=false;await act(async()=>root.unmount());}};cleanups.push(unmount);
  const token={isCancellationRequested:false,onCancellationRequested:vi.fn(()=>({dispose:vi.fn()}))};
  const request=()=>provider.provideInlineCompletions(model,{lineNumber:1,column:(cursor<0?text.length:cursor)+1},{triggerKind:1},token);
  return {request,client,cache,cacheSet,cacheClear,abort,editor,changed,statuses,dispose,unmount,token,model,
    change:(patch:Partial<CompletionContextState>)=>{state={...state,...patch};notify();},edit:()=>{text+=" ";version++;},disposeModel:()=>{dead=true;}};
}
it("returns a current physical candidate through the actual hook",async()=>{const f=await fixture();expect((await f.request()).items[0].insertText).toBe("eld_old");expect(f.client.getInlineCompletionContext).toHaveBeenCalledOnce();});
it.each(["execution","runtime","generation","analysisToken"] as const)("drops late semantic candidates after %s changes without editing SQL",async key=>{
  const f=await fixture(),pending=deferred<any>();f.client.getInlineCompletionContext.mockReturnValue(pending.promise);const request=f.request();await Promise.resolve();
  f.change({[key]:key==="analysisToken"?"next":{}});pending.resolve({candidates:[{label:"field_old",kind:5}]});expect((await request).items).toEqual([]);expect(f.editor.trigger).toHaveBeenCalledWith("oxide.inlineContext","editor.action.inlineSuggest.hide",{});
});
it("does not cross the semantic RPC boundary after an obsolete document sync resolves",async()=>{
  const f=await fixture(),pending=deferred<void>();f.client.didOpen.mockReturnValue(pending.promise);const request=f.request();await Promise.resolve();f.change({execution:{}});pending.resolve();expect((await request).items).toEqual([]);expect(f.client.getInlineCompletionContext).not.toHaveBeenCalled();
});
it.each([{held:true},{offline:true}])("keeps nested CTE inference while physical metadata is unavailable: %o",async patch=>{
  const f=await fixture({...patch,text:"WITH a AS (SELECT 1 AS declared_total), b AS (SELECT x.* FROM a x) SELECT q.de| FROM b q"});
  const result=await f.request();expect(result.items[0]?.insertText).toBe("clared_total");expect(f.client.getInlineCompletionContext).not.toHaveBeenCalled();expect(f.client.validateInlineCompletion).not.toHaveBeenCalled();
});
it("aborts a pending AI request and prevents stale validation, cache writes and notifications",async()=>{
  const f=await fixture({ai:true,text:"SELECT "});f.client.getInlineCompletionContext.mockResolvedValue({candidates:[]});const pending=deferred<any>();api.ai.mockReturnValue(pending.promise);
  const request=f.request();await vi.waitFor(()=>expect(api.ai).toHaveBeenCalledOnce());const signal=api.ai.mock.calls[0]![1] as AbortSignal;
  const changed=f.changed.mock.calls.length;f.change({execution:{},metadataAllowed:false,lspAllowed:false});expect(signal.aborted).toBe(true);const after=f.changed.mock.calls.length;
  pending.resolve({text:"1"});expect((await request).items).toEqual([]);expect(f.cacheSet).not.toHaveBeenCalled();expect(f.client.validateInlineCompletion).not.toHaveBeenCalled();expect(f.changed).toHaveBeenCalledTimes(after);expect(after).toBeGreaterThan(changed);
});
it("discards pending project context before any external AI request",async()=>{
  const f=await fixture({ai:true,project:true,text:"SELECT "});f.client.getInlineCompletionContext.mockResolvedValue({candidates:[]});const pending=deferred<any[]>();api.project.mockReturnValue(pending.promise);
  const request=f.request();await vi.waitFor(()=>expect(api.project).toHaveBeenCalledOnce());f.change({projectId:"other",syntaxAllowed:false});pending.resolve([{relativePath:"a.sql",content:"SELECT 1"}]);expect((await request).items).toEqual([]);expect(api.ai).not.toHaveBeenCalled();
});
it("clears current cache synchronously on source changes while retaining subscriptions",async()=>{
  const f=await fixture();f.cache.set("cached","old");const before=f.cacheClear.mock.calls.length;f.change({execution:{}});expect(f.cache.get("cached")).toBeUndefined();expect(f.cacheClear).toHaveBeenCalledTimes(before+1);f.change({execution:{}});expect(f.changed).toHaveBeenCalledTimes(2);
});
it("rejects a completed validation after metadata changes",async()=>{
  const f=await fixture({ai:true,text:"SELECT "});f.client.getInlineCompletionContext.mockResolvedValue({candidates:[]});api.ai.mockResolvedValue({text:"1"});const pending=deferred<any[]>();f.client.validateInlineCompletion.mockReturnValue(pending.promise);
  const request=f.request();await vi.waitFor(()=>expect(f.client.validateInlineCompletion).toHaveBeenCalledOnce());f.change({analysisToken:"next"});pending.resolve([]);expect((await request).items).toEqual([]);expect(f.cacheSet).not.toHaveBeenCalled();
});
it("keeps deterministic Elasticsearch Console syntax without a physical RPC",async()=>{
  const f=await fixture({console:true,held:true,text:"GET /ledger/_sea"});const result=await f.request();expect(result.items.length).toBeGreaterThan(0);expect(f.client.getInlineCompletionContext).not.toHaveBeenCalled();expect(api.ai).not.toHaveBeenCalled();
});
it("cleans pending AI work and rejects its late result after unmount",async()=>{
  const f=await fixture({ai:true,text:"SELECT "});f.client.getInlineCompletionContext.mockResolvedValue({candidates:[]});const pending=deferred<any>();api.ai.mockReturnValue(pending.promise);const request=f.request();await vi.waitFor(()=>expect(api.ai).toHaveBeenCalledOnce());
  await f.unmount();pending.resolve({text:"1"});expect((await request).items).toEqual([]);expect(f.dispose).toHaveBeenCalledOnce();expect(f.cacheSet).not.toHaveBeenCalled();
});

it("consumes a known SQL identifier suffix when accepting a local inline result",async()=>{
  const f=await fixture({text:"SELECT q.fi|Suffix FROM ledger q"}),result=await f.request(),item=result.items[0];
  const text=f.model.getValue(),applied=text.slice(0,item.range.startColumn-1)+item.insertText+text.slice(item.range.endColumn-1);
  expect(applied).toBe("SELECT q.field_old FROM ledger q");
});
it("keeps offline AI document work without semantic enrichment or validation",async()=>{
  const f=await fixture({ai:true,offline:true,text:"SELECT "});api.ai.mockResolvedValue({text:"1"});const result=await f.request();
  expect(result.items[0].insertText).toBe("1");expect(f.client.getInlineCompletionContext).not.toHaveBeenCalled();expect(f.client.validateInlineCompletion).not.toHaveBeenCalled();
  expect(api.ai.mock.calls[0]![0].lspContext).not.toHaveProperty("referencedObjects");
});
it("rejects old Elasticsearch mapping candidates after execution changes",async()=>{
  const f=await fixture({console:true,text:'GET /ledger/_search\n{"query":{"term":{"fi|" : 1}}}'}),pending=deferred<any>();f.client.getInlineCompletionContext.mockReturnValue(pending.promise);
  const request=f.request();await vi.waitFor(()=>expect(f.client.getInlineCompletionContext).toHaveBeenCalledOnce());f.change({execution:{},metadataAllowed:false,lspAllowed:false});pending.resolve({candidates:[{label:"field_old",kind:5}]});expect((await request).items).toEqual([]);expect(api.ai).not.toHaveBeenCalled();
});
it("does not invent Elasticsearch mapping fields while the physical source is held",async()=>{
  const f=await fixture({console:true,held:true,text:'GET /ledger/_search\n{"query":{"term":{"fi|" : 1}}}'});expect((await f.request()).items).toEqual([]);expect(f.client.getInlineCompletionContext).not.toHaveBeenCalled();expect(api.ai).not.toHaveBeenCalled();
});

it("reuses AI output within one source generation but regenerates it after a same-SQL source change",async()=>{
  const f=await fixture({ai:true,text:"SELECT "});f.client.getInlineCompletionContext.mockResolvedValue({candidates:[]});api.ai.mockResolvedValue({text:"1"});
  expect((await f.request()).items[0].insertText).toBe("1");expect((await f.request()).items[0].insertText).toBe("1");expect(api.ai).toHaveBeenCalledOnce();
  f.change({execution:{},analysisToken:"next"});expect((await f.request()).items[0].insertText).toBe("1");expect(api.ai).toHaveBeenCalledTimes(2);
});

it("uses document-local CTE output when a failed transport returns an empty enrichment object",async()=>{
  const f=await fixture({text:"WITH q AS (SELECT 1 AS declared_total) SELECT q.de| FROM q"});f.client.getInlineCompletionContext.mockResolvedValue({});
  const result=await f.request();expect(result.items[0].insertText).toBe("clared_total");expect(api.ai).not.toHaveBeenCalled();
});
