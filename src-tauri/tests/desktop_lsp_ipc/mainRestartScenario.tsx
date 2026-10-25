import type * as Monaco from "monaco-editor";
import {createRoot} from "react-dom/client";
import {LspConnectionSyncer} from "@/components/lsp/LspConnectionSyncer";
import {useLspClient} from "@/hooks/useLspClient";
import {useLspDocumentLifecycle} from "@/features/query-editor/hooks/useLspDocumentLifecycle";
import {useQuerySqlCompletion} from "@/features/query-editor/hooks/useQuerySqlCompletion";
import {defaultDatabaseCapabilities,lspLanguageIdForCapabilities} from "@/lib/databaseDialect";
import {DEFAULT_APP_SETTINGS} from "@/lib/appSettings";
import {getLspDocumentUri} from "@/services/lsp/document";
import {shutdownLspSession} from "@/services/lsp/sessionRegistry";
import type {LspClient} from "@/services/lsp/client";
import {executeQuery} from "@/services/tauri/query.service";
import {useConnectionStore} from "@/store/useConnectionStore";
import {useSchemaStore} from "@/store/useSchemaStore";
import {useTabStore} from "@/store/useTabStore";
import {useProjectStore} from "@/store/useProjectStore";
import {useSettingsStore} from "@/store/useSettingsStore";
import {useLspSemanticStatusStore} from "@/store/useLspSemanticStatusStore";
import {useConnectionSemanticStore} from "@/services/lsp/connectionSemanticState";
import {useRef} from "react";

type Environment={monaco:typeof import("monaco-editor/esm/vs/editor/editor.api.js");editor:Monaco.editor.IStandaloneCodeEditor;
  check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};

