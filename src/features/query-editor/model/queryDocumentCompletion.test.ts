// @vitest-environment happy-dom
import {expect,it,vi} from "vitest";
import {DEFAULT_APP_SETTINGS} from "@/lib/appSettings";
import {defaultDatabaseCapabilities} from "@/lib/databaseDialect";
import {getSqlDocumentUri} from "@/services/lsp/document";
import type {LspClient} from "@/services/lsp/client";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import {attachCompletionContextRefresh} from "./completionContextRefresh";
import {createQueryCompletionProvider} from "./createQueryCompletionProvider";
import {createCachedSqlCompletionRequest} from "./cachedSqlCompletion";
const metadata=vi.hoisted(()=>({loadTableMetadata:vi.fn()}));
vi.mock("@/services/tableMetadataCache",()=>metadata);
class Range {constructor(public startLineNumber:number,public startColumn:number,public endLineNumber:number,public endColumn:number){}}
const monaco={Range,languages:{CompletionItemKind:{Field:5,Keyword:17,Function:1,Reference:18,Snippet:27,Struct:22,Operator:11},CompletionItemInsertTextRule:{None:0,InsertAsSnippet:4}}};
function fixture(profile="mysql") {
  metadata.loadTableMetadata.mockClear();
  const marked="/*漢😀*/ WITH q AS (SELECT CAST(1 AS INTEGER) AS local_id) SELECT q.loc|Suffix FROM q;";
  let text=marked.replace("|",""),version=1;
  const offset=marked.indexOf("|"),uri=getSqlDocumentUri("query-local","mysql"),position={lineNumber:1,column:offset+1};
  const model={uri:{toString:()=>uri},getVersionId:()=>version,getValue:()=>text,getOffsetAt:(p:any)=>p.column-1,
    getPositionAt:(at:number)=>({lineNumber:1,column:at+1}),getLineContent:()=>text,
    getValueInRange:(r:Range)=>text.slice(r.startColumn-1,r.endColumn-1),
    getWordUntilPosition:(p:any)=>{const word=text.slice(0,p.column-1).match(/[\p{L}\p{N}_]+$/u)?.[0]??"";return {word,startColumn:p.column-word.length,endColumn:p.column};}};
  let context:CompletionContextState={connection:{},runtime:{},lspRuntime:{},metadataVersion:1,projectId:"project",route:"app",generation:{},available:false,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false};
  const result={items:[{label:"local_id",kind:5,detail:"INTEGER",textEdit:{range:{start:{line:0,character:offset-3},end:{line:0,character:offset+6}},newText:"local_id"}}],isIncomplete:false,resolveProvider:false};
  const client={didOpen:vi.fn().mockResolvedValue(undefined),didChange:vi.fn().mockResolvedValue(undefined),getDocumentCompletions:vi.fn().mockResolvedValue(result),getCompletionList:vi.fn().mockResolvedValue(result),resolveCompletionItem:vi.fn()};
  const versions=new Map<string,number>(),texts=new Map<string,string>(),caches={fields:new Map(),joinConstraints:new Map()};
  const settings={...DEFAULT_APP_SETTINGS.editor,sqlCompletion:{...DEFAULT_APP_SETTINGS.editor.sqlCompletion,appendSpace:false,rankByUsage:false,snippets:[]}};
  const capabilities={...defaultDatabaseCapabilities("mysql"),lspLanguageId:"sql",lspServerDialect:profile};
  const options={connectionId:"connection",activeProjectId:"project",currentSchema:"app",driver:"mysql" as const,metadataRevision:1,schemaTables:[],sqlCompletion:settings.sqlCompletion,sqlFormatting:settings.sqlFormatting};
  const generations=new Map<string,number>();
  const editor={getModel:()=>model,getPosition:()=>position,hasTextFocus:()=>true,getDomNode:()=>({querySelector:()=>false}),trigger:vi.fn()};
  const provider=createQueryCompletionProvider({getCompletionContext:()=>context,monaco:monaco as any,completionTriggerOriginRef:{current:"explicit"},documentUri:uri,effectiveConnectionId:"connection",isCurrentLspModelUri:value=>value===uri,activeTab:undefined,currentSchema:"app",activeConnection:undefined,metadataVersion:1,editorSettings:settings,usageScope:"local-test",completionRequestGenerationRef:{current:generations},createCachedSqlCompletionRequest:request=>createCachedSqlCompletionRequest(options,caches,request),capabilities,rankByUsage:false,completionOwnerKey:"local-test",driver:"mysql",batchColumnSessionsRef:{current:new Map()},preferredElasticsearchIndex:undefined,lspReady:true,documentLanguageId:"mysql",lspClient:client as unknown as LspClient,openedDocumentsRef:{current:new Set()},documentVersionsRef:{current:versions},documentTextsRef:{current:texts},mountedEditor:editor});
  return {client,result,model,position,uri,versions,texts,caches,settings,provider,editor,readContext:()=>context,setText:(value:string)=>{text=value;version++;},
    request:(token:any={})=>provider.provideCompletionItems(model,position,{triggerKind:0},token),
    changeContext:(patch:Partial<CompletionContextState>)=>{context={...context,...patch};},
    edit:()=>{text+=" ";version++;},
    accept:(item:any)=>text.slice(0,item.range.startColumn-1)+item.insertText+text.slice(item.range.endColumn-1),
  };
}
it.each(["postgres","mysql","sqlite","hive","clickhouse","duckdb","sqlserver","argo"])("uses signed %s document semantics while physical metadata is unavailable",async profile=>{
  const f=fixture(profile),response=await f.request(),field=response.suggestions.find(item=>item.label==="local_id");
  expect(field).toBeDefined();expect(field.detail).toContain("INTEGER");expect(f.accept(field)).toContain("SELECT q.local_id FROM q;");
  expect(f.client.getDocumentCompletions).toHaveBeenCalledWith({uri:f.uri,version:1,dialect:profile,position:{line:0,character:f.position.column-1},preferences:{keywordCase:f.settings.sqlCompletion.keywordCase,functionCase:f.settings.sqlCompletion.functionCase,tableAlias:f.settings.sqlCompletion.tableAlias}},expect.anything());
  expect(f.client.getCompletionList).not.toHaveBeenCalled();expect(metadata.loadTableMetadata).not.toHaveBeenCalled();expect(f.caches.fields.size).toBe(0);
  await f.provider.resolveCompletionItem(field,{});expect(f.client.resolveCompletionItem).not.toHaveBeenCalled();
});
it("records the production provider's first empty progressive request for metadata recovery",async()=>{
 vi.useFakeTimers();const f=fixture();let notify=()=>{};
 const marked="WITH q AS (SELECT l.* FROM ledger l) SELECT q.va|Suffix FROM q;";f.setText(marked.replace("|",""));f.position.column=marked.indexOf("|")+1;
 f.changeContext({available:true,lspAllowed:true,metadataAllowed:false});f.client.getCompletionList.mockResolvedValue({items:[],isIncomplete:false,resolveProvider:false} as any);
 const refresh=attachCompletionContextRefresh({editor:f.editor,read:f.readContext,subscribe:listener=>{notify=listener;return()=>{};},invalidate:()=>{},allowDocumentOnly:true});
 try{expect((await f.request()).suggestions).toEqual([]);f.changeContext({metadataAllowed:true,generation:{}});notify();await vi.runAllTimersAsync();expect(f.editor.trigger).toHaveBeenCalledWith("oxide.completionContext","editor.action.triggerSuggest",{});}finally{refresh.dispose();vi.useRealTimers();}
});
it("requires a document syntax grant even when the old physical context was available",async()=>{
  const f=fixture();f.changeContext({available:true,syntaxAllowed:false});expect((await f.request()).suggestions).toEqual([]);expect(f.client.didOpen).not.toHaveBeenCalled();expect(f.client.getDocumentCompletions).not.toHaveBeenCalled();
});
it.each(["context","model","cancel","shadow"])("discards a late document list after %s changes",async changed=>{
  const f=fixture();let finish!:(result:any)=>void;f.client.getDocumentCompletions.mockImplementation(()=>new Promise(done=>{finish=done;}));
  const token={isCancellationRequested:false},pending=f.request(token);await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));
  if(changed==="context")f.changeContext({generation:{}});else if(changed==="model")f.edit();else if(changed==="cancel")token.isCancellationRequested=true;else f.versions.set(f.uri,99);
  finish(f.result);expect((await pending).suggestions).toEqual([]);expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
});
it("does not send a document RPC after owner synchronization fails",async()=>{
  const f=fixture();f.client.didOpen.mockRejectedValueOnce(new Error("owner sync failed"));await f.request();expect(f.client.getDocumentCompletions).not.toHaveBeenCalled();expect(f.client.getCompletionList).not.toHaveBeenCalled();expect(metadata.loadTableMetadata).not.toHaveBeenCalled();expect(f.versions.size).toBe(0);
});
it("retains explicit local cache fallback if a scoped request has no result",async()=>{
  const f=fixture();f.client.getDocumentCompletions.mockResolvedValueOnce(null as any);expect((await f.request()).suggestions.some(item=>item.label==="local_id")).toBe(true);expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
});
it("keeps an independently committed server source grant while renderer metadata is pending",async()=>{
  const f=fixture();f.changeContext({available:true,lspAllowed:true,metadataAllowed:false});expect((await f.request()).suggestions.some(item=>item.label==="local_id")).toBe(true);expect(f.client.getCompletionList).toHaveBeenCalledOnce();expect(f.client.getDocumentCompletions).not.toHaveBeenCalled();expect(metadata.loadTableMetadata).not.toHaveBeenCalled();
});
