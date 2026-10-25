/** @vitest-environment happy-dom */
import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {listen} from "@tauri-apps/api/event";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import {syncLspModelBeforeCompletion} from "../model/lspDocumentSync";
import {useEditorDiagnostics} from "./useEditorDiagnostics";
vi.mock("@tauri-apps/api/event",()=>({listen:vi.fn()}));
const cleanups:(()=>Promise<void>)[]=[];
beforeEach(()=>vi.clearAllMocks());
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();vi.useRealTimers();});
async function fixture(options:{pendingListen?:boolean;driver?:"postgres"|"oracle"|"mysql";text?:string;recovery?:boolean;held?:boolean;failListen?:boolean}={}){
  const uri="oxide://query/diagnostic.postgres.sql",text=options.text||"SELECT shared FROM a JOIN b ON 1=1";
  let event!:(value:any)=>void,resolveListen!:(value:()=>void)=>void,notify=()=>{};
  const unlisten=vi.fn();
  vi.mocked(listen).mockImplementation((_name,listener)=>{event=listener;return options.pendingListen?new Promise(done=>{resolveListen=done;}):Promise.resolve(unlisten);});
  if(options.failListen)vi.mocked(listen).mockRejectedValueOnce(new Error("listen unavailable"));
  let context:CompletionContextState={connection:{},runtime:{},execution:{},metadataVersion:1,projectId:"p",route:"app",generation:{},available:true,lspAllowed:true,metadataAllowed:true,analysisToken:"first"};
  if(options.held)context={...context,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false,analysisToken:undefined};
  const request=vi.fn(async(value:any)=>({...value,diagnostics:[{message:"Recovered syntax",code:"SYNTAX_ERROR",range:{start:{line:0,character:0},end:{line:0,character:1}}}]}));
  const model={getValue:()=>text,getVersionId:()=>42,isDisposed:()=>false,getValueLength:()=>text.length,
    getOffsetAt:({column}:{column:number})=>column-1,getPositionAt:(offset:number)=>({lineNumber:1,column:offset+1})};
  const owners=new Map<string,any[]>(),setModelMarkers=vi.fn((_model,owner,markers)=>owners.set(owner,markers));
  const monaco={editor:{getModel:(value:string)=>value===uri?model:null,setModelMarkers},Uri:{parse:(value:string)=>value},MarkerSeverity:{Error:8,Warning:4,Info:2,Hint:1}};
  const versions=new Map([[uri,7]]),texts=new Map([[uri,text]]),setLspDiagnostics=vi.fn(),container=document.createElement("div"),root=createRoot(container);
  const read=()=>context,subscribe=(listener:()=>void)=>{notify=listener;return ()=>{notify=()=>{};};};
  const routine=()=>({routineRanges:[],skippedOversizedDocument:false,diagnostics:[{startOffset:0,endOffset:6,message:"Local routine syntax",code:"MYSQL001" as const}]});
  const mountedEditor={getModel:()=>model};
  function Probe(){useEditorDiagnostics({monaco:monaco as any,lspReady:true,lspSessionKey:"session",documentUri:uri,
    diagnosticDialect:options.recovery?"postgres":undefined,requestDiagnosticSnapshot:options.recovery?request:undefined,
    documentVersionsRef:{current:versions},documentTextsRef:{current:texts},getSemanticContext:read,subscribeSemanticContext:subscribe,
    mysqlRoutineAnalysisForModel:options.driver==="mysql"?routine:()=>null,setLspDiagnostics,mountedEditor,activeTab:undefined,driver:options.driver||"postgres"});return null;}
  await act(async()=>root.render(<Probe/>));let mounted=true;
  const dispose=async()=>{if(mounted){mounted=false;await act(async()=>root.unmount());container.remove();}};cleanups.push(dispose);
  const diagnostic={message:"Ambiguous field",code:"OXIDE004",range:{start:{line:0,character:7},end:{line:0,character:13}}};
  const emit=(patch:Record<string,any>={})=>event({payload:{sessionKey:"session",method:"textDocument/publishDiagnostics",params:{uri,version:7,oxideAnalysisToken:"first",diagnostics:[diagnostic]},...patch}});
  return {request,uri,model,owners,setModelMarkers,setLspDiagnostics,versions,texts,emit,dispose,unlisten,ready:()=>resolveListen(unlisten),
    change:(patch:Partial<CompletionContextState>)=>{context={...context,...patch};notify();}};
}
it("applies only its own document and exact LSP session",async()=>{
  const f=await fixture();const baseline=f.setModelMarkers.mock.calls.length;
  f.emit({sessionKey:"other"});f.emit({sessionKey:undefined});f.emit({params:{uri:f.uri+"x",version:7,oxideAnalysisToken:"first",diagnostics:[]}});
  expect(f.setModelMarkers).toHaveBeenCalledTimes(baseline);f.emit();expect(f.owners.get("sql-lsp")).toHaveLength(1);
});
it("withdraws old markers before React rerenders and does not accept late old-token errors",async()=>{
  const f=await fixture();f.emit();f.change({execution:{},analysisToken:undefined,metadataAllowed:false});expect(f.owners.get("sql-lsp")).toEqual([]);
  f.emit();expect(f.owners.get("sql-lsp")).toEqual([]);f.change({analysisToken:"new",metadataAllowed:true});
  expect(f.owners.get("sql-lsp")).toEqual([]);
  f.emit({params:{uri:f.uri,version:7,oxideAnalysisToken:"new",diagnostics:[]}});f.emit();expect(f.owners.get("sql-lsp")).toEqual([]);
});
it("replays an early server publication when the configuration grant arrives",async()=>{
  const f=await fixture();f.emit({params:{uri:f.uri,version:7,oxideAnalysisToken:"next",diagnostics:[{message:"new",range:{start:{line:0,character:0},end:{line:0,character:1}}}]}});
  expect(f.owners.get("sql-lsp")).toEqual([]);f.change({analysisToken:"next"});expect(f.owners.get("sql-lsp")?.[0]?.message).toBe("new");
});
it("replays after actual document-sync acknowledgement without polling or rerendering",async()=>{
  const f=await fixture();f.versions.clear();f.texts.clear();let complete!:()=>void;
  const client={didOpen:vi.fn(()=>new Promise<void>(done=>{complete=done;})),didChange:vi.fn()};
  const pending=syncLspModelBeforeCompletion({uri:f.uri,model:f.model,client,languageId:"postgres",openedDocuments:new Set(),documentVersions:f.versions,documentTexts:f.texts});
  f.emit({params:{uri:f.uri,version:1,oxideAnalysisToken:"first",diagnostics:[{message:"acknowledged",range:{start:{line:0,character:0},end:{line:0,character:1}}}]}});
  expect(f.owners.get("sql-lsp")).toEqual([]);complete();await pending;expect(f.owners.get("sql-lsp")?.[0]?.message).toBe("acknowledged");
});
it("ignores callbacks and releases a listener resolved after unmount",async()=>{
  const f=await fixture({pendingListen:true});await f.dispose();const count=f.setModelMarkers.mock.calls.length;f.emit();
  await act(async()=>f.ready());expect(f.unlisten).toHaveBeenCalledOnce();expect(f.setModelMarkers).toHaveBeenCalledTimes(count);
});
it("preserves Oracle local syntax markers during physical-context invalidation",async()=>{
  const f=await fixture({driver:"oracle",text:"CREATE TABLE t (id NUMBER NOT NULL DEFAULT 0);"});
  const local=f.owners.get("oracle-syntax");expect(local).toHaveLength(1);f.emit();f.change({metadataAllowed:false,analysisToken:undefined});
  expect(f.owners.get("oracle-syntax")).toBe(local);expect(f.owners.get("sql-lsp")).toEqual([]);
});
it("preserves MySQL routine syntax markers during physical-context invalidation",async()=>{
  vi.useFakeTimers();const f=await fixture({driver:"mysql"});await act(async()=>vi.advanceTimersByTimeAsync(180));
  const local=f.owners.get("mysql-routine-syntax");expect(local).toHaveLength(1);f.emit();f.change({metadataAllowed:false,analysisToken:undefined});
  expect(f.owners.get("mysql-routine-syntax")).toBe(local);expect(f.owners.get("sql-lsp")).toEqual([]);
});

