import type * as Monaco from "monaco-editor";
import {createRoot} from "react-dom/client";
import {LspClient} from "@/services/lsp/client/LspClient";
import {getLspProjectDocumentUri} from "@/services/lsp/document";
import {createProjectDocumentSync} from "@/features/lsp-sync/runtime/createProjectDocumentSync";
import {useLspDocumentLifecycle} from "@/features/query-editor/hooks/useLspDocumentLifecycle";
import {createQueryCompletionProvider} from "@/features/query-editor/model/createQueryCompletionProvider";
import {registerLspCompletionProvider} from "@/features/query-editor/hooks/useLspCompletionProviderCoordinator";
import {createCachedSqlCompletionRequest} from "@/features/query-editor/model/cachedSqlCompletion";
import {useEditorDiagnostics} from "@/features/query-editor/hooks/useEditorDiagnostics";
import {useTabStore} from "@/store/useTabStore";
import {DEFAULT_APP_SETTINGS} from "@/lib/appSettings";
import {defaultDatabaseCapabilities} from "@/lib/databaseDialect";
import type {CompletionContextState} from "@/services/lsp/semanticContext";

type Environment={monaco:typeof import("monaco-editor/esm/vs/editor/editor.api.js");editor:Monaco.editor.IStandaloneCodeEditor;binaryPath:string;
  check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};

