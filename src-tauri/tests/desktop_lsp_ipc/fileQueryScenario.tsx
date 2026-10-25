import type * as Monaco from "monaco-editor";
import "monaco-editor/esm/vs/editor/contrib/format/browser/formatActions.js";
import {createRoot} from "react-dom/client";
import {useFileQueryIntelligence} from "@/features/file-query/useFileQueryIntelligence";
import {useFileQueryCommands} from "@/features/file-query/useFileQueryCommands";
import {defaultDatabaseCapabilities} from "@/lib/databaseDialect";
import {APP_EVENT_FORMAT_SQL} from "@/lib/actionEvents";
import {useTabStore} from "@/store/useTabStore";
import {useProjectStore} from "@/store/useProjectStore";
import type {FileQuerySession} from "@/services/tauri/file-query.service";
import type {LspClient} from "@/services/lsp/client";
type Environment={monaco:typeof import("monaco-editor/esm/vs/editor/editor.api.js");editor:Monaco.editor.IStandaloneCodeEditor;
  check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};
export async function runFileQueryIntelligenceAcceptance(environment:Environment){
  const {monaco,editor,step}=environment,check:Environment["check"]=environment.check;
  const fixture=await (await fetch("/file-query-fixture.json")).json() as {columns:Array<{name:string;data_type:string}>;secondColumns:Array<{name:string;data_type:string}>;driverSha256:string};
  check(fixture.columns.some(value=>value.name==="revenue"&&value.data_type==="BIGINT"),"native DuckDB zero-row metadata supplies the actual first file field/type");
  check(fixture.secondColumns.some(value=>value.name==="revenue_new"),"a separate real CSV supplies the replacement metadata");
  const priorTabs=useTabStore.getState(),priorProject=useProjectStore.getState(),projectId="file-query-native";
  useProjectStore.setState({activeProjectId:projectId});
  const capabilities={...defaultDatabaseCapabilities("duckdb"),driver:"duckdb",supportsSqlQuery:true,supportsLsp:true,lspLanguageId:"duckdb"};
  const session:FileQuerySession={id:crypto.randomUUID(),projectId,fileName:"sales.csv",format:"csv",sourceBytes:38,driverId:"duckdb",packageVersion:"0.1.0",initialSql:"SELECT * FROM data",languageId:"duckdb",csvHeader:"auto",capabilities};
  const text="WITH base AS (SELECT d.* FROM data d), q AS (SELECT b.* FROM base b) SELECT q.reveSuffix FROM q";
  const id=useTabStore.getState().createTab("query","File query source proof",text,{fileQuery:{source:{kind:"picker",projectId},session,driverId:"duckdb",packageVersion:"0.1.0",csvHeader:"auto",schema:fixture.columns}});
  const uri="oxide-file-query://"+projectId+"/"+id+".sql",priorModel=editor.getModel(),model=monaco.editor.createModel(text,"sql",monaco.Uri.parse(uri));editor.setModel(model);
  const editorRef={current:editor},clients=new Set<LspClient>();let intelligence:ReturnType<typeof useFileQueryIntelligence>|undefined;
  function Probe(){
    const tab=useTabStore(state=>state.tabs.find(value=>value.id===id));if(!tab)return null;
    const current=useFileQueryIntelligence(tab,uri,monaco as unknown as typeof Monaco,editor);intelligence=current;clients.add(current.client);
    useFileQueryCommands({tab,editorRef,mountedEditor:editor,monaco:monaco as unknown as typeof Monaco,formatReady:current.ready,isFormatReady:current.isFormatReady,formatResultRef:current.formatResultRef});
    return null;
  }
  const container=document.createElement("div"),root=createRoot(container);document.body.appendChild(container);
  const change=editor.onDidChangeModelContent(()=>{if(editor.getModel()===model)useTabStore.getState().updateTabSql(id,model.getValue());});
  const wait=async(predicate:()=>boolean,message:string)=>{const end=Date.now()+15000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));check(predicate(),message+(predicate()?"":"; runtime="+JSON.stringify({ready:intelligence?.ready,status:intelligence?.status,error:intelligence?.error,source:intelligence?.getSemanticContext(),format:intelligence?.formatResultRef.current,tab:useTabStore.getState().tabs.find(value=>value.id===id)?.error})));};
  const widget=()=>editor.getDomNode()?.querySelector<HTMLElement>(".suggest-widget.visible");
  const suggest=()=>{editor.setPosition(model.getPositionAt(model.getValue().indexOf("reveSuffix")+4));editor.focus();editor.trigger("file-query.acceptance","editor.action.triggerSuggest",{});};
  try{
    await step("file-query-production-hook-real-driver-metadata-and-queued-document",async()=>{
      root.render(<Probe/>);await wait(()=>Boolean(intelligence?.ready),"production file hook acknowledges its scoped source configuration");
      if(model.getLanguageId()!==intelligence!.language)monaco.editor.setModelLanguage(model,intelligence!.language);
      suggest();await wait(()=>Boolean(widget()?.textContent?.includes("revenue")),"actual file widget resolves a physical field through two star CTE projections");
      const position=model.getPositionAt(text.indexOf("reveSuffix")+4),candidate=(await intelligence!.client.getCompletionList(uri,position.lineNumber-1,position.column-1)).items.find(item=>item.label==="revenue");
      const typed=candidate?await intelligence!.client.resolveCompletionItem(candidate):null;
      check(JSON.stringify(typed).toUpperCase().includes("BIGINT"),"the actual bundled LSP retains the DuckDB source BIGINT type in its resolved candidate");
      editor.trigger("file-query.acceptance","acceptSelectedSuggestion",{});await wait(()=>model.getValue().includes("SELECT q.revenue FROM q"),"actual file completion consumes the whole identifier suffix");
      check(!model.getValue().includes("Suffix"),"file completion does not leave an old word suffix");
      const formatSource="select '漢😀' as label,9007199254740993 as amount from data";model.setValue(formatSource);editor.focus();
      check(Boolean(editor.getAction("editor.action.formatDocument")),"actual Monaco formatting contribution is installed");
      window.dispatchEvent(new Event(APP_EVENT_FORMAT_SQL));await wait(()=>Boolean(intelligence?.formatResultRef.current?.ok)&&model.getValue()!==formatSource,"the production file command applies actual scoped formatting edits to the Monaco model");
      check(model.getValue().includes("漢😀")&&model.getValue().includes("9007199254740993"),"actual formatting preserves Unicode and high-precision integer text");
    });
    await step("file-query-reopen-withdraws-old-widget-with-unchanged-sql",async()=>{
      model.setValue(text);suggest();await wait(()=>Boolean(widget()?.textContent?.includes("revenue")),"the old file source is visible before reopen");
      const before=model.getVersionId(),client=intelligence!.client;
      const nextSession={...session,id:crypto.randomUUID(),fileName:"sales-next.csv"};
      useTabStore.setState(state=>({tabs:state.tabs.map(tab=>tab.id===id?{...tab,fileQuery:{...tab.fileQuery!,session:nextSession,schema:fixture.secondColumns}}:tab)}));
      await wait(()=>!widget(),"live file/session identity withdraws the old visible list before replacement readiness");
      await wait(()=>Boolean(intelligence?.ready&&intelligence.client!==client),"the replacement snapshot gets an isolated ready LSP session");
      check(model.getVersionId()===before&&model.getValue()===text,"reopening a file does not edit SQL or its model version");
      suggest();await wait(()=>Boolean(widget()?.textContent?.includes("revenue_new")),"the real widget uses the separate replacement CSV metadata");
      check(!/\brevenue\b/u.test(widget()?.textContent||""),"the old file field is absent from the replacement widget");
      editor.trigger("file-query.acceptance","acceptSelectedSuggestion",{});await wait(()=>model.getValue().includes("SELECT q.revenue_new FROM q"),"actual replacement-source completion accepts the new field and consumes the suffix");
    });
    await step("file-query-real-diagnostics-use-explicit-tab-and-withdraw-on-close",async()=>{
      model.setValue("WITH q AS (SELECT d.* FROM data d) SELECT revenue_new FROM q a JOIN data b ON 1=1;");
      const markers=()=>monaco.editor.getModelMarkers({owner:"sql-lsp",resource:model.uri}).filter(value=>value.code==="OXIDE004");
      await wait(()=>markers().length===1,"actual file metadata ambiguity is displayed by the production diagnostic hook");
      check((useTabStore.getState().tabs.find(tab=>tab.id===id)?.lspDiagnostics||[]).some(value=>value.code==="OXIDE004"),"the file URI's explicit tab receives the real problem entry");
      const version=model.getVersionId(),sql=model.getValue();
      useTabStore.setState(state=>({tabs:state.tabs.map(tab=>tab.id===id?{...tab,fileQuery:{...tab.fileQuery!,session:null}}:tab)}));
      await wait(()=>markers().length===0&&!intelligence?.ready,"closing the renderer snapshot withdraws actual markers and its metadata grant");
      check((useTabStore.getState().tabs.find(tab=>tab.id===id)?.lspDiagnostics||[]).length===0,"closing the renderer snapshot also clears the problems list");
      check(model.getVersionId()===version&&model.getValue()===sql,"file-session invalidation preserves saved SQL");
    });
  }finally{
    change.dispose();root.unmount();container.remove();editor.trigger("file-query.acceptance","hideSuggestWidget",{});editor.setModel(priorModel);model.dispose();
    for(const client of clients)if(client.isInitialized())await client.shutdown();
    useTabStore.setState(priorTabs);useProjectStore.setState(priorProject);
  }
  return {productionFileIntelligenceHook:true,productionFileCommands:true,realDriverMetadata:true,realHostFileSession:false,
    rendererMetadataFixture:true,realWidget:true,reopenIsolation:true,actualSuffixAcceptance:true,realFormatting:true,realDiagnostics:true,explicitTabProblems:true,sourceCloseWithdrawal:true,driverSha256:fixture.driverSha256};
}
