import {invoke} from "@tauri-apps/api/core";
import type * as Monaco from "monaco-editor";
import type {LspClient} from "@/services/lsp/client/LspClient";
import {getSqlDocumentUri} from "@/services/lsp/document";
import {DEFAULT_APP_SETTINGS} from "@/lib/appSettings";
import {defaultDatabaseCapabilities} from "@/lib/databaseDialect";
import {createQueryCompletionProvider} from "@/features/query-editor/model/createQueryCompletionProvider";
import {createCachedSqlCompletionRequest} from "@/features/query-editor/model/cachedSqlCompletion";
import {cachedMetadataKey,rememberCachedFields} from "@/features/query-editor/model/cached-completion/fieldCache";
import {registerLspCompletionProvider} from "@/features/query-editor/hooks/useLspCompletionProviderCoordinator";
import {triggerChainedSqlCompletion} from "@/features/query-editor/model/completionContinuation";
import {RECORD_COMPLETION_USAGE_COMMAND} from "@/features/query-editor/model/completionProviderRuntime";

/** Real Monaco acceptance, native SQLite metadata and the bundled LSP. No
 * fixture replaces the provider, suggestion widget, or acceptance commands. */
export async function runCompletionContinuationAcceptance(options:{monaco:typeof import("monaco-editor/esm/vs/editor/editor.api.js");editor:Monaco.editor.IStandaloneCodeEditor;client:LspClient}){
  const {monaco,editor,client}=options,original=editor.getModel();
  const report={acceptedSelectContinues:false,unboundTablePicker:false,sourceSelectionContinuesColumns:false,acceptedFromContinues:false,nativeQueryAfterSelection:false};
  const uri=getSqlDocumentUri("continuation-regression","sqlite"),model=monaco.editor.createModel("","sql",monaco.Uri.parse(uri));
  const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message)};
  const wait=async(test:()=>unknown,message:string)=>{const start=performance.now();while(!test()){if(performance.now()-start>15000)throw new Error(message);await new Promise(done=>setTimeout(done,20));}};
  const query=async(sql:string)=>{const result:any=await invoke("execute_query",{connectionId:"semantic-sqlite",sql,schema:"main",transactionId:null,queryId:crypto.randomUUID(),database:null});assert(result.success,result.error?.message||"native query failed");return result.data};
  let coordinator:{dispose():void}|undefined;
  const origin:{current:"explicit"|"chained"|null}={current:null};
  const step=async(name:string)=>invoke("acceptance_progress",{name,phase:"start"});
  try{
    await query("CREATE TABLE IF NOT EXISTS adapter(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO adapter(id,name) VALUES(1,'test')");
    const metadata:any=await invoke("get_columns",{connectionId:"semantic-sqlite",schema:"main",table:"adapter"});assert(metadata.success,"native columns");
    const runtime={activeProjectId:"continuation-test",connectionId:"semantic-sqlite",driver:"sqlite" as const,metadataRevision:1,databaseName:"main",currentSchema:"main",schemaTables:[{name:"adapter",schema:"main"}],sqlCompletion:{...DEFAULT_APP_SETTINGS.editor.sqlCompletion,appendSpace:true,rankByUsage:false,snippets:[]},sqlFormatting:DEFAULT_APP_SETTINGS.editor.sqlFormatting};
    const caches={fields:new Map(),joinConstraints:new Map()};
    rememberCachedFields(caches.fields,cachedMetadataKey(runtime,"main","main",["adapter"]),metadata.data.map((column:any)=>({name:column.name,dataType:column.data_type})));
    await client.updateConfiguration({schemas:[{id:"e3cad08a-3552-423e-9103-d7eeb0cdb450",database:"main",catalog:"main",tables:[{name:"adapter",columns:metadata.data}],functions:[]}],fileSchemas:{[uri]:"e3cad08a-3552-423e-9103-d7eeb0cdb450"},fileDialects:{[uri]:"sqlite"}});
    editor.setModel(model);editor.updateOptions({quickSuggestions:false,suggestOnTriggerCharacters:false,wordBasedSuggestions:"off",snippetSuggestions:"bottom"});editor.focus();
    const provider=createQueryCompletionProvider({monaco,completionTriggerOriginRef:origin,documentUri:uri,effectiveConnectionId:"semantic-sqlite",isCurrentLspModelUri:value=>value===uri,activeTab:undefined,currentSchema:"main",activeConnection:undefined,metadataVersion:1,editorSettings:{...DEFAULT_APP_SETTINGS.editor,sqlCompletion:runtime.sqlCompletion},usageScope:"continuation-test",completionRequestGenerationRef:{current:new Map()},createCachedSqlCompletionRequest:request=>createCachedSqlCompletionRequest(runtime,caches,request),capabilities:defaultDatabaseCapabilities("sqlite"),rankByUsage:false,completionOwnerKey:"continuation-owner",driver:"sqlite",batchColumnSessionsRef:{current:new Map()},preferredElasticsearchIndex:undefined,lspReady:true,documentLanguageId:"sql",lspClient:client,openedDocumentsRef:{current:new Set()},documentVersionsRef:{current:new Map()},documentTextsRef:{current:new Map()},mountedEditor:editor});
    coordinator=registerLspCompletionProvider({editorLanguageId:"sql",monaco,triggerCharacters:[" ","."],usageCommandId:RECORD_COMPLETION_USAGE_COMMAND,getRuntime:()=>({...provider,ownerKey:"continuation-owner",usageScope:"continuation-test",rankByUsage:false,recordUsage:()=>{},triggerChainedCompletion:()=>triggerChainedSqlCompletion(editor,origin)})});
    const widget=()=>editor.getDomNode()?.querySelector(".suggest-widget.visible");
    const labels=()=>Array.from(widget()?.querySelectorAll(".label-name")??[]).map(node=>node.textContent);
    const at=(marked:string)=>{editor.trigger("continuation","hideSuggestWidget",{});const offset=marked.indexOf("|");model.setValue(marked.replace("|",""));editor.setPosition(model.getPositionAt(offset));editor.focus();};
    const open=()=>{origin.current="explicit";editor.trigger("continuation","editor.action.triggerSuggest",{});};
    const accept=async(label:string)=>{await wait(()=>labels().includes(label),"candidate not displayed: "+label);for(let i=0;i<300;i++){const focus=widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent;if(focus===label){editor.trigger("continuation","acceptSelectedSuggestion",{});return}editor.trigger("continuation","selectNextSuggestion",{});await new Promise(done=>setTimeout(done,0));}throw new Error("candidate could not be selected: "+label)};
    await step("accepted-SELECT-reopens-fields-with-following-FROM");
    at("SEL| \n\nFROM adapter\nLIMIT 100;");open();await accept("SELECT");await wait(()=>labels().includes("id"),"SELECT acceptance did not continue to fields");await accept("id");assert(/SELECT\s+id\s+FROM adapter/u.test(model.getValue()),"field acceptance replaced SELECT");report.acceptedSelectContinues=true;
    await step("unbound-SELECT-offers-qualified-source-and-continues-fields");
    at("SEL|");open();await accept("SELECT");await wait(()=>labels().includes("main.adapter"),"unbound SELECT did not offer its qualified table");report.unboundTablePicker=true;
    await accept("main.adapter");await wait(()=>labels().includes("id"),"source selection did not continue at the projection");await accept("id");assert(/SELECT\s+id\s+FROM main\.adapter/u.test(model.getValue()),"source picker generated invalid SQL: "+model.getValue());report.sourceSelectionContinuesColumns=true;
    const result=await query(model.getValue());assert(result[0]?.rows?.[0]?.[0]===1,"selected SQL did not execute in native SQLite");report.nativeQueryAfterSelection=true;
    await step("accepted-FROM-reopens-relation-candidates");
    at("SELECT id FR|");open();await accept("FROM");await wait(()=>labels().some(label=>label==="adapter"||label==="main"),"FROM acceptance did not continue with its catalog");report.acceptedFromContinues=true;
    return {...report,realMonacoWidget:true,productionProvider:true,productionCoordinator:true,nativeSqlite:true};
  }finally{coordinator?.dispose();await client.didClose(uri).catch(()=>{});editor.setModel(original?.isDisposed()?null:original);model.dispose();}
}