export async function runMainRestartAcceptance(environment:Environment){
  const {monaco,editor,step}=environment,check:Environment["check"]=environment.check;
  const connectionId="semantic-sqlite",projectId="main-restart-native",tabId="main-restart";
  await executeQuery(connectionId,"CREATE TABLE main_restart_ledger(restart_value INTEGER)");
  const capabilities=defaultDatabaseCapabilities("sqlite"),language=lspLanguageIdForCapabilities(capabilities);
  monaco.languages.register({id:language});const uri=getLspDocumentUri(tabId,"sqlite",language);
  const sql="WITH base AS (SELECT m.* FROM main_restart_ledger m), q AS (SELECT b.* FROM base b) SELECT q.restSuffix FROM q";
  const connection={id:connectionId,name:"Main restart SQLite",driver:"sqlite",url:"sqlite::memory:"} as any;
  const prior={connections:useConnectionStore.getState(),schema:useSchemaStore.getState(),tabs:useTabStore.getState(),project:useProjectStore.getState(),settings:useSettingsStore.getState(),status:useLspSemanticStatusStore.getState(),semantic:useConnectionSemanticStore.getState()};
  const settings={...DEFAULT_APP_SETTINGS.editor,sqlCompletion:{...DEFAULT_APP_SETTINGS.editor.sqlCompletion,rankByUsage:false,appendSpace:false,snippets:[]}};
  useConnectionStore.setState({connections:[connection],activeConnectionId:connectionId,isConnected:true,connectionRuntimeStates:{[connectionId]:{status:"connected",updatedAt:1}}});
  useSchemaStore.setState({schemas:["main"],currentSchema:"main",tables:[],metadataVersion:1});useProjectStore.setState({activeProjectId:projectId});
  // This tab deliberately follows the global connection, so clearing it must
  // revoke an old reader even though the tab's own route has not changed.
  useTabStore.setState({tabs:[{id:tabId,type:"query",targetSchema:"main",schemaName:"main",sql} as any],activeTabId:tabId});
  useSettingsStore.setState({settings:{...prior.settings.settings,editor:settings}});useLspSemanticStatusStore.setState({byConnectionId:{}});
  const previousModel=editor.getModel(),model=monaco.editor.createModel(sql,language,monaco.Uri.parse(uri));editor.setModel(model);
  let client:LspClient|undefined,runtime:ReturnType<typeof useLspClient>|undefined,originalCompletion:LspClient["getCompletionList"]|undefined;
  let originalOpen:LspClient["didOpen"]|undefined;
  let originalConfiguration:LspClient["updateConfiguration"]|undefined;
  let holdEnrichment=true,firstConfiguration=false,enrichmentHeld=false,releaseEnrichment:()=>void=()=>{};
  const acknowledgedOpens:Array<{generation:object;uri:string;text:string}>=[];
  let holdNext=false,heldWire=false,heldField=false,heldRequest=0,activeRequest=0,nextRequest=0,completionCalls=0,releaseHeld:(()=>void)|undefined;
  const responses:Array<{id:number;labels:string[]}>=[];
  const observedMonaco={...monaco,languages:{...monaco.languages,registerCompletionItemProvider:(id:string,provider:any)=>monaco.languages.registerCompletionItemProvider(id,{...provider,
    provideCompletionItems:async(...args:any[])=>{const id=++nextRequest;activeRequest=id;const result=await provider.provideCompletionItems(...args);responses.push({id,labels:(result?.suggestions||[]).map((value:any)=>typeof value.label==="string"?value.label:value.label.label)});return result;}})}};
  function Probe(){
    const activeId=useConnectionStore(state=>state.activeConnectionId),tab=useTabStore(state=>state.tabs.find(value=>value.id===tabId));
    const effectiveId=tab?.connectionId||activeId,activeConnection=useConnectionStore(state=>state.connections.find(value=>value.id===effectiveId));
    const next=useLspClient({connectionId:effectiveId,driver:"sqlite",capabilities,enabled:Boolean(effectiveId)});runtime=next;
    if(effectiveId&&!client){client=next.client;originalConfiguration=client.updateConfiguration;client.updateConfiguration=async config=>{
      if(holdEnrichment&&typeof config.oxideAnalysisToken==="string"){
        if(firstConfiguration){enrichmentHeld=true;await new Promise<void>(done=>{releaseEnrichment=done;});}else firstConfiguration=true;
      }
      return originalConfiguration!.call(client!,config);
    };originalOpen=client.didOpen;client.didOpen=async(...args)=>{
      const generation=client!.getRuntimeSnapshot().generation;await originalOpen!.apply(client!,args);acknowledgedOpens.push({generation,uri:args[0],text:args[1]});
    };originalCompletion=client.getCompletionList;client.getCompletionList=async(...args)=>{
      completionCalls++;const captured=holdNext;holdNext=false;if(captured)heldRequest=activeRequest;
      const progressive=holdEnrichment;
      const result=await originalCompletion!.apply(client!,args);if(captured){heldField=result.items.some(item=>item.label==="restart_value");heldWire=true;await new Promise<void>(resolve=>{releaseHeld=resolve;});}return progressive?{...result,items:[]}:result;
    };}
    const lifecycle=useLspDocumentLifecycle({activeTabId:tabId,activeDocumentText:tab?.sql??"",canUseLsp:true,documentLanguageId:language,documentUri:uri,lifecycleKey:"ready",lspClient:next.client,lspReady:next.isReady,lspSessionKey:next.sessionKey,monaco,tabs:tab?[tab]:[]});
    const trigger=useRef<"explicit"|"chained"|null>(null);
    useQuerySqlCompletion({syncDocument:lifecycle.syncDocument,activeProjectId:projectId,effectiveConnectionId:effectiveId,currentSchema:"main",activeTab:tab,driver:"sqlite",metadataVersion:1,schemaTables:[],editorSettings:settings,documentUri:uri,driverCatalogStatus:"ready",lspReady:next.isReady,preferredElasticsearchIndex:undefined,canUseLsp:true,monaco:observedMonaco as unknown as typeof Monaco,completionTriggerOriginRef:trigger,activeConnection,completionRequestGenerationRef:lifecycle.completionRequestGenerationRef,capabilities,documentLanguageId:language,lspClient:next.client,openedDocumentsRef:lifecycle.openedDocumentsRef,documentVersionsRef:lifecycle.documentVersionsRef,documentTextsRef:lifecycle.documentTextsRef,mountedEditor:editor,editorLanguageId:language,isActivePane:true});
    return null;
  }
  const container=document.createElement("div"),root=createRoot(container);document.body.appendChild(container);
  const change=editor.onDidChangeModelContent(()=>{if(editor.getModel()===model)useTabStore.getState().updateTabSql(tabId,model.getValue());});
  const widget=()=>editor.getDomNode()?.querySelector<HTMLElement>(".suggest-widget.visible");
  const token=()=>useLspSemanticStatusStore.getState().byConnectionId[connectionId]?.context?.analysisToken;
  const completeMetadata=()=>{const context=useLspSemanticStatusStore.getState().byConnectionId[connectionId]?.context;
    return Boolean(context?.metadataReady&&context.identity.lspRuntime===client?.getRuntimeSnapshot().generation);};
  const wait=async(predicate:()=>boolean,message:string,timeout=10000)=>{const end=Date.now()+timeout;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));check(predicate(),message+(predicate()?"":"; state="+JSON.stringify({runtime:runtime?.status,ready:runtime?.isReady,error:runtime?.error,status:useLspSemanticStatusStore.getState().byConnectionId[connectionId]})));};
  const suggest=(fragment="restSuffix",offset=4)=>{editor.setPosition(model.getPositionAt(model.getValue().indexOf(fragment)+offset));editor.focus();editor.trigger("main-restart.acceptance","editor.action.triggerSuggest",{});};
  try{
    root.render(<><LspConnectionSyncer/><Probe/></>);
    await step("main-production-hooks-disconnect-withdraw-and-reconfigure",async()=>{
      await wait(()=>Boolean(runtime?.isReady&&token()),"actual connection syncer publishes an acknowledged main-editor configuration");
      await wait(()=>enrichmentHeld,"real progressive metadata enrichment is held before its actual RPC");
      check(useLspSemanticStatusStore.getState().byConnectionId[connectionId]?.context?.metadataReady===false,"initial confirmed source is still progressive");
      const initialVersion=model.getVersionId();suggest();await wait(()=>responses.some(value=>value.labels.length===0),"production provider finishes the first invoked empty list without a visible widget");
      check(!widget(),"the initial progressive completion is actually empty");holdEnrichment=false;releaseEnrichment();
      await wait(()=>Boolean(widget()?.textContent?.includes("restart_value")),"metadata completion automatically reopens the first empty interaction through two star CTEs");
      check(model.getVersionId()===initialVersion&&model.getValue()===sql,"first-empty recovery does not change SQL or its version");
      const before=token(),text=model.getValue(),version=model.getVersionId();await client!.shutdown();
      check(!widget(),"client disconnect withdraws visible main-editor suggestions synchronously");
      await wait(()=>Boolean(runtime?.isReady&&token()&&token()!==before&&completeMetadata()),"retained main session recovers and receives complete metadata under a new server-confirmed token",8000);
      check(model.getValue()===text&&model.getVersionId()===version,"restart does not edit SQL or its model version");
      // Configuration and document notifications have independent acknowledgements.
      // Observe the automatic owner didOpen; never open/synchronize it in the test.
      await wait(()=>acknowledgedOpens.some(value=>value.generation===client!.getRuntimeSnapshot().generation&&value.uri===uri&&value.text===text),"automatic lifecycle reopens the unchanged document in the replacement process");
      const at=model.getPositionAt(text.indexOf("restSuffix")+4),raw=await originalCompletion!.call(client!,uri,at.lineNumber-1,at.column-1);
      check(raw.items.some(item=>item.label==="restart_value"),"the fresh LSP process has reopened the unchanged main document");
    });
    await step("main-restart-rejects-old-pending-completion-and-accepts-fresh-widget",async()=>{
      editor.trigger("main-restart.acceptance","hideSuggestWidget",{});holdNext=true;heldWire=false;suggest();await wait(()=>heldWire,"actual old LSP response is held before renderer publication");
      check(heldField,"held old wire response contains an actual physical field before restart");
      const before=token();await client!.shutdown();await wait(()=>Boolean(runtime?.isReady&&token()&&token()!==before&&completeMetadata()),"second main process restart gets fresh complete metadata proof",8000);
      releaseHeld!();await wait(()=>responses.some(value=>value.id===heldRequest),"the held production completion finishes after restart");
      check(responses.find(value=>value.id===heldRequest)!.labels.length===0,"old-process completion result cannot publish into the replacement process context");
      editor.trigger("main-restart.acceptance","hideSuggestWidget",{});suggest();await wait(()=>Boolean(widget()?.textContent?.includes("restart_value")),"new process shows a fresh owning suggestion list");
      editor.trigger("main-restart.acceptance","acceptSelectedSuggestion",{});await wait(()=>model.getValue().includes("SELECT q.restart_value FROM q"),"actual main suggestion acceptance consumes the stale identifier suffix");
    });
    await step("main-connectionless-explicit-cte-without-old-physical-metadata",async()=>{
      model.setValue(sql);suggest();await wait(()=>Boolean(widget()?.textContent?.includes("restart_value")),"connected main list exists before global connection withdrawal");
      useConnectionStore.setState({activeConnectionId:null});check(!widget(),"clearing the global fallback connection withdraws the old physical widget before React commits");
      model.setValue("WITH q AS (SELECT 1 AS local_amount) SELECT q.localSuf FROM q");
      await wait(()=>runtime?.status==="disabled","connectionless editor does not retain a connection LSP grant");
      const before=completionCalls;suggest("localSuf",5);await wait(()=>Boolean(widget()?.textContent?.includes("local_amount")),"connectionless explicit CTE field appears in the real main widget");
      check(!widget()?.textContent?.includes("restart_value"),"connectionless widget excludes the old physical field");check(completionCalls===before,"connectionless explicit field needs no connection LSP request");
      editor.trigger("main-restart.acceptance","acceptSelectedSuggestion",{});await wait(()=>model.getValue().includes("SELECT q.local_amount FROM q"),"connectionless document-only candidate is actually accepted with the full suffix removed");
    });
  }finally{
    holdEnrichment=false;releaseEnrichment();releaseHeld?.();change.dispose();root.unmount();container.remove();editor.trigger("main-restart.acceptance","hideSuggestWidget",{});editor.setModel(previousModel);model.dispose();
    if(client&&originalCompletion){client.getCompletionList=originalCompletion;if(originalOpen)client.didOpen=originalOpen;if(originalConfiguration)client.updateConfiguration=originalConfiguration;await shutdownLspSession(client.getSessionKey());}
    useConnectionStore.setState(prior.connections);useSchemaStore.setState(prior.schema);useTabStore.setState(prior.tabs);useProjectStore.setState(prior.project);useSettingsStore.setState(prior.settings);useLspSemanticStatusStore.setState(prior.status);useConnectionSemanticStore.setState(prior.semantic);
  }
  return {productionRuntimeHook:true,productionConnectionSyncer:true,productionMainCompletionHook:true,realWidget:true,firstEmptyProgressiveRecovery:true,controlledEnrichmentHold:true,disconnectWithdrawal:true,automaticRestart:true,freshConfigurationToken:true,automaticOpenAcknowledged:true,unchangedDocumentReopened:true,oldPendingResultRejected:true,actualSuffixAcceptance:true,connectionlessExplicitCte:true,noOldPhysicalFields:true};
}
