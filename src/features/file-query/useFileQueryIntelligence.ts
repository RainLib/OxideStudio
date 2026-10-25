import {useCallback,useEffect,useMemo,useRef,useSyncExternalStore} from "react";
import {useLspClient} from "@/hooks/useLspClient";
import {useLspDocumentLifecycle} from "@/features/query-editor/hooks/useLspDocumentLifecycle";
import {useLspCoreProviderCoordinator} from "@/features/query-editor/hooks/useLspCoreProviderCoordinator";
import {useLspHoverProviderCoordinator} from "@/features/query-editor/hooks/useLspHoverProviderCoordinator";
import {useEditorDiagnostics} from "@/features/query-editor/hooks/useEditorDiagnostics";
import {lspCompletionItemsToMonacoSuggestions} from "@/features/query-editor/model/lspCompletionPresentation";
import {captureLspDocumentRequest} from "@/features/query-editor/model/lspProviderContext";
import {rememberIncompleteCompletionInteraction} from "@/features/query-editor/model/completionContextRefresh";
import {attachCompletionContextRefresh} from "@/features/query-editor/model/completionContextRefresh";
import type {TabData} from "@/features/workspace-tabs/model/types";
import type {DiagnosticSnapshotRequest} from "@/services/lsp/client/diagnostics";
import {useTabStore} from "@/store/useTabStore";
import {useProjectStore} from "@/store/useProjectStore";
import {useSettingsStore} from "@/store/useSettingsStore";
import {createFileQueryAnalysisContext} from "./fileQueryAnalysisContext";
import {fileQueryConfiguration} from "./fileQueryConfiguration";
import type {FileQueryFormatResult} from "./model";
export {fileQuerySchema} from "./fileQueryConfiguration";
const noRoutine=()=>null;

