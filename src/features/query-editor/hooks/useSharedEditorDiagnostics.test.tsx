/** @vitest-environment happy-dom */
import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,expect,it,vi} from "vitest";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import {useEditorDiagnostics} from "./useEditorDiagnostics";
import {analyzeMysqlRoutineSyntax} from "../model/mysqlRoutineSyntaxDiagnostics";
import {commitLspDocumentShadow} from "../model/lspDocumentSync";

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();vi.useRealTimers();});
async function fixture(options:{driver?:"postgres"|"oracle"|"mysql";text?:string;queryError?:boolean;syntax?:boolean;independentTabs?:boolean}={}){
  const uri=options.independentTabs?"oxide://project/p/shared.sql":"oxide://query/shared.postgres.sql";let text=options.text??"SELECT shared FROM a JOIN b ON true",version=42,focused="";
  const context:CompletionContextState={connection:{},runtime:{},execution:{},metadataVersion:1,projectId:"p",route:uri,generation:{},available:true,lspAllowed:true,metadataAllowed:true,syntaxAllowed:true,analysisToken:"first"};
  if(options.syntax){context.metadataAllowed=false;context.analysisToken=undefined;}
  const states=new Map(["a","b"].map(id=>[id,context])),sessions=new Map(["a","b"].map(id=>[id,"shared-session"]));
  const drivers=new Map(["a","b"].map(id=>[id,options.driver??"postgres"]));
  const dialects=new Map<string,string|undefined>(["a","b"].map(id=>[id,options.syntax?"postgres":undefined]));
  const model={getValue:()=>text,getVersionId:()=>version,isDisposed:()=>false,getValueLength:()=>text.length,getOffsetAt:({column}:{column:number})=>column-1,getPositionAt:(offset:number)=>({lineNumber:1,column:offset+1})};
  const markers=new Map<string,any[]>(),setModelMarkers=vi.fn((_model,owner,values)=>markers.set(owner,values));
  const monaco={editor:{getModel:()=>model,setModelMarkers},Uri:{parse:(value:string)=>value},MarkerSeverity:{Error:8,Warning:4,Info:2,Hint:1}};
  const tabDiagnostics=new Map<string,any[]>(),versions={current:new Map([[uri,7]])},texts={current:new Map([[uri,text]])},setLspDiagnostics=vi.fn((id:string,values:any[])=>{tabDiagnostics.set(id,values);});
  const routines=new Map(["a","b"].map(id=>[id,()=>drivers.get(id)==="mysql"?analyzeMysqlRoutineSyntax(text):null]));
  const channels=new Map<string,(value:any)=>void>(),subscribe=new Map(["a","b"].map(id=>[id,async(accept:(value:any)=>void)=>{channels.set(id,accept);return ()=>channels.delete(id);} ]));
  const content=new Set<()=>void>(),focusEvents=new Set<()=>void>(),stateEvents=new Map(["a","b"].map(id=>[id,new Set<()=>void>()]));
  const attach=(listeners:Set<()=>void>,listener:()=>void)=>{listeners.add(listener);return {dispose:()=>listeners.delete(listener)};};
  const editors=new Map(["a","b"].map(id=>[id,{getModel:()=>model,hasTextFocus:()=>focused===id,onDidChangeModelContent:(listener:()=>void)=>attach(content,listener),onDidFocusEditorText:(listener:()=>void)=>attach(focusEvents,listener),onDidBlurEditorText:(listener:()=>void)=>attach(focusEvents,listener)}]));
  const reads=new Map(["a","b"].map(id=>[id,()=>states.get(id)!])),subscribers=new Map(["a","b"].map(id=>[id,(listener:()=>void)=>{stateEvents.get(id)!.add(listener);return ()=>stateEvents.get(id)!.delete(listener);} ]));
  const activeTab=options.queryError?{id:"shared",sql:text,error:"Unknown field",queryError:{database:{driver:"postgres",sqlState:"42703",documentOffset:7,documentEndOffset:13}}}:undefined;
  const snapshot=async(request:any)=>({...request,diagnostics:[{message:"Recovered shared syntax",code:"SYNTAX_ERROR",range:{start:{line:0,character:0},end:{line:0,character:1}}}]});
  const container=document.createElement("div"),root=createRoot(container);
  function Pane({id}:{id:string}){useEditorDiagnostics({monaco:monaco as any,lspReady:true,lspSessionKey:sessions.get(id)!,documentUri:uri,documentVersionsRef:versions,documentTextsRef:texts,
    diagnosticTabId:options.independentTabs?id:undefined,
    diagnosticDialect:dialects.get(id),requestDiagnosticSnapshot:options.syntax?snapshot:undefined,getSemanticContext:reads.get(id),subscribeSemanticContext:subscribers.get(id),subscribeDiagnostics:subscribe.get(id),mysqlRoutineAnalysisForModel:routines.get(id)!,setLspDiagnostics,mountedEditor:editors.get(id),activeTab:activeTab as any,driver:drivers.get(id)!});return null;}
  const render=async(ids:string[])=>{await act(async()=>root.render(<>{ids.map(id=><Pane key={id} id={id}/>)}</>));};
  cleanups.push(async()=>{await act(async()=>root.unmount());container.remove();});
  const diagnostic={message:"Ambiguous shared column",code:"OXIDE004",range:{start:{line:0,character:7},end:{line:0,character:13}}};
  const emit=(id:string,patch:Record<string,unknown>={})=>channels.get(id)?.({uri,version:7,oxideAnalysisToken:"first",diagnostics:[diagnostic],...patch});
  return {render,emit,markers,setLspDiagnostics,diagnostic,tabDiagnostics,
    edit:(value:string)=>{text=value;version++;for(const notify of content)notify();},
    focus:(id:string)=>{focused=id;for(const notify of focusEvents)notify();},
    session:(id:string,value:string)=>{sessions.set(id,value);},
    dialect:(id:string,value:string)=>{dialects.set(id,value);},
    driver:(id:string,value:"postgres"|"oracle"|"mysql")=>{drivers.set(id,value);},
    shadow:(value:number)=>commitLspDocumentShadow({uri,text,version:value,openedDocuments:new Set(),documentVersions:versions.current,documentTexts:texts.current}),
    change:(patch:Partial<CompletionContextState>,notifyIds=["a","b"])=>{for(const [id,state]of states)states.set(id,{...state,...patch});for(const id of notifyIds)for(const notify of stateEvents.get(id)!)notify();},
  };
}
it("keeps the surviving publisher's markers and Problems entry when a sibling unmounts",async()=>{
  const f=await fixture();await f.render(["a","b"]);f.emit("a");f.emit("b");expect(f.markers.get("sql-lsp")).toHaveLength(1);
  await f.render(["b"]);expect(f.markers.get("sql-lsp")).toHaveLength(1);expect(f.setLspDiagnostics).toHaveBeenLastCalledWith("shared",[f.diagnostic]);
});
it("does not blank a valid sibling publication while a new pane waits for its notification",async()=>{
  const f=await fixture();await f.render(["a"]);f.emit("a");expect(f.markers.get("sql-lsp")).toHaveLength(1);
  await f.render(["a","b"]);expect(f.markers.get("sql-lsp")).toHaveLength(1);expect(f.setLspDiagnostics).toHaveBeenLastCalledWith("shared",[f.diagnostic]);
});
it("retains a newer empty diagnostic list when its publishing sibling closes",async()=>{
  const f=await fixture();await f.render(["a","b"]);f.emit("a");f.emit("b",{diagnostics:[]});await f.render(["a"]);
  expect(f.markers.get("sql-lsp")).toEqual([]);expect(f.setLspDiagnostics).toHaveBeenLastCalledWith("shared",[]);
});
it("withdraws all stale peer candidates on the first context callback",async()=>{
  const f=await fixture();await f.render(["a","b"]);f.emit("a");f.emit("b");f.change({execution:{},metadataAllowed:false,analysisToken:undefined},["a"]);
  expect(f.markers.get("sql-lsp")).toEqual([]);f.emit("b");expect(f.markers.get("sql-lsp")).toEqual([]);
});
it("withdraws markers immediately on a model edit before tab props or shadows catch up",async()=>{
  const f=await fixture();await f.render(["a","b"]);f.emit("a");f.emit("b");f.edit("SELECT 1");expect(f.markers.get("sql-lsp")).toEqual([]);
  await f.render(["b"]);f.emit("b");expect(f.markers.get("sql-lsp")).toEqual([]);
});
it("does not borrow another LSP session's pending diagnostics",async()=>{
  const f=await fixture();await f.render(["a"]);f.emit("a");f.session("b","other-session");await f.render(["a","b"]);expect(f.markers.get("sql-lsp")).toEqual([]);
  f.emit("b",{diagnostics:[{...f.diagnostic,message:"Other session"}]});expect(f.markers.get("sql-lsp")?.[0]?.message).toBe("Other session");
  f.focus("a");expect(f.markers.get("sql-lsp")?.[0]?.message).toBe(f.diagnostic.message);
});
it("clears the shared SQL layer and Problems only after the final publisher closes",async()=>{
  const f=await fixture();await f.render(["a","b"]);f.emit("a");await f.render(["b"]);expect(f.markers.get("sql-lsp")).toHaveLength(1);
  await f.render([]);expect(f.markers.get("sql-lsp")).toEqual([]);expect(f.setLspDiagnostics).toHaveBeenLastCalledWith("shared",[]);
});
it("preserves a sibling's Oracle diagnostics and withdraws old model revisions immediately",async()=>{
  const f=await fixture({driver:"oracle",text:"CREATE TABLE t (id NUMBER NOT NULL DEFAULT 0);"});await f.render(["a","b"]);expect(f.markers.get("oracle-syntax")).toHaveLength(1);
  await f.render(["b"]);expect(f.markers.get("oracle-syntax")).toHaveLength(1);f.edit("SELECT 1");expect(f.markers.get("oracle-syntax")).toEqual([]);
});
it("preserves a sibling's real MySQL routine analysis and cancels disposed publishers",async()=>{
  vi.useFakeTimers();const f=await fixture({driver:"mysql",text:"CREATE PROCEDURE p(IN a INT,) BEGIN SELECT a; END;"});await f.render(["a","b"]);await act(async()=>vi.advanceTimersByTimeAsync(180));
  expect(f.markers.get("mysql-routine-syntax")!.length).toBeGreaterThan(0);await f.render(["b"]);expect(f.markers.get("mysql-routine-syntax")!.length).toBeGreaterThan(0);
  await f.render([]);await act(async()=>vi.advanceTimersByTimeAsync(180));expect(f.markers.get("mysql-routine-syntax")).toEqual([]);
});
it("preserves a sibling's database error range and clears it on a model revision",async()=>{
  const f=await fixture({queryError:true});await f.render(["a","b"]);expect(f.markers.get("database-query")?.[0]?.code).toBe("42703");await f.render(["b"]);
  expect(f.markers.get("database-query")).toHaveLength(1);f.edit("SELECT 1");expect(f.markers.get("database-query")).toEqual([]);
});
it("preserves recovered schema-free syntax across a sibling unmount",async()=>{
  vi.useFakeTimers();const f=await fixture({syntax:true});await f.render(["a","b"]);await act(async()=>vi.advanceTimersByTimeAsync(120));
  expect(f.markers.get("sql-lsp")?.[0]?.code).toBe("SYNTAX_ERROR");await f.render(["b"]);expect(f.markers.get("sql-lsp")?.[0]?.code).toBe("SYNTAX_ERROR");
});
it("withdraws an old server revision even when Monaco text and version stay unchanged",async()=>{
  const f=await fixture();await f.render(["a","b"]);f.emit("a");f.emit("b");f.shadow(8);expect(f.markers.get("sql-lsp")).toEqual([]);
  f.emit("a");expect(f.markers.get("sql-lsp")).toEqual([]);f.emit("b",{version:8});expect(f.markers.get("sql-lsp")).toHaveLength(1);
});
it("does not adopt a sibling's diagnostic profile when a new profile is pending",async()=>{
  const f=await fixture();await f.render(["a"]);f.emit("a");f.dialect("b","mysql");await f.render(["a","b"]);expect(f.markers.get("sql-lsp")).toEqual([]);
  await f.render(["a"]);expect(f.markers.get("sql-lsp")).toHaveLength(1);
});
it("updates and revokes Problems for every tab sharing a project model",async()=>{
  const f=await fixture({independentTabs:true});await f.render(["a","b"]);f.emit("a");f.emit("b");expect(f.tabDiagnostics.get("a")).toHaveLength(1);expect(f.tabDiagnostics.get("b")).toHaveLength(1);
  f.change({metadataAllowed:false,analysisToken:undefined},["a"]);expect(f.tabDiagnostics.get("a")).toEqual([]);expect(f.tabDiagnostics.get("b")).toEqual([]);
});
it("does not show a background MySQL routine error in a focused PostgreSQL pane",async()=>{
  vi.useFakeTimers();const f=await fixture({driver:"mysql",text:"CREATE PROCEDURE p(IN a INT,) BEGIN SELECT a; END;"});f.driver("b","postgres");await f.render(["a","b"]);f.focus("b");
  await act(async()=>vi.advanceTimersByTimeAsync(180));expect(f.markers.get("mysql-routine-syntax")).toEqual([]);
});
it("does not adopt a remounted background Oracle layer in a focused PostgreSQL pane",async()=>{
  const f=await fixture({driver:"oracle",text:"CREATE TABLE t (id NUMBER NOT NULL DEFAULT 0);"});f.driver("b","postgres");await f.render(["b"]);f.focus("b");await f.render(["b","a"]);
  expect(f.markers.get("oracle-syntax")).toEqual([]);
});