export async function runSharedDocumentAcceptance(environment:Environment){
  const {monaco,editor,binaryPath,step}=environment,check:Environment["check"]=environment.check;
  const client=new LspClient("shared-project-editor-native"),index=createProjectDocumentSync(),projectId="native-shared-project";
  const uri=getLspProjectDocumentUri(projectId,"shared.sql"),language="oxide-shared-document-native";
  monaco.languages.register({id:language});
  const source=(field:string)=>`WITH base AS (SELECT 42 AS ${field}), q AS (SELECT b.* FROM base b) SELECT q.${field} FROM q`;
  const unsaved=source("unsaved_value").replace("q.unsaved_value FROM q","q.unsSuffix FROM q"),disk=source("disk_value");
  const previous=editor.getModel(),model=monaco.editor.createModel(unsaved,language,monaco.Uri.parse(uri));editor.setModel(model);
  const host=document.createElement("div"),pane=document.createElement("div");pane.style.cssText="width:480px;height:180px";document.body.append(host,pane);
  let sibling:Monaco.editor.IStandaloneCodeEditor|undefined=monaco.editor.create(pane,{model,quickSuggestions:false,suggestOnTriggerCharacters:false});
  const root=createRoot(host),controllers=new Map<string,ReturnType<typeof useLspDocumentLifecycle>>();
  const priorTabs=useTabStore.getState();useTabStore.setState({tabs:[...priorTabs.tabs,...["shared-left","shared-right"].map(id=>({id,type:"query",sql:unsaved} as any))],activeTabId:"shared-right"});
  const setDiagnostics=useTabStore.getState().setLspDiagnostics,noRoutine=()=>null;
  const problems=(id:string)=>useTabStore.getState().tabs.find(tab=>tab.id===id)?.lspDiagnostics??[];
  const requestSnapshot=(request:Parameters<LspClient["getDiagnosticSnapshot"]>[0])=>client.getDiagnosticSnapshot(request);
  const trace:Array<{method:string;version?:number;text?:string}>=[],wireCompletions:string[][]=[];
  const original={open:client.didOpen,change:client.didChange,close:client.didClose,completion:client.getCompletionList};
  client.didOpen=async(...args)=>{await original.open.apply(client,args);trace.push({method:"open",version:args[2],text:args[1]});};
  client.didChange=async(...args)=>{await original.change.apply(client,args);trace.push({method:"change",version:args[2],text:args[1]});};
  client.didClose=async(...args)=>{await original.close.apply(client,args);trace.push({method:"close"});};
  client.getCompletionList=async(...args)=>{const result=await original.completion.apply(client,args);wireCompletions.push(result.items.map(item=>item.label));return result;};
  const wait=async(test:()=>boolean,message:string)=>{const end=Date.now()+10000;while(!test()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));check(test(),message);};
  function Probe({id}:{id:string}){
    const tabId="shared-"+id;
    const lifecycle=useLspDocumentLifecycle({activeTabId:tabId,activeDocumentText:unsaved,canUseLsp:true,documentLanguageId:"postgres",documentUri:uri,
      lifecycleKey:"ready",lspClient:client,lspReady:true,lspSessionKey:client.getSessionKey(),monaco,tabs:[{id:"shared-left",type:"query"},{id:"shared-right",type:"query"}]});
    controllers.set(id,lifecycle);
    useEditorDiagnostics({monaco:monaco as unknown as typeof import("monaco-editor"),lspReady:true,lspSessionKey:client.getSessionKey(),documentUri:uri,diagnosticTabId:tabId,diagnosticDialect:"postgres",syntaxContextKey:uri,
      requestDiagnosticSnapshot:requestSnapshot,getSemanticContext:readContext,subscribeSemanticContext:subscribeContext,documentVersionsRef:lifecycle.documentVersionsRef,documentTextsRef:lifecycle.documentTextsRef,
      mysqlRoutineAnalysisForModel:noRoutine,setLspDiagnostics:setDiagnostics,mountedEditor:id==="left"?sibling:editor,activeTab:undefined,driver:"postgres"});
    return null;
  }
  const snapshot=()=>index.synchronize({activeProjectId:projectId,lspClient:client,languageId:"postgres",documents:[{relativePath:"shared.sql",content:disk}]});
  const settings={...DEFAULT_APP_SETTINGS.editor,sqlCompletion:{...DEFAULT_APP_SETTINGS.editor.sqlCompletion,rankByUsage:false,appendSpace:false,snippets:[]}};
  const analysisToken=crypto.randomUUID();let state:CompletionContextState={connection:{},runtime:{},execution:{},metadataVersion:0,projectId,route:uri,generation:{},available:true,lspAllowed:true,metadataAllowed:true,syntaxAllowed:true,analysisToken};
  const contextListeners=new Set<()=>void>(),readContext=()=>state,subscribeContext=(listener:()=>void)=>{contextListeners.add(listener);return ()=>{contextListeners.delete(listener);};};
  let registration:ReturnType<typeof registerLspCompletionProvider>|undefined;
  const caches={fields:new Map(),joinConstraints:new Map()};
  const installCompletion=()=>{
    const lifecycle=controllers.get("right")!;
    const provider=createQueryCompletionProvider({getCompletionContext:()=>state,monaco,completionTriggerOriginRef:{current:null},documentUri:uri,effectiveConnectionId:"fixture",isCurrentLspModelUri:value=>value===uri,
      activeTab:undefined,currentSchema:null,activeConnection:undefined,metadataVersion:0,editorSettings:settings,usageScope:"shared-native",completionRequestGenerationRef:lifecycle.completionRequestGenerationRef,
      createCachedSqlCompletionRequest:request=>createCachedSqlCompletionRequest({activeProjectId:projectId,connectionId:"fixture",driver:"postgres",metadataRevision:0,databaseName:"app",currentSchema:null,schemaTables:[],sqlCompletion:settings.sqlCompletion,sqlFormatting:DEFAULT_APP_SETTINGS.editor.sqlFormatting},caches,request),
      capabilities:defaultDatabaseCapabilities("postgres"),rankByUsage:false,completionOwnerKey:uri,driver:"postgres",batchColumnSessionsRef:{current:new Map()},preferredElasticsearchIndex:undefined,
      lspReady:true,documentLanguageId:"postgres",lspClient:client,openedDocumentsRef:lifecycle.openedDocumentsRef,documentVersionsRef:lifecycle.documentVersionsRef,documentTextsRef:lifecycle.documentTextsRef,mountedEditor:editor});
    // Deliberately use the production provider's legacy synchronization branch:
    // its shadow-map binding must join the owned FIFO instead of raw didOpen.
    const runtime={...provider,ownerKey:uri,usageScope:"shared-native",rankByUsage:false,recordUsage:()=>{},triggerChainedCompletion:()=>{}};
    registration=registerLspCompletionProvider({monaco,editorLanguageId:language,getRuntime:()=>runtime,triggerCharacters:["."],usageCommandId:"oxide.sharedNative.usage"});
  };
  let accepted=0,markerCount=0;
  const acceptWidget=async()=>{
    model.setValue(unsaved);const point=model.getPositionAt(unsaved.indexOf("unsSuffix")+3);editor.setPosition(point);editor.focus();
    const before=wireCompletions.length;editor.trigger("shared-native","editor.action.triggerSuggest",{});
    await wait(()=>Boolean(editor.getDomNode()?.querySelector(".suggest-widget.visible")?.textContent?.includes("unsaved_value")),"shared document shows its unsaved CTE output in the actual widget");
    check(wireCompletions.slice(before).some(labels=>labels.includes("unsaved_value")&&!labels.includes("disk_value")),"actual LSP completion uses unsaved text rather than the project snapshot");
    editor.trigger("shared-native","acceptSelectedSuggestion",{});await wait(()=>model.getValue()===source("unsaved_value"),"shared actual widget consumes the complete identifier suffix");
    await controllers.get("right")!.syncDocument(model);accepted++;
  };
  const actualMarkers=async()=>{
    model.setValue("SELECT '漢😀';\nSELECT (1 + );");const lifecycle=controllers.get("right")!;await lifecycle.syncDocument(model);
    await wait(()=>monaco.editor.getModelMarkers({owner:"sql-lsp",resource:model.uri}).some(value=>value.code==="SYNTAX_ERROR"),"production diagnostic hooks render the actual shipping LSP parser diagnostic");
    markerCount=monaco.editor.getModelMarkers({owner:"sql-lsp",resource:model.uri}).length;
    const active=contextListeners.size===2?["shared-left","shared-right"]:["shared-right"];
    check(active.every(id=>problems(id).some(value=>value.code==="SYNTAX_ERROR")),"each active tab's actual Problems store receives the production diagnostic publication");
  };
  try{
    await client.initialize(binaryPath);await client.updateConfiguration({oxideAnalysisToken:analysisToken,defaultDialect:"postgres",schemas:[],fileSchemas:{},fileDialects:{[uri]:"postgres"}});
    check(await client.confirmAnalysisConfiguration(analysisToken),"shared document session confirms its actual server configuration");
    await step("shared-project-two-editors-one-wire-and-unsaved-cte-widget",async()=>{
      await snapshot();root.render(<><Probe key="left" id="left"/><Probe key="right" id="right"/></>);
      await wait(()=>["left","right"].every(id=>controllers.get(id)?.openedDocumentsRef.current.has(uri)),"both production lifecycle hooks acknowledge the shared URI");
      check(trace.filter(value=>value.method==="open").length===1,"index and two editors send exactly one wire didOpen");
      check(trace[trace.length-1]?.text===unsaved,"the unsaved editor buffer supersedes the disk snapshot");
      check(controllers.get("left")!.documentVersionsRef.current.get(uri)===controllers.get("right")!.documentVersionsRef.current.get(uri),"both editor shadows use one acknowledged wire version");
      installCompletion();await acceptWidget();
    });
    await step("shared-diagnostic-context-withdrawal-before-sibling-callback",async()=>{
      await actualMarkers();const text=model.getValue(),version=model.getVersionId();
      state={...state,generation:{},lspAllowed:false,metadataAllowed:false,syntaxAllowed:false,analysisToken:undefined};
      const listeners=[...contextListeners];check(listeners.length===2,"both production diagnostic hooks have independent live context callbacks");listeners[0]!();
      check(monaco.editor.getModelMarkers({owner:"sql-lsp",resource:model.uri}).length===0,"first context callback withdraws every stale peer diagnostic before its callback runs");
      check(["shared-left","shared-right"].every(id=>problems(id).length===0),"first context callback withdraws both distinct tabs' actual Problems entries");
      for(const listener of listeners.slice(1))listener();
      state={...state,generation:{},lspAllowed:true,metadataAllowed:true,syntaxAllowed:true,analysisToken};for(const listener of contextListeners)listener();
      await wait(()=>monaco.editor.getModelMarkers({owner:"sql-lsp",resource:model.uri}).some(value=>value.code==="SYNTAX_ERROR"),"shared hook recovers the still-valid server diagnostic after the renderer grant returns");
      check(model.getValue()===text&&model.getVersionId()===version,"controlled diagnostic withdrawal and recovery do not edit SQL");
    });
    await step("shared-sibling-disposal-preserves-wire-and-server-markers",async()=>{
      await actualMarkers();sibling!.focus();await wait(()=>Boolean(sibling?.hasTextFocus()),"the retiring real editor owns focus before disposal");root.render(<Probe key="right" id="right"/>);await new Promise(resolve=>setTimeout(resolve,100));sibling!.dispose();sibling=undefined;
      check(!trace.some(value=>value.method==="close"),"unmounting one editor does not close the index and sibling's document");
      check(monaco.editor.getModelMarkers({owner:"sql-lsp",resource:model.uri}).length===markerCount,"lifecycle sibling disposal preserves the surviving model's real server markers");
      check(problems("shared-right").some(value=>value.code==="SYNTAX_ERROR"),"sibling diagnostic hook disposal preserves the actual Problems entry");
      await acceptWidget();
    });
    await step("shared-index-refresh-and-close-preserve-editor-completion",async()=>{
      const before=trace.length;await snapshot();check(trace.length===before,"index refresh does not overwrite the unsaved editor buffer");
      await index.closeAll();check(!trace.some(value=>value.method==="close"),"index disposal does not close a live editor document");await acceptWidget();
    });
    await step("shared-editor-to-index-handoff-and-final-close",async()=>{
      await snapshot();await actualMarkers();registration!.dispose();registration=undefined;root.render(null);
      await wait(()=>trace[trace.length-1]?.text===disk,"last editor release restores the latest retained index snapshot");
      check(monaco.editor.getModelMarkers({owner:"sql-lsp",resource:model.uri}).length===0,"final diagnostic publisher clears its model layer while the index retains the document");
      check(problems("shared-right").length===0,"final diagnostic publisher clears the actual Problems entry");
      check(!trace.some(value=>value.method==="close"),"handoff changes the document without closing the retained index");
      const offset=disk.lastIndexOf("q.disk_value")+5,point={lineNumber:disk.slice(0,offset).split("\n").length,column:offset-disk.lastIndexOf("\n",offset-1)};
      const fields=await client.getCompletionList(uri,point.lineNumber-1,point.column-1);
      check(fields.items.some(item=>item.label==="disk_value")&&!fields.items.some(item=>item.label==="unsaved_value"),"actual LSP now reads the retained disk CTE rather than the released editor");
      await index.closeAll();check(trace.filter(value=>value.method==="close").length===1,"only the final index owner sends didClose");
      check(monaco.editor.getModelMarkers({owner:"sql-lsp",resource:model.uri}).length===0,"final index close keeps retired diagnostic layers empty");
      const versions=trace.filter(value=>value.version!==undefined).map(value=>value.version!);check(versions.every((version,i)=>version===i+1),"all shared wire revisions are contiguous and monotonic");
    });
    return {productionLifecycleHooks:true,productionProjectSync:true,productionCompletionProvider:true,legacySyncUsesOwnedQueue:true,realHostLsp:true,twoRealEditors:true,oneWireOpen:true,unsavedPrecedence:true,siblingDisposal:true,indexDisposal:true,indexHandoff:true,finalClose:true,realWidgetAcceptances:accepted,actualServerMarkers:true,fullDiagnosticHookTested:true,actualProblemsStore:true,actualDistinctTabProblems:true,firstContextCallbackWithdrawal:true,rendererContextFixture:true,trace};
  } finally {
    registration?.dispose();root.unmount();await index.closeAll();await new Promise(resolve=>setTimeout(resolve,20));
    if(client.isInitialized())await client.shutdown();sibling?.dispose();editor.setModel(previous);model.dispose();host.remove();pane.remove();useTabStore.setState(priorTabs);
  }
}