export function useFileQueryIntelligence(tab:TabData,documentUri:string,monaco:typeof import("monaco-editor")|null,mountedEditor?:any){
  const tabId=tab.id,document=tab.fileQuery,session=document?.session;
  const runtime=useLspClient({documentSessionKey:session?"file-query:"+session.projectId+":"+session.id:undefined,
    driver:session?.driverId,capabilities:session?.capabilities,enabled:Boolean(session?.capabilities)});
  const process=useSyncExternalStore(runtime.client.subscribeRuntime,runtime.client.getRuntimeSnapshot,runtime.client.getRuntimeSnapshot);
  const completion=useSettingsStore(state=>state.settings.editor.sqlCompletion),format=useSettingsStore(state=>state.settings.editor.sqlFormatting);
  const language=runtime.profile?.documentLanguageId??"sql",dialect=runtime.profile?.serverDialect??"generic";
  const configuration=useMemo(()=>fileQueryConfiguration(tab,documentUri,dialect,completion,format),
    [tab.id,document?.session,document?.schema,document?.driverId,documentUri,dialect,completion,format]);
  const analysis=useMemo(()=>createFileQueryAnalysisContext({document,uri:documentUri,runtime:process,runtimeReady:runtime.isReady,dialect,config:configuration,
    readTab:()=>useTabStore.getState().tabs.find(value=>value.id===tabId),readProject:()=>useProjectStore.getState().activeProjectId,readRuntime:runtime.client.getRuntimeSnapshot,
    preferencesCurrent:()=>{const current=useSettingsStore.getState().settings.editor;return current.sqlCompletion===completion&&current.sqlFormatting===format;},
    subscribeLive:listener=>{const releases=[useTabStore.subscribe(listener),useProjectStore.subscribe(listener),useSettingsStore.subscribe(listener),runtime.client.subscribeRuntime(listener)];return ()=>{for(const release of releases)release();};},
    updateConfiguration:config=>runtime.client.updateConfiguration(config),confirmConfiguration:token=>runtime.client.confirmAnalysisConfiguration(token)}),
    [tab.id,document?.session,document?.schema,document?.source,document?.driverId,document?.packageVersion,document?.csvHeader,documentUri,process,runtime.client,runtime.isReady,dialect,configuration,completion,format]);
  const view=useSyncExternalStore(analysis.subscribe,analysis.getSnapshot,analysis.getSnapshot);
  useEffect(()=>{analysis.start();return analysis.dispose;},[analysis]);
  const ready=view.ready&&analysis.isReady(),documentReady=Boolean(analysis.read().syntaxAllowed);
  // Keep the completion owner across a file schema acknowledgement. Its live
  // reader revokes requests before React and retains the visible interaction.
  const analysisRef=useRef(analysis),completionRef=useRef(completion),completionObservers=useRef(new Set<()=>void>());
  analysisRef.current=analysis;completionRef.current=completion;
  const readCompletion=useCallback(()=>analysisRef.current.read(),[]);
  const subscribeCompletion=useCallback((listener:()=>void)=>{completionObservers.current.add(listener);return ()=>{completionObservers.current.delete(listener);};},[]);
  useEffect(()=>{const emit=()=>{for(const listener of completionObservers.current)listener();};const release=analysis.subscribe(emit);emit();return release;},[analysis]);
  const lifecycle=useLspDocumentLifecycle({activeTabId:tab.id,activeDocumentText:tab.sql,canUseLsp:documentReady,documentLanguageId:runtime.profile?.languageId??language,
    documentUri,lifecycleKey:process.generation,lspClient:runtime.client,lspReady:runtime.isReady&&process.ready,lspSessionKey:runtime.sessionKey,monaco,tabs:[tab]});
  const formatResultRef=useRef<FileQueryFormatResult|null>(null);
  const onDocumentFormatResult=useCallback((result:FileQueryFormatResult)=>{if(analysis.isReady())formatResultRef.current=result;},[analysis]);
  useEffect(()=>{formatResultRef.current=null;return analysis.subscribe(()=>{if(!analysis.isReady())formatResultRef.current=null;});},[analysis]);
  useLspCoreProviderCoordinator({activeProjectId:session?.projectId,canUseLsp:documentReady,documentUri,editorLanguageId:language,serverDialect:dialect,isActivePane:documentReady,lspClient:runtime.client,monaco,canFormat:analysis.isReady,
    editor:mountedEditor,syncDocument:lifecycle.syncDocument,onDocumentFormatResult,getSemanticContext:analysis.read,subscribeSemanticContext:analysis.subscribe,
    documentVersionsRef:lifecycle.documentVersionsRef,documentTextsRef:lifecycle.documentTextsRef});
  useLspHoverProviderCoordinator({activeProjectId:session?.projectId,canUseLsp:documentReady,documentUri,editorLanguageId:language,documentLanguageId:runtime.profile?.languageId??language,serverDialect:dialect,
    isActivePane:documentReady,lspClient:runtime.client,monaco,editor:mountedEditor,syncDocument:lifecycle.syncDocument,getSemanticContext:analysis.read,subscribeSemanticContext:analysis.subscribe,
    openedDocumentsRef:lifecycle.openedDocumentsRef,documentVersionsRef:lifecycle.documentVersionsRef,documentTextsRef:lifecycle.documentTextsRef,
    driver:session?.driverId??document?.driverId??"sqlite",schemaTables:[],showTableDdlHoverPreview:false,supportsTableBrowsing:false});
  const requestDiagnosticSnapshot=useCallback((request:DiagnosticSnapshotRequest)=>runtime.client.getDiagnosticSnapshot(request),[runtime.client]);
  useEditorDiagnostics({documentUri,diagnosticTabId:tab.id,diagnosticDialect:dialect,syntaxContextKey:runtime.sessionKey,requestDiagnosticSnapshot,
    monaco,lspReady:documentReady,lspSessionKey:runtime.sessionKey,documentVersionsRef:lifecycle.documentVersionsRef,documentTextsRef:lifecycle.documentTextsRef,
    getSemanticContext:analysis.read,subscribeSemanticContext:analysis.subscribe,mysqlRoutineAnalysisForModel:noRoutine,setLspDiagnostics:useTabStore.getState().setLspDiagnostics,
    mountedEditor,activeTab:tab,driver:session?.driverId??document?.driverId??"sqlite"});
  useEffect(()=>{
    if(!documentReady||!monaco)return;
    let disposed=false,generation=0;
    const refresh=mountedEditor?attachCompletionContextRefresh({editor:mountedEditor,read:readCompletion,subscribe:subscribeCompletion,allowDocumentOnly:true,invalidate:()=>{generation++;}}):undefined;
    const release=refresh?()=>refresh.dispose():subscribeCompletion(()=>{generation++;});
    const provider=monaco.languages.registerCompletionItemProvider(language,{triggerCharacters:["."," "],provideCompletionItems:async(model,position,_context,token)=>{
      const empty={suggestions:[]};if(model.uri.toString()!==documentUri)return empty;
      const sequence=++generation,request=captureLspDocumentRequest({read:readCompletion,model,token,isActive:()=>!disposed&&sequence===generation&&(!mountedEditor?.getModel||mountedEditor.getModel()===model)});
      if(!request.isCurrent())return empty;
      if(!request.metadataAllowed)rememberIncompleteCompletionInteraction(mountedEditor,model,position);
      try{
        await lifecycle.syncDocument(model);if(!request.isCurrent())return empty;
        const version=lifecycle.documentVersionsRef.current.get(documentUri),text=lifecycle.documentTextsRef.current.get(documentUri);
        if(version===undefined||text!==model.getValue())return empty;
        const preferences=completionRef.current;
        const result=request.lspAllowed?await runtime.client.getCompletionList(documentUri,position.lineNumber-1,position.column-1,undefined,token):await runtime.client.getDocumentCompletions({uri:documentUri,version,dialect,position:{line:position.lineNumber-1,character:position.column-1},preferences:{keywordCase:preferences.keywordCase,functionCase:preferences.functionCase,tableAlias:preferences.tableAlias}},token);
        if(!request.isCurrent())return empty;
        if(!result||lifecycle.documentVersionsRef.current.get(documentUri)!==version||lifecycle.documentTextsRef.current.get(documentUri)!==text)return empty;
        const word=model.getWordUntilPosition(position);
        return {incomplete:result.isIncomplete,suggestions:lspCompletionItemsToMonacoSuggestions({monaco,ownerKey:documentUri,items:result.items,typedWord:word.word,
          completedContextKeyword:false,defaultRange:new monaco.Range(position.lineNumber,word.startColumn,position.lineNumber,word.endColumn),rankByUsage:false,usageScope:documentUri,
          recordUsageCommand:"",driver:session?.driverId,requestUri:documentUri,requestModelVersion:model.getVersionId()}).map(item=>({...item,command:undefined}))};
      }catch(error){if(request.isCurrent())console.debug("[FileQuery] Completion unavailable",error);return empty;}
    }});
    return ()=>{disposed=true;generation++;release();provider.dispose();};
  },[documentReady,monaco,language,documentUri,runtime.client,session?.driverId,lifecycle.syncDocument,lifecycle.documentVersionsRef,lifecycle.documentTextsRef,readCompletion,subscribeCompletion,mountedEditor,dialect]);
  return {...runtime,error:view.error??runtime.error,ready,language,formatResultRef,isFormatReady:analysis.isReady,getSemanticContext:analysis.read};
}
