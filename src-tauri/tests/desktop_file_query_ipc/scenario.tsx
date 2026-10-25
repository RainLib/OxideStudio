import {Component,createElement,type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import {loader} from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/editor/contrib/snippet/browser/snippetController2.js";
import "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/esm/vs/editor/contrib/format/browser/formatActions.js";
import {invoke} from "@tauri-apps/api/core";
import {FileQueryEditor} from "@/features/file-query/FileQueryEditor";
import {FileQueryOpenDialog} from "@/features/file-query/FileQueryOpenDialog";
import {useFileQueryStore} from "@/features/file-query/store";
import {fileQueryService,type FileQuerySession} from "@/services/tauri/file-query.service";
import {ProjectFilesSidebarView} from "@/features/projects/ui/ProjectFilesSidebarView";
import {useProjectFilesSidebarController} from "@/features/projects/hooks/useProjectFilesSidebarController";
import {DataGrid} from "@/components/workspace/DataGrid";
import {useProjectStore} from "@/store/useProjectStore";
import {useTabStore} from "@/store/useTabStore";
import {useSettingsStore} from "@/store/useSettingsStore";
import {ThemeProvider} from "@/theme/ThemeProvider";
import {TooltipProvider} from "@/components/ui/tooltip";
import {getLspSessionDescriptor,shutdownAllLspSessions} from "@/services/lsp/sessionRegistry";
import {createOpenFileQueryAction} from "@/lib/workbench-actions/files";
import {AppPreferencesProvider} from "@/i18n";
import {runFileSemanticAcceptance} from "./semanticScenario";

let assertions=0;const receipts:Array<{name:string;milliseconds:number}>=[];
function check(value:unknown,message:string):asserts value{assertions++;if(!value)throw new Error(message);}
const wait=async(test:()=>boolean,message:string)=>{const end=Date.now()+20000;while(!test()&&Date.now()<end)await new Promise(done=>setTimeout(done,25));check(test(),message+(test()?"":"; state="+JSON.stringify({status:Array.from(document.querySelectorAll('[data-file-query-editor] [role="status"]')).map(node=>node.outerHTML),query:tab()?.error,dialog:useFileQueryStore.getState().error})));};
class Boundary extends Component<{children:ReactNode},{error:string|null}>{state={error:null as string|null};static getDerivedStateFromError(error:Error){return {error:error.stack??error.message};}componentDidCatch(error:Error){void invoke("acceptance_finish",{report:{success:false,error:error.stack??error.message,assertions,receipts}});}render(){return this.state.error?createElement("pre",null,this.state.error):this.props.children;}}
function Sidebar(){return <ProjectFilesSidebarView {...useProjectFilesSidebarController()}/>;}
function Workspace(){const tab=useTabStore(state=>state.tabs.find(value=>value.id===state.activeTabId));return <div style={{display:"grid",gridTemplateColumns:"240px 1fr",height:760}}><aside><Sidebar/></aside><main style={{display:"grid",gridTemplateRows:"440px 300px",minWidth:0}}>{tab?.fileQuery?<FileQueryEditor key={tab.id} tab={tab}/>:<div/>}<div data-file-query-grid>{tab?.fileQuery&&<DataGrid readOnly/>}</div></main><FileQueryOpenDialog/></div>;}
const tab=()=>useTabStore.getState().tabs.find(value=>value.id===useTabStore.getState().activeTabId);
const editor=()=>monaco.editor.getEditors().find(value=>value.getModel()?.uri.toString().startsWith("oxide-file-query://"));
const button=(label:string,root:ParentNode=document)=>Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(value=>value.textContent?.trim()===label);
async function openNode(name:string){
  const node=document.querySelector<HTMLButtonElement>(`button[title="${name}"]`);check(node,"real project file node rendered: "+name);
  if(name.endsWith(".csv")||name.endsWith(".parquet"))node.click();else{
    const action=document.querySelector<HTMLButtonElement>(`button[title="Actions for ${name}"]`);check(action,"actual row actions exist");action.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,pointerType:"mouse"}));
    await wait(()=>Boolean(Array.from(document.querySelectorAll('[role="menuitem"]')).find(item=>item.textContent?.includes("Query data file"))),"actual file query menu item opens");
    (Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item=>item.textContent?.includes("Query data file"))!).click();
  }
  await wait(()=>Boolean(useFileQueryStore.getState().provider&&!useFileQueryStore.getState().loading),"signed ready provider is discovered through Tauri");
  check(useFileQueryStore.getState().provider==="duckdb@0.1.0","production signed installation selection");await wait(()=>Boolean(button("Open query")&&!button("Open query")!.disabled),"actual open-query button is enabled");button("Open query")!.click();
  await wait(()=>Boolean(tab()?.fileQuery?.session&&!tab()?.isExecuting&&tab()?.results?.length),"production file store opens and queries a real Host session");
  const current=tab()!;check(!current.error,"file query has no hidden backend error: "+current.error);check(current.fileQuery?.session?.fileName===name,"Host file identity reaches the editor");
  check(current.fileQuery?.schema?.map(value=>value.name).join(",")==="id,label","LIMIT 0 actual source columns reach editor intelligence");
  check(current.results?.[0]?.rows.length===2,"actual query result contains both source rows");check(String(current.results?.[0]?.rows[0]?.[0])==="9007199254740993","precise integer is preserved through signed Host and Tauri");
  await wait(()=>Boolean(editor()&&document.querySelector('[data-file-query-grid] canvas')),"production Monaco and read-only grid are mounted");
  return current.fileQuery!.session!;
}
async function closeCurrent(session:FileQuerySession){const id=tab()!.id;useTabStore.getState().closeTab(id);await wait(()=>!useTabStore.getState().tabs.some(value=>value.id===id),"production tab closes");await waitAsync(async()=>await fileQueryService.status(session)===null,"closed tab releases its actual Host session");}
async function waitAsync(test:()=>Promise<boolean>,message:string){const end=Date.now()+10000;while(Date.now()<end){if(await test()){check(true,message);return;}await new Promise(done=>setTimeout(done,25));}check(false,message);}
async function run(){
  monaco.languages.register({id:"sql"});loader.config({monaco});await loader.init();const fixture=await fetch("/fixture.json").then(response=>response.json());const projects=await invoke<any[]>("get_projects");check(projects.some(value=>value.id===fixture.project.id&&value.root_path===fixture.project.root_path),"real metadata store contains isolated project root");
  useProjectStore.setState({projects,activeProjectId:fixture.project.id,activeProjectName:fixture.project.name,isLoading:false});useTabStore.setState({tabs:[],activeTabId:""});const settings=useSettingsStore.getState().settings;useSettingsStore.setState({settings:{...settings,appearance:{...settings.appearance,locale:"en-US"}}});
  const app=createRoot(document.getElementById("root")!);app.render(<Boundary><AppPreferencesProvider><ThemeProvider><TooltipProvider><Workspace/></TooltipProvider></ThemeProvider></AppPreferencesProvider></Boundary>);let failure:unknown,semantics:Awaited<ReturnType<typeof runFileSemanticAcceptance>>|undefined;
  const step=async(name:string,action:()=>Promise<void>)=>{await invoke("acceptance_progress",{name});const started=performance.now();await action();receipts.push({name,milliseconds:performance.now()-started});};
  try{
    await wait(()=>Boolean(document.querySelector('button[title="sales-雪.csv"]')),"production sidebar enumerates the actual project directory");
    await step("signed-host-csv-sidebar-editor-and-readonly-grid",async()=>{
      const session=await openNode("sales-雪.csv");await wait(()=>Boolean(document.querySelector('[aria-label="SQL intelligence ready"]')),"actual file editor confirms its isolated LSP configuration");
      const active=editor()!;const model=active.getModel()!;model.setValue("WITH q AS (SELECT d.* FROM data d) SELECT q.laSuffix FROM q");active.setPosition(model.getPositionAt(model.getValue().indexOf("laSuffix")+2));active.focus();active.trigger("file-host.acceptance","editor.action.triggerSuggest",{});
      await wait(()=>Boolean(document.querySelector(".suggest-widget.visible"))&&document.querySelector(".suggest-widget.visible")!.textContent!.includes("label"),"actual suggestion widget uses real file columns through the LSP");active.trigger("file-host.acceptance","acceptSelectedSuggestion",{});
      await wait(()=>model.getValue().includes("SELECT q.label FROM q")&&!model.getValue().includes("Suffix"),"real suggestion acceptance replaces the member suffix");
      await wait(()=>tab()?.sql===model.getValue(),"production editor updates authoritative query SQL");const runButton=button("Run",document.querySelector("[data-file-query-editor]")!);check(runButton&&!runButton.disabled,"real file editor Run button is available");runButton.click();
      await wait(()=>Boolean(!tab()?.isExecuting&&tab()?.results?.[0]?.columns[0]?.name==="label"),"real Run action executes the accepted CTE query on the same signed Host");check(tab()?.results?.[0]?.rows[0]?.[0]==="雪","accepted query returns the actual Unicode file value");
      model.setValue("select label from data where id > 0");await active.getAction("editor.action.formatDocument")!.run();check(model.getValue().includes("SELECT")&&model.getValue().includes("label"),"actual format action uses the production file editor provider");
      // One explicit transport fault; the SQL error, Host, snapshot and retry
      // still use production commands and the actual signed DuckDB process.
      const status=fileQueryService.status;let injected=0;
      fileQueryService.status=candidate=>candidate.id===session.id&&injected===0?(injected++,Promise.reject(new Error("controlled one-shot status IPC failure"))):status(candidate);
      try{model.setValue("SELECT missing_acceptance_column FROM data");await wait(()=>tab()?.sql===model.getValue(),"invalid SQL reaches the production editor state");button("Run",document.querySelector("[data-file-query-editor]")!)!.click();
        await wait(()=>Boolean(!tab()?.isExecuting&&tab()?.error),"actual signed Host reports the invalid SQL");check(injected===1,"exactly one status transport failure was injected");check(tab()?.fileQuery?.session?.id===session.id,"unknown status preserves the actual snapshot after a query error");check(Boolean(await status(session)),"production Host confirms the retained snapshot is still alive");
      }finally{fileQueryService.status=status;}
      model.setValue("SELECT label FROM data");await wait(()=>tab()?.sql===model.getValue(),"corrected SQL reaches the same query tab");button("Run",document.querySelector("[data-file-query-editor]")!)!.click();
      await wait(()=>Boolean(!tab()?.isExecuting&&!tab()?.error&&tab()?.resultSql==="SELECT label FROM data"),"the actual Run action recovers on the same Host snapshot");check(tab()?.results?.[0]?.rows[0]?.[0]==="雪","retry returns the actual original file value");
      const runtime=getLspSessionDescriptor({documentSessionKey:"file-query:"+session.projectId+":"+session.id,driver:session.driverId,capabilities:session.capabilities});check(runtime?.client.isInitialized(),"file session has a real isolated LSP client");
      const bits=await fileQueryService.query(session,"SELECT ('0'::BIT = CAST('0' AS BIT)) AS zero_ok, ('1'::BIT = CAST('1' AS BIT)) AS one_ok");
      check(bits[0]?.rows[0]?.length===2&&bits[0].rows[0]!.every(value=>value===true),"actual signed DuckDB driver accepts both recommended explicit BIT literals");
      const predicates=await fileQueryService.query(session,"SELECT TRUE IS TRUE AS truth, NULL IS UNKNOWN AS unknown_ok, NULL IS NOT DISTINCT FROM NULL AS null_safe");
      check(predicates[0]?.rows[0]?.length===3&&predicates[0].rows[0]!.every(value=>value===true),"actual signed DuckDB validates truth, unknown and null-safe predicates offered by its profile");
      const expressions=await fileQueryService.query(session,"SELECT CAST(1 AS INTEGER) IS NOT NULL AS cast_ok, CASE WHEN TRUE THEN 1 ELSE 2 END = 1 AS case_ok, COALESCE(NULL,1) = 1 AS coalesce_ok");
      check(expressions[0]?.rows[0]?.length===3&&expressions[0].rows[0]!.every(value=>value===true),"actual signed DuckDB executes the CAST, CASE and COALESCE expression corpus");
      await closeCurrent(session);
    });
    await step("real-file-hover-and-local-semantics-during-confirmation",async()=>{const session=await openNode("sales-雪.csv");semantics=await runFileSemanticAcceptance({session,editor:editor()!,check,wait});await closeCurrent(session);});
    for(const name of ["sales.json","sales.jsonl","sales.parquet"])await step("signed-host-sidebar-"+name,async()=>{const session=await openNode(name);check(session.format===name.split(".").pop(),"signed format grant and descriptor agree");await closeCurrent(session);});
    await step("project-reopen-and-independent-open-file-action",async()=>{
      const session=await openNode("sales-雪.csv"),current=tab()!,oldId=session.id;const reopen=document.querySelector<HTMLButtonElement>('[data-file-query-editor] button[aria-label="Reopen file snapshot"]');check(reopen,"actual reopen button is rendered");reopen.click();await wait(()=>Boolean(useFileQueryStore.getState().provider&&!useFileQueryStore.getState().loading),"reopen rediscovers the signed package");button("Open query")!.click();
      await wait(()=>Boolean(tab()?.fileQuery?.session?.id&&tab()!.fileQuery!.session!.id!==oldId&&!tab()?.isExecuting),"reopen creates a new actual Host session");check(tab()?.id===current.id,"reopen retains the query tab");check(await fileQueryService.status(session)===null,"reopen closes the previous Host session");await closeCurrent(tab()!.fileQuery!.session!);
      await createOpenFileQueryAction().run();await wait(()=>useFileQueryStore.getState().source?.kind==="picker"&&!useFileQueryStore.getState().loading,"independent production Open File action opens its real provider dialog");check(Boolean(button("Choose file…")),"native-picker entry is offered by the production dialog");useFileQueryStore.getState().cancel();
    });
  }catch(error){failure=error;}finally{useFileQueryStore.getState().cancel();for(const value of useTabStore.getState().tabs){if(value.fileQuery?.session)await fileQueryService.close(value.fileQuery.session).catch(()=>undefined);}app.unmount();await shutdownAllLspSessions();}
  await invoke("acceptance_finish",{report:{success:failure===undefined,error:failure instanceof Error?failure.stack:String(failure??""),assertions,receipts,semantics,realTauriCommands:true,realSignedHost:true,productionSidebar:true,productionOpenDialog:true,productionEditorAndGrid:true,realFileMetadata:true,realMonacoAcceptance:true,realReopen:true,formats:4,independentOpenFileDialog:true,controlledStatusFaults:1,realSqlErrorAndRetry:true,nativePickerSelectionTested:false,installedPackageTested:false}});
}
void run().catch(error=>void invoke("acceptance_finish",{report:{success:false,error:error instanceof Error?error.stack:String(error),assertions,receipts}}));