it("recovers an initial missed notification through the mounted diagnostic hook",async()=>{
  vi.useFakeTimers();const f=await fixture({recovery:true});await act(async()=>vi.advanceTimersByTimeAsync(120));
  expect(f.request).toHaveBeenCalledOnce();expect(f.owners.get("sql-lsp")?.[0]?.message).toBe("Recovered syntax");expect(f.setLspDiagnostics).toHaveBeenLastCalledWith("diagnostic",expect.arrayContaining([expect.objectContaining({code:"SYNTAX_ERROR"})]));
});
it("shows schema-free syntax while the physical context is held",async()=>{
  vi.useFakeTimers();const f=await fixture({recovery:true,held:true});await act(async()=>vi.advanceTimersByTimeAsync(120));
  expect(f.request.mock.calls[0]?.[0]).toMatchObject({mode:"syntax",dialect:"postgres"});expect(f.request.mock.calls[0]?.[0]).not.toHaveProperty("oxideAnalysisToken");expect(f.owners.get("sql-lsp")?.[0]?.code).toBe("SYNTAX_ERROR");
});
it("recovers markers after event listener registration fails and retries registration",async()=>{
  vi.useFakeTimers();const f=await fixture({recovery:true,failListen:true});await act(async()=>vi.advanceTimersByTimeAsync(1000));
  expect(f.request).toHaveBeenCalledOnce();expect(listen).toHaveBeenCalledTimes(2);expect(f.owners.get("sql-lsp")).toHaveLength(1);
});
