import type * as Monaco from "monaco-editor";
import {listen} from "@tauri-apps/api/event";
import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/esm/vs/editor/contrib/inlineCompletions/browser/inlineCompletions.contribution.js";
import {useInlineCompletionProvider} from "@/features/query-editor/hooks/useInlineCompletionProvider";
import {InlineCompletionCache} from "@/lib/inlineCompletion";
import {createRoot} from "react-dom/client";
import {useLspSchemaSync} from "@/features/lsp-sync/hooks/useLspSchemaSync";
import {useConnectionSemanticEvents} from "@/features/lsp-sync/hooks/useConnectionSemanticEvents";
import {useQuerySqlCompletion} from "@/features/query-editor/hooks/useQuerySqlCompletion";
import {useLspCoreProviderCoordinator} from "@/features/query-editor/hooks/useLspCoreProviderCoordinator";
import {useLspHoverProviderCoordinator} from "@/features/query-editor/hooks/useLspHoverProviderCoordinator";
import {useEditorDiagnostics} from "@/features/query-editor/hooks/useEditorDiagnostics";
import {createCompletionContextReader,subscribeCompletionContext} from "@/features/query-editor/model/completionContextState";
import {semanticTabRoute} from "@/services/lsp/semanticContext";
import {syncLspModelBeforeCompletion} from "@/features/query-editor/model/lspDocumentSync";
import {defaultDatabaseCapabilities,lspLanguageIdForCapabilities} from "@/lib/databaseDialect";
import {DEFAULT_APP_SETTINGS} from "@/lib/appSettings";
import {getLspDocumentUri} from "@/services/lsp/document";
import type {DiagnosticSnapshotRequest} from "@/services/lsp/client/diagnostics";
import type {PublishDiagnosticsParams} from "@/services/lsp/types";
import type {LspClient} from "@/services/lsp/client";
import {useConnectionSemanticStore,isSemanticObservationIdle} from "@/services/lsp/connectionSemanticState";
import {executeQuery} from "@/services/tauri/query.service";
import {beginTransaction,rollbackTransaction} from "@/services/tauri/transaction.service";
import {getColumns} from "@/services/tauri/schema/catalog";
import {useConnectionStore} from "@/store/useConnectionStore";
import {useSchemaStore} from "@/store/useSchemaStore";
import {useTabStore} from "@/store/useTabStore";
import {useProjectStore} from "@/store/useProjectStore";
import {useLspSemanticStatusStore} from "@/store/useLspSemanticStatusStore";

type Environment={monaco:typeof import("monaco-editor/esm/vs/editor/editor.api.js");editor:Monaco.editor.IStandaloneCodeEditor;client:LspClient;
  check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};
export async function runOperationConsumerAcceptance(environment:Environment){
  const {monaco,editor,client,step}=environment,check:Environment["check"]=environment.check;
  const id="semantic-sqlite",projectId="operation-consumer-project",tabId="operation-consumer";
  await executeQuery(id,"CREATE TABLE epoch_ledger(epoch_old INTEGER)");
  const capabilities={...defaultDatabaseCapabilities("sqlite"),supportsFunctions:false,supportsTableIndexes:false,supportsTableConstraints:false};
  const language=lspLanguageIdForCapabilities(capabilities),uri=getLspDocumentUri(tabId,"sqlite",language);
  const connection={id,name:"Operation consumer SQLite",driver:"sqlite",url:"sqlite::memory:"} as Parameters<typeof useLspSchemaSync>[0]["activeConnection"];
  check(connection!==undefined,"actual SQLite connection descriptor exists");
  const runtime={status:"connected" as const,updatedAt:1};
  const sql="WITH q AS (SELECT l.* FROM epoch_ledger l) SELECT q.epSuffix FROM q";
  const tab={id:tabId,type:"query",connectionId:id,targetSchema:"main",schemaName:"main",sql};
  const prior={connection:useConnectionStore.getState(),schema:useSchemaStore.getState(),tabs:useTabStore.getState(),project:useProjectStore.getState(),semantic:useConnectionSemanticStore.getState(),status:useLspSemanticStatusStore.getState()};
  useConnectionStore.setState({connections:[connection],activeConnectionId:id,isConnected:true,connectionRuntimeStates:{[id]:runtime}});
  useSchemaStore.setState({schemas:["main"],currentSchema:"main",tables:[],metadataVersion:1});
  useTabStore.setState({tabs:[tab as typeof prior.tabs.tabs[number]],activeTabId:tabId});useProjectStore.setState({activeProjectId:projectId});
  const previousModel=editor.getModel(),model=monaco.editor.createModel(sql,"sql",monaco.Uri.parse(uri));editor.setModel(model);
  const position=model.getPositionAt(sql.indexOf("epSuffix")+2);editor.setPosition(position);editor.focus();
  const refs={opened:{current:new Set<string>()},versions:{current:new Map<string,number>()},texts:{current:new Map<string,string>()},
    generation:{current:new Map<string,number>()},trigger:{current:null as "explicit"|"chained"|null}};
  const settings={...DEFAULT_APP_SETTINGS.editor,inlineCompletion:{...DEFAULT_APP_SETTINGS.editor.inlineCompletion,enabled:true,automaticSuggestions:false,includeSchemaMetadata:true,includeProjectContext:false},sqlCompletion:{...DEFAULT_APP_SETTINGS.editor.sqlCompletion,rankByUsage:false,appendSpace:false,snippets:[]}};
  const status=useLspSemanticStatusStore.getState();
  const getSemanticContext=createCompletionContextReader({connectionId:id,tabId,connection,lspClient:client,metadataVersion:1,
    projectId,currentSchema:"main",route:semanticTabRoute(tab)});
  const syncDocument=(sourceModel:Monaco.editor.ITextModel)=>syncLspModelBeforeCompletion({uri,model:sourceModel,languageId:language,
    client,openedDocuments:refs.opened.current,documentVersions:refs.versions.current,documentTexts:refs.texts.current});
  const noRoutine=()=>null,setLspDiagnostics=useTabStore.getState().setLspDiagnostics;
  const diagnosticFrames:Array<{version?:number;token?:string;codes:unknown[]}>=[];
  const releaseDiagnosticProbe=await listen<{sessionKey?:string;method:string;params:{uri?:string;version?:number;oxideAnalysisToken?:string;diagnostics?:Array<{code?:unknown}>}}>("lsp-notification",({payload})=>{
    if(payload.sessionKey!==client.getSessionKey()||payload.method!=="textDocument/publishDiagnostics"||payload.params.uri!==uri)return;
    diagnosticFrames.push({version:payload.params.version,token:payload.params.oxideAnalysisToken,codes:(payload.params.diagnostics||[]).map(value=>value.code)});
    if(diagnosticFrames.length>8)diagnosticFrames.shift();
  });
  let dropDiagnosticNotifications=false;const snapshotRequests:DiagnosticSnapshotRequest[]=[];
  const requestDiagnosticSnapshot=(request:DiagnosticSnapshotRequest)=>{snapshotRequests.push(request);return client.getDiagnosticSnapshot(request);};
  const subscribeDiagnostics=(accept:(value:PublishDiagnosticsParams)=>void)=>listen<{sessionKey?:string;method:string;params:PublishDiagnosticsParams}>("lsp-notification",({payload})=>{if(!dropDiagnosticNotifications&&payload.sessionKey===client.getSessionKey()&&payload.method==="textDocument/publishDiagnostics"&&payload.params.uri===uri)accept(payload.params);});
  const inlineCache={current:new InlineCompletionCache()},inlineAbort={current:null as AbortController|null},inlineListeners={current:new Set<()=>void>()};
  const noInlineProvider=()=>null,inlineStatus=()=>{};
  const inlineFrames:any[]=[];
  const inlineMonaco={...monaco,languages:{...monaco.languages,registerInlineCompletionsProvider:(language:string,provider:any)=>monaco.languages.registerInlineCompletionsProvider(language,{...provider,provideInlineCompletions:async(...args:any[])=>{const result=await provider.provideInlineCompletions(...args);inlineFrames.push({position:args[1],context:args[2],items:result?.items});if(inlineFrames.length>6)inlineFrames.shift();return result;}})}};
  let completionCalls=0,inlayCalls=0,inlineContextCalls=0,transactionOpen=false;
  const originalConfiguration=client.updateConfiguration;
  let rejectEnrichment=false,firstAcceptedToken:string|undefined,acceptedIdentity:unknown;
  const rejectedTokens:string[]=[];
  const releaseGrantProbe=useLspSemanticStatusStore.subscribe(state=>{const context=state.byConnectionId[id]?.context;if(rejectEnrichment&&context?.analysisToken===firstAcceptedToken&&context?.sourcesReady)acceptedIdentity=context.identity;});
  const originalCompletion=client.getCompletionList,originalInlays=client.getInlayHints,originalInlineContext=client.getInlineCompletionContext,originalLocalCompletion=client.getDocumentCompletions,originalTrigger=editor.trigger;
  const completionTrace:Array<Record<string,unknown>>=[];
  const trace=(kind:string,data:Record<string,unknown>={})=>{const current=getSemanticContext();completionTrace.push({kind,time:performance.now(),available:current.available,syntax:current.syntaxAllowed,lsp:current.lspAllowed,metadata:current.metadataAllowed,focus:editor.hasTextFocus(),position:editor.getPosition(),...data});if(completionTrace.length>96)completionTrace.shift();};
  const traceReleases=[editor.onDidBlurEditorText(()=>trace("blur")),editor.onDidChangeCursorPosition(event=>trace("cursor",{source:event.source,reason:event.reason})),subscribeCompletionContext(()=>trace("context"),client)];
  editor.trigger=(source,command,args)=>{trace("trigger",{source,command});originalTrigger.call(editor,source,command,args);};
  client.getInlineCompletionContext=(...args)=>{inlineContextCalls++;return originalInlineContext.apply(client,args);};
  client.getCompletionList=async(...args)=>{completionCalls++;trace("physical-start");const result=await originalCompletion.apply(client,args);trace("physical-end",{labels:result.items.map(item=>item.label)});return result;};
  client.getDocumentCompletions=async(...args)=>{trace("local-start");const result=await originalLocalCompletion.apply(client,args);trace("local-end",{labels:result?.items.map(item=>item.label)});return result;};
  client.getInlayHints=(...args)=>{inlayCalls++;return originalInlays.apply(client,args);};
  const sync:Omit<Parameters<typeof useLspSchemaSync>[0],"executionObservation">={
    activeConnectionId:id,metadataVersion:1,isReady:true,activeConnection:connection,activeConnectionRuntime:runtime,activeProjectRoot:null,
    hasConnectionLspTab:true,lspCapabilities:capabilities,supportsMetadataSync:true,clearSemanticStatus:status.clearStatus,
    resolvedCapabilityContext:{connectionId:id,capabilities,serverVersion:null},setSemanticStatus:status.setStatus,
    schemas:["main"],currentSchema:"main",activeTabId:tabId,tabs:[tab],activeProjectId:projectId,lspClient:client,
    completionPreferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"},
    formattingPreferences:{keywordCase:"upper",functionCase:"upper",logicalOperatorNewline:"before",fromClauseLayout:"newLine"},
    recordSemanticTelemetry:status.recordTelemetry,connections:[connection],tables:[],keywordCase:"upper",functionCase:"upper",tableAlias:"none",
    logicalOperatorNewline:"before",fromClauseLayout:"newLine",driverCatalogStatus:"ready",projectDocumentRevisionKey:""};
  function Probe(){
    const executionObservation=useConnectionSemanticEvents(id,runtime);
    useLspSchemaSync({...sync,executionObservation});
    useInlineCompletionProvider({editorSettings:settings,isActivePane:true,monaco:inlineMonaco as unknown as typeof Monaco,inlineCompletionAbortRef:inlineAbort,setInlineCompletionStatus:inlineStatus,inlineCompletionCacheRef:inlineCache,inlineProviderConfig:noInlineProvider,
      editorLanguageId:"sql",inlineCompletionListenersRef:inlineListeners,documentUri:uri,mountedEditor:editor,isElasticsearchConsole:false,preferredElasticsearchIndex:undefined,elasticsearchServerVersion:undefined,driver:"sqlite",capabilities,lspReady:true,canUseLsp:true,
      documentLanguageId:language,lspClient:client,openedDocumentsRef:refs.opened,documentVersionsRef:refs.versions,documentTextsRef:refs.texts,usageScope:uri,inlineCompletionProtocol:"chat-completions",inlineCompletionModel:"",activeTab:tab as typeof prior.tabs.tabs[number],
      projectId,projectRootPath:null,inlineBaseUrl:"",inlineApiKey:"",inlineTimeoutMs:1000,rankByUsage:false,getSemanticContext,subscribeSemanticContext:subscribeCompletionContext});
    useEditorDiagnostics({monaco:monaco as unknown as typeof Monaco,lspReady:true,lspSessionKey:client.getSessionKey(),documentUri:uri,
      diagnosticDialect:"sqlite",requestDiagnosticSnapshot,subscribeDiagnostics,
      documentVersionsRef:refs.versions,documentTextsRef:refs.texts,getSemanticContext,subscribeSemanticContext:subscribeCompletionContext,
      mysqlRoutineAnalysisForModel:noRoutine,setLspDiagnostics,mountedEditor:editor,activeTab:tab as typeof prior.tabs.tabs[number],driver:"sqlite"});
    useLspCoreProviderCoordinator({canUseLsp:true,documentUri:uri,editorLanguageId:"sql",isActivePane:true,
      lspClient:client,monaco,editor,getSemanticContext,subscribeSemanticContext:subscribeCompletionContext,
      syncDocument,
      documentVersionsRef:refs.versions,documentTextsRef:refs.texts});
    useLspHoverProviderCoordinator({canUseLsp:true,documentUri:uri,documentLanguageId:language,editorLanguageId:"sql",isActivePane:true,
      lspClient:client,monaco,editor,getSemanticContext,subscribeSemanticContext:subscribeCompletionContext,
      driver:"sqlite",effectiveConnectionId:id,currentSchema:"main",metadataRevision:1,schemaTables:[],
      showTableDdlHoverPreview:false,supportsTableBrowsing:false,openedDocumentsRef:refs.opened,
      documentVersionsRef:refs.versions,documentTextsRef:refs.texts});
    useQuerySqlCompletion({activeProjectId:projectId,effectiveConnectionId:id,currentSchema:"main",activeTab:tab as typeof prior.tabs.tabs[number],driver:"sqlite",
      metadataVersion:1,schemaTables:[{name:"epoch_ledger",schema:"main",type:"BASE TABLE"}],editorSettings:settings,
      documentUri:uri,driverCatalogStatus:"ready",lspReady:true,preferredElasticsearchIndex:undefined,canUseLsp:true,monaco:monaco as unknown as typeof Monaco,
      completionTriggerOriginRef:refs.trigger,activeConnection:connection,completionRequestGenerationRef:refs.generation,
      capabilities,documentLanguageId:language,lspClient:client,openedDocumentsRef:refs.opened,documentVersionsRef:refs.versions,
      documentTextsRef:refs.texts,mountedEditor:editor,editorLanguageId:"sql",isActivePane:true});return null;
  }
  const element=document.createElement("div");document.body.appendChild(element);const root=createRoot(element);
  const wait=async(predicate:()=>boolean,message:string)=>{const deadline=Date.now()+15000;while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));check(predicate(),message);};
  const widget=()=>editor.getDomNode()?.querySelector<HTMLElement>(".suggest-widget.visible");
  const ready=()=>{const source=useConnectionSemanticStore.getState().byConnectionId[id],published=useLspSemanticStatusStore.getState().byConnectionId[id];
    return isSemanticObservationIdle(source)&&published?.context?.identity.execution===source&&published?.context?.metadataReady===true;};
  try{
    await step("driver-operation-events-production-renderer-sync-and-real-monaco",async()=>{
      root.render(<Probe/>);await wait(ready,"production observer and sync hooks publish metadata for the actual driver revision");
      refs.trigger.current="explicit";editor.trigger("operation.consumer","editor.action.triggerSuggest",{});
      await wait(()=>Boolean(widget()?.textContent?.includes("epoch_old")),"actual widget shows the actual SQLite column through the production hooks");
      const beforeVersion=model.getVersionId(),beforeText=model.getValue(),beforeRevision=useConnectionSemanticStore.getState().byConnectionId[id]!.state!.revision;
      let failed=false;const operation=executeQuery(id,"ALTER TABLE epoch_ledger RENAME COLUMN epoch_old TO epoch_new; SELECT * FROM missing_consumer").catch(()=>{failed=true;});
      await wait(()=>!widget(),"actual local/host operation notifications withdraw the old visible list");await operation;
      check(failed,"the actual metadata-changing batch reports its later SQL error");
      check(model.getValue()===beforeText&&model.getVersionId()===beforeVersion,"operation-driven invalidation does not edit the document");
      check((await getColumns(id,"main","epoch_ledger")).some(column=>column.name==="epoch_new"),"the renamed column actually exists after the partial batch error");
      await wait(()=>ready()&&(useConnectionSemanticStore.getState().byConnectionId[id]?.state?.revision||0)>beforeRevision,"production sync reaches the new idle host revision after the error");
      try{await wait(()=>Boolean(widget()?.textContent?.includes("epoch_new")),"the same real widget interaction recovers the actual new column");}catch(error){throw new Error(String(error)+"; completion proof="+JSON.stringify({trace:completionTrace,widget:widget()?.textContent,sql:model.getValue()}));}
      check(!widget()?.textContent?.includes("epoch_old"),"the recovered list does not retain the old schema field");
      check(useSchemaStore.getState().metadataVersion===1,"driver events refresh this connection without bumping the global metadata version");
      editor.trigger("operation.consumer","acceptSelectedSuggestion",{});await new Promise(resolve=>setTimeout(resolve,50));
      check(model.getValue()==="WITH q AS (SELECT l.* FROM epoch_ledger l) SELECT q.epoch_new FROM q","actual acceptance inserts the new inherited field and consumes the suffix");
    });
    await step("driver-transaction-held-local-cte-completion-and-rendered-inlays",async()=>{
      editor.trigger("operation.consumer","hideSuggestWidget",{});
      await beginTransaction(id,"consumer-local-tx");transactionOpen=true;
      await wait(()=>useConnectionSemanticStore.getState().byConnectionId[id]?.state?.openTransactions===1,"actual open transaction reaches the production consumer");
      check(getSemanticContext().available&&!getSemanticContext().metadataAllowed&&!getSemanticContext().lspAllowed,"an open transaction retains document-local availability without old physical authority");
      const text="WITH seed AS (SELECT CAST(1 AS INTEGER) AS declared_amount), q AS (SELECT s.declared_amount AS declared_total FROM seed s) SELECT q.declSuffix FROM q;\nINSERT INTO epoch_ledger(explicit_field) VALUES(1);";
      model.setValue(text);editor.setPosition(model.getPositionAt(text.indexOf("declSuffix")+4));editor.focus();
      const beforeCompletion=completionCalls,beforeInlays=inlayCalls;
      editor.updateOptions({inlayHints:{enabled:"on",fontSize:14}});
      refs.trigger.current="explicit";editor.trigger("operation.consumer","editor.action.triggerSuggest",{});
      await wait(()=>Boolean(widget()?.textContent?.includes("declared_total")),"real widget infers the nested CTE projection while the actual transaction remains open");
      check(!widget()?.textContent?.includes("epoch_new"),"held transaction cannot reuse physical columns");
      editor.trigger("operation.consumer","acceptSelectedSuggestion",{});await new Promise(resolve=>setTimeout(resolve,50));
      check(model.getValue().includes("SELECT q.declared_total FROM q"),"document-local completion consumes the real suffix during the transaction");
      await wait(()=>Boolean(editor.getDomNode()?.textContent?.includes("explicit_field:")),"actual Monaco renders explicit INSERT column hints without physical metadata");
      check(completionCalls===beforeCompletion&&inlayCalls===beforeInlays,"held document-local inference issues no LSP completion or inlay requests");
      await rollbackTransaction(id,"consumer-local-tx");transactionOpen=false;await wait(ready,"actual rollback restores a verified idle metadata publication");
    });
    await step("driver-operation-withdraws-and-refreshes-real-physical-inlays",async()=>{
      const text="SELECT l.epoch_new FROM epoch_ledger l;\nINSERT INTO epoch_ledger VALUES(1);";model.setValue(text);editor.setPosition({lineNumber:1,column:13});
      await syncLspModelBeforeCompletion({uri,model,languageId:language,client,openedDocuments:refs.opened.current,documentVersions:refs.versions.current,documentTexts:refs.texts.current});
      await wait(()=>Boolean(editor.getDomNode()?.textContent?.includes("epoch_new:")),"actual Monaco renders the physical SQLite INSERT label");
      const hover=()=>Array.from(document.querySelectorAll<HTMLElement>(".monaco-hover")).find(element=>element.getClientRects().length>0);
      check(Boolean(editor.getAction("editor.action.showHover")),"the isolated host loads the actual Monaco hover controller");
      check((await client.getHover(uri,0,12))?.contents.includes("epoch_new"),"the actual LSP supplies the SQLite column hover before testing the real widget");
      editor.focus();editor.trigger("operation.consumer","editor.action.showHover",{});
      await wait(()=>Boolean(hover()?.textContent?.includes("epoch_new")),"actual Monaco hover renders the physical SQLite column");
      const version=model.getVersionId();
      const operation=executeQuery(id,"ALTER TABLE epoch_ledger RENAME COLUMN epoch_new TO epoch_last");
      await wait(()=>!hover(),"driver authority changes close the already visible Monaco hover");
      await wait(()=>!editor.getDomNode()?.textContent?.includes("epoch_new:"),"driver operation withdraws the already rendered old physical inlay");await operation;
      await wait(()=>ready()&&Boolean(editor.getDomNode()?.textContent?.includes("epoch_last:")),"the rendered physical inlay recovers from fresh SQLite metadata");
      check(!editor.getDomNode()?.textContent?.includes("epoch_new:"),"the old physical inlay does not remain alongside the fresh one");
      check(model.getValue()===text&&model.getVersionId()===version,"actual operation-driven inlay refresh preserves SQL and its version");
    });
    await step("driver-operation-diagnostic-markers-use-exact-analysis-configuration",async()=>{
      editor.trigger("operation.consumer","editor.action.hideHover",{});
      const text="WITH q AS (SELECT l.* FROM epoch_ledger l) SELECT epoch_last FROM q a JOIN epoch_ledger b ON 1=1;";
      model.setValue(text);await syncDocument(model);
      const collision=()=>monaco.editor.getModelMarkers({owner:"sql-lsp",resource:model.uri}).filter(marker=>marker.code==="OXIDE004");
      try{await wait(()=>collision().length===1,"production diagnostic hook renders the actual CTE/physical-source ambiguity marker");}
      catch(error){throw new Error(String(error)+"; diagnostic proof="+JSON.stringify({context:getSemanticContext(),shadowVersion:refs.versions.current.get(uri),textMatches:refs.texts.current.get(uri)===model.getValue(),markers:monaco.editor.getModelMarkers({owner:"sql-lsp",resource:model.uri}).map(value=>value.code),frames:diagnosticFrames}));}
      const version=model.getVersionId(),token=getSemanticContext().analysisToken;
      check(typeof token==="string"&&token.length>0,"production synchronization exposes the actual analysis configuration token");
      const operation=executeQuery(id,"ALTER TABLE epoch_ledger RENAME COLUMN epoch_last TO epoch_final");
      await wait(()=>collision().length===0,"driver operation withdraws the visible old ambiguity marker");await operation;
      await wait(()=>ready()&&getSemanticContext().analysisToken!==token,"new metadata receives a distinct acknowledged analysis token");
      check(collision().length===0,"the old-token ambiguity cannot reappear after the metadata changes");
      check(!(useTabStore.getState().tabs.find(value=>value.id===tabId)?.lspDiagnostics||[]).some(value=>value.code==="OXIDE004"),"the problem list also drops the old ambiguity");
      await executeQuery(id,"ALTER TABLE epoch_ledger RENAME COLUMN epoch_final TO epoch_last");
      await wait(()=>ready()&&collision().length===1,"actual schema restoration republishes and restores the correct marker");
      check(model.getValue()===text&&model.getVersionId()===version,"diagnostic withdrawal and recovery do not edit SQL or its version");
    });
    await step("driver-transaction-held-real-syntax-snapshot",async()=>{
      await beginTransaction(id,"consumer-local-tx");transactionOpen=true;
      await wait(()=>useConnectionSemanticStore.getState().byConnectionId[id]?.state?.openTransactions===1,"real transaction holds physical authority for syntax acceptance");
      const before=snapshotRequests.length;model.setValue("SELECT '漢😀';\nSELECT (1 + );");await syncDocument(model);
      const version=model.getVersionId();
      await wait(()=>monaco.editor.getModelMarkers({owner:"sql-lsp",resource:model.uri}).some(marker=>marker.code==="SYNTAX_ERROR"),"production hook renders actual schema-free parser diagnostic during the real open transaction");
      check(snapshotRequests.slice(before).some(value=>value.mode==="syntax"&&!value.oxideAnalysisToken),"held syntax comes from an actual token-free snapshot request");
      check(!getSemanticContext().metadataAllowed,"syntax readback does not grant physical metadata");
      check((useTabStore.getState().tabs.find(value=>value.id===tabId)?.lspDiagnostics||[]).some(value=>value.code==="SYNTAX_ERROR"),"the actual problems list also receives held syntax");
      check(model.getVersionId()===version,"syntax recovery preserves the edited document version");
      await rollbackTransaction(id,"consumer-local-tx");transactionOpen=false;await wait(ready,"rollback restores metadata after syntax acceptance");
    });
    await step("controlled-notification-gap-recovers-through-real-snapshot-ipc",async()=>{
      dropDiagnosticNotifications=true;
      try{
        const before=snapshotRequests.length;model.setValue("WITH q AS (SELECT l.* FROM epoch_ledger l) SELECT epoch_last FROM q a JOIN epoch_ledger b ON 1=1;");await syncDocument(model);
        const version=model.getVersionId();
        await wait(()=>monaco.editor.getModelMarkers({owner:"sql-lsp",resource:model.uri}).some(marker=>marker.code==="OXIDE004"),"production hook restores actual metadata ambiguity despite a controlled dropped-notification stream");
        check(snapshotRequests.slice(before).some(value=>value.mode==="metadata"&&value.oxideAnalysisToken===getSemanticContext().analysisToken),"recovery traverses actual client and Host IPC with the current analysis token");
        check((useTabStore.getState().tabs.find(value=>value.id===tabId)?.lspDiagnostics||[]).some(value=>value.code==="OXIDE004"),"the problems list recovers alongside actual Monaco markers");
        check(model.getVersionId()===version,"gap recovery does not modify SQL");
      }finally{dropDiagnosticNotifications=false;}
    });
    await step("driver-operation-withdraws-real-inline-preview-and-accepts-fresh-field",async()=>{
      editor.trigger("operation.consumer","hideSuggestWidget",{});editor.trigger("operation.consumer","editor.action.hideHover",{});
      editor.updateOptions({inlineSuggest:{enabled:true,mode:"subwordSmart"}});
      check(Boolean(editor.getAction("editor.action.inlineSuggest.trigger")),"the actual Monaco inline controller is installed");
      const text="WITH q AS (SELECT l.* FROM epoch_ledger l) SELECT q.epSuffix FROM q";model.setValue(text);editor.setPosition(model.getPositionAt(text.indexOf("epSuffix")+2));editor.focus();await syncDocument(model);
      const ghost=()=>Array.from(editor.getDomNode()?.querySelectorAll<HTMLElement>(".ghost-text-decoration,.inlineCompletions-char-insert,.inline-edits-view,.word-replacement")||[]).filter(element=>element.getClientRects().length>0).map(element=>element.textContent||"").join("");
      editor.trigger("operation.consumer","editor.action.inlineSuggest.trigger",{});
      try{await wait(()=>ghost().includes("och_last"),"actual inline preview contains the actual physical field through a CTE");}
      catch(error){throw new Error(String(error)+"; inline proof="+JSON.stringify({frames:inlineFrames,calls:inlineContextCalls,source:getSemanticContext(),controller:(()=>{const control=editor.getContribution("editor.contrib.inlineCompletionsController") as any;const current=control?.model.get();return {state:current?.state.get()?.kind,active:current?._isActive?.get(),edit:current?.inlineEditState.get()?.inlineCompletion?.isInlineEdit,options:editor.getOption(monaco.editor.EditorOption.inlineSuggest),snippet:(editor.getContribution("snippetController2") as any)?.isInSnippet(),nodes:Array.from(document.querySelectorAll<HTMLElement>("[class*=inline-edit],[class*=inlineCompletions],[class*=ghost-text]")).map(element=>({classes:element.className,text:element.textContent?.slice(0,150),visible:element.getClientRects().length>0})).slice(-12)};})(),dom:editor.getDomNode()?.textContent?.slice(-1000),ghost:ghost(),direct:await client.getInlineCompletionContext(uri,0,text.indexOf("epSuffix")+2)}));}
      const version=model.getVersionId(),before=inlineContextCalls;
      const operation=executeQuery(id,"ALTER TABLE epoch_ledger RENAME COLUMN epoch_last TO epoch_inline");
      await wait(()=>!ghost(),"the actual operation event withdraws visible old inline preview");await operation;await wait(ready,"inline recovery waits for the new idle metadata grant");
      check(model.getValue()===text&&model.getVersionId()===version,"inline withdrawal preserves SQL and its version");
      editor.trigger("operation.consumer","editor.action.inlineSuggest.trigger",{});
      await wait(()=>ghost().includes("och_inline"),"a fresh explicit inline request uses the new physical field");
      check(!ghost().includes("och_last")&&inlineContextCalls>before,"fresh inline preview does not reuse an old candidate or cache");
      editor.trigger("operation.consumer","editor.action.inlineSuggest.commit",{});
      await wait(()=>model.getValue().includes("SELECT q.epoch_inline FROM q"),"accepting actual inline preview consumes the identifier suffix correctly");
      check(!model.getValue().includes("Suffix"),"inline acceptance removes the whole old member suffix");
    });
    await step("driver-transaction-keeps-real-document-local-inline-cte",async()=>{
      editor.trigger("operation.consumer","hideSuggestWidget",{});editor.trigger("operation.consumer","editor.action.inlineSuggest.hide",{});
      await beginTransaction(id,"consumer-local-tx");transactionOpen=true;
      await wait(()=>useConnectionSemanticStore.getState().byConnectionId[id]?.state?.openTransactions===1,"actual transaction reaches inline context");
      const text="WITH first AS (SELECT 1 AS declared_total), second AS (SELECT a.* FROM first a) SELECT q.deSuffix FROM second q";model.setValue(text);editor.setPosition(model.getPositionAt(text.indexOf("deSuffix")+2));editor.focus();await syncDocument(model);
      const before=inlineContextCalls,ghost=()=>Array.from(editor.getDomNode()?.querySelectorAll<HTMLElement>(".ghost-text-decoration,.inlineCompletions-char-insert,.inline-edits-view,.word-replacement")||[]).filter(element=>element.getClientRects().length>0).map(element=>element.textContent||"").join("");
      editor.trigger("operation.consumer","editor.action.inlineSuggest.trigger",{});
      await wait(()=>ghost().includes("clared_total"),"actual inline preview resolves nested explicit CTE output during an open transaction");
      check(inlineContextCalls===before,"held document-local inline inference sends no physical LSP context request");
      check(!ghost().includes("epoch_inline"),"document-local ghost text does not borrow actual physical fields");
      editor.trigger("operation.consumer","editor.action.inlineSuggest.commit",{});
      await wait(()=>model.getValue().includes("SELECT q.declared_total FROM second q"),"actual local inline acceptance consumes the complete suffix");
      await rollbackTransaction(id,"consumer-local-tx");transactionOpen=false;await wait(ready,"actual rollback restores physical metadata after inline acceptance");
    });
    await step("invalid-progressive-configuration-revokes-real-production-grants",async()=>{
      editor.trigger("operation.consumer","editor.action.inlineSuggest.hide",{});
      const text="WITH q AS (SELECT 1 AS declared_total) SELECT q.declSuffix FROM q; SELECT e.epoch_inline FROM epoch_ledger e;";
      model.setValue(text);editor.setPosition(model.getPositionAt(text.indexOf("declSuffix")+4));editor.focus();await syncDocument(model);
      rejectEnrichment=true;
      client.updateConfiguration=async config=>{
        const token=config?.oxideAnalysisToken;
        if(rejectEnrichment&&typeof token==="string"){
          if(!firstAcceptedToken){firstAcceptedToken=token;await originalConfiguration.call(client,config);return;}
          rejectedTokens.push(token);await originalConfiguration.call(client,{...config,schemas:null});return;
        }
        await originalConfiguration.call(client,config);
      };
      // More than the real 32-object batch gives one confirmed progressive
      // publication followed by an invalid enrichment in the same identity.
      await executeQuery(id,Array.from({length:35},(_,i)=>`CREATE TABLE config_probe_${i}(id INTEGER)`).join(";"));
      await wait(()=>Boolean(rejectedTokens.length&&useLspSemanticStatusStore.getState().byConnectionId[id]?.state==="error"),"the actual sync job exposes a rejected progressive configuration as an error");
      const failed=useLspSemanticStatusStore.getState().byConnectionId[id]?.context;
      check(acceptedIdentity&&failed?.identity===acceptedIdentity,"a real confirmed partial publication and later rejection share the same source identity");
      check(failed?.analysisToken===undefined&&!failed?.sourcesReady&&!failed?.metadataReady,"production publication revokes its earlier successful receipt after rejection");
      check(getSemanticContext().syntaxAllowed&&!getSemanticContext().lspAllowed&&!getSemanticContext().metadataAllowed,"actual editor context retains syntax without authorizing the old catalog");
      check(!await client.confirmAnalysisConfiguration(firstAcceptedToken!),"the actual server rejects the old partial token after the bad update");
      check(!await client.confirmAnalysisConfiguration(rejectedTokens[rejectedTokens.length-1]!),"the actual server never confirms the rejected update token");
      check((await client.getDocumentSymbols(uri)).some(item=>item.name==="epoch_ledger"),"last valid physical catalog names remain available for rollback without granting them to the editor");
      const before=completionCalls;refs.trigger.current="explicit";editor.trigger("operation.consumer","editor.action.triggerSuggest",{});
      await wait(()=>Boolean(widget()?.textContent?.includes("declared_total")),"production query hook retains its actual local CTE widget after configuration rejection");
      check(completionCalls===before,"the rejected context does not start a standard physical completion request");
      editor.trigger("operation.consumer","acceptSelectedSuggestion",{});await wait(()=>model.getValue().includes("SELECT q.declared_total FROM q")&&!model.getValue().includes("Suffix"),"actual local acceptance works through the configuration error");
    });
    await step("valid-configuration-repair-restores-real-metadata-and-acceptance",async()=>{
      rejectEnrichment=false;client.updateConfiguration=originalConfiguration;
      const text="WITH q AS (SELECT l.* FROM epoch_ledger l) SELECT q.epSuffix FROM q";model.setValue(text);editor.setPosition(model.getPositionAt(text.indexOf("epSuffix")+2));editor.focus();await syncDocument(model);
      await executeQuery(id,"ALTER TABLE epoch_ledger RENAME COLUMN epoch_inline TO epoch_configured");await wait(ready,"a fresh actual driver observation and valid config repair restore metadata");
      check(typeof getSemanticContext().analysisToken==="string"&&!rejectedTokens.includes(getSemanticContext().analysisToken!),"repair publishes a fresh confirmed token");
      const before=completionCalls;refs.trigger.current="explicit";editor.trigger("operation.consumer","editor.action.triggerSuggest",{});
      await wait(()=>Boolean(widget()?.textContent?.includes("epoch_configured")),"actual repaired widget uses the renamed SQLite column");check(completionCalls>before,"repaired production provider restores standard physical requests");
      editor.trigger("operation.consumer","acceptSelectedSuggestion",{});await wait(()=>model.getValue().includes("SELECT q.epoch_configured FROM q")&&!model.getValue().includes("Suffix"),"actual repaired physical acceptance consumes the suffix");
    });
  } finally {
    rejectEnrichment=false;client.updateConfiguration=originalConfiguration;releaseGrantProbe();
    editor.trigger=originalTrigger;client.getDocumentCompletions=originalLocalCompletion;for(const release of traceReleases){if(typeof release==="function")release();else release.dispose();}
    releaseDiagnosticProbe();
    if(transactionOpen)await rollbackTransaction(id,"consumer-local-tx");
    root.unmount();element.remove();if(refs.opened.current.has(uri))await client.didClose(uri);
    client.getCompletionList=originalCompletion;client.getInlayHints=originalInlays;client.getInlineCompletionContext=originalInlineContext;editor.trigger("operation.consumer","editor.action.inlineSuggest.hide",{});editor.updateOptions({inlayHints:{enabled:"off"}});
    editor.trigger("operation.consumer","hideSuggestWidget",{});editor.setModel(previousModel);model.dispose();
    useConnectionStore.setState(prior.connection);useSchemaStore.setState(prior.schema);useTabStore.setState(prior.tabs);useProjectStore.setState(prior.project);
    useConnectionSemanticStore.setState(prior.semantic);useLspSemanticStatusStore.setState(prior.status);
  }
  return {realSqlite:true,productionObserverHook:true,productionSyncHook:true,productionQueryCompletionHook:true,
    rendererInvalidationIntegrated:true,actualMetadataChange:true,partialError:true,globalMetadataVersionUnchanged:true,
    realWidgetWithdrawal:true,realWidgetRecovery:true,acceptedNewField:true,persistentStoreTested:false,sqlServerRoleVerified:false,
    productionCoreProviderHook:true,transactionLocalCompletion:true,transactionLocalInlays:true,noHeldCompletionOrInlayRequests:true,
    realPhysicalInlayWithdrawal:true,realPhysicalInlayRecovery:true,productionHoverProviderHook:true,realHoverWithdrawal:true,
    heldSyntaxSnapshot:true,controlledNotificationGap:true,realSnapshotIpc:true,
    productionInlineProviderHook:true,realInlineWithdrawal:true,realInlineRecovery:true,realInlineAcceptance:true,transactionLocalInline:true,noHeldInlineContextRequests:true,inlineExternalAiUsed:false,
    productionDiagnosticHook:true,diagnosticConfigurationProvenance:true,realMarkerWithdrawal:true,realMarkerRecovery:true,sameSqlDiagnostics:true,
    rejectedProgressiveConfiguration:true,sameIdentityGrantRevoked:true,localCompletionAfterRejection:true,validConfigurationRepair:true,rejectedConfigurationTokens:rejectedTokens.length};
}
