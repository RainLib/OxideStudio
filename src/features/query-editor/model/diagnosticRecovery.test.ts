import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import type {DiagnosticSnapshot,DiagnosticSnapshotRequest} from "@/services/lsp/client/diagnostics";
import {createDiagnosticPublication} from "./diagnosticPublication";
import {captureDiagnosticSnapshot} from "./diagnosticSnapshotRequest";
import {createDiagnosticRecovery} from "./diagnosticRecovery";
const disposals:Array<()=>void>=[];
beforeEach(()=>vi.useFakeTimers());afterEach(()=>{for(const dispose of disposals.splice(0))dispose();vi.useRealTimers();});
function fixture(options:{held?:boolean;pendingListen?:boolean;failListen?:boolean}={}){
  const uri="oxide://query/recovery.sql",dialect="postgres",text="SELECT 1";
  let state:CompletionContextState={connection:{},runtime:{},execution:{},metadataVersion:1,projectId:"p",route:"app",generation:{},available:true,syntaxAllowed:true,lspAllowed:!options.held,metadataAllowed:!options.held,analysisToken:options.held?undefined:"current"};
  const model={getValue:()=>text,getVersionId:()=>42,isDisposed:()=>false},shadow=()=>({version:7,text}),publish=vi.fn(),clear=vi.fn();
  const controller=createDiagnosticPublication({uri,dialect,read:()=>state,model:()=>model,shadow,publish,clear});
  let handler!:(value:any)=>void,ready!:(release:()=>void)=>void;
  const unlisten=vi.fn(),listen=vi.fn((accept:(value:any)=>void)=>{handler=accept;return options.pendingListen?new Promise<()=>void>(done=>{ready=done;}):Promise.resolve(unlisten);});
  if(options.failListen)listen.mockRejectedValueOnce(new Error("listen unavailable"));
  const diagnostic={message:"from snapshot",code:"SYNTAX_ERROR",range:{start:{line:0,character:0},end:{line:0,character:1}}};
  const request=vi.fn(async(value:DiagnosticSnapshotRequest):Promise<DiagnosticSnapshot|null>=>({...value,diagnostics:[diagnostic]}));
  let active=true;const recovery=createDiagnosticRecovery({controller,listen,request,
    capture:mode=>captureDiagnosticSnapshot({uri,dialect,mode,read:()=>state,model:()=>model,shadow,isActive:()=>active})});
  const dispose=()=>{active=false;recovery.dispose();};disposals.push(dispose);
  return {recovery,controller,request,listen,unlisten,publish,clear,diagnostic,dispose,
    ready:()=>ready(unlisten),emit:()=>handler({uri,version:7,oxideAnalysisToken:state.analysisToken,diagnostics:[{...diagnostic,message:"pushed"}]}),
    change:(patch:Partial<CompletionContextState>)=>{state={...state,...patch};recovery.refresh();},tick:(ms=0)=>vi.advanceTimersByTimeAsync(ms)};
}
it("subscribes before recovering a missed initial publication",async()=>{
  const f=fixture({pendingListen:true});await f.tick(1000);expect(f.request).not.toHaveBeenCalled();
  f.ready();await f.tick(120);expect(f.request).toHaveBeenCalledOnce();expect(f.publish.mock.calls[f.publish.mock.calls.length-1]?.[1][0].message).toBe("from snapshot");
});
it("adds no diagnostic readback when a timely push already satisfies demand",async()=>{
  const f=fixture();await f.tick();f.emit();await f.tick(1000);expect(f.request).not.toHaveBeenCalled();expect(f.publish.mock.calls[f.publish.mock.calls.length-1]?.[1][0].message).toBe("pushed");
});
it("recovers after listener registration failure and retries the subscription without polling diagnostics",async()=>{
  const f=fixture({failListen:true});await f.tick(120);expect(f.request).toHaveBeenCalledOnce();await f.tick(1000);
  expect(f.listen).toHaveBeenCalledTimes(2);expect(f.request).toHaveBeenCalledOnce();f.dispose();expect(f.unlisten).toHaveBeenCalledOnce();
});
it("coalesces forty operation events into one schema-free syntax request",async()=>{
  const f=fixture({held:true});await f.tick();for(let i=0;i<40;i++)f.change({execution:{}});await f.tick(120);
  expect(f.request).toHaveBeenCalledOnce();expect(f.request.mock.calls[0]![0]).toMatchObject({mode:"syntax"});expect(f.request.mock.calls[0]![0]).not.toHaveProperty("oxideAnalysisToken");
});
it("keeps one request in flight and discards obsolete metadata before requesting the latest context",async()=>{
  const f=fixture();let resolve!:(value:DiagnosticSnapshot|null)=>void;
  f.request.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));await f.tick(120);const old=f.request.mock.calls[0]![0];
  for(let i=0;i<40;i++)f.change({execution:{},analysisToken:"latest"});await f.tick(1000);expect(f.request).toHaveBeenCalledOnce();
  resolve({...old,diagnostics:[f.diagnostic]});await f.tick(120);expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.request.mock.calls[1]![0].oxideAnalysisToken).toBe("latest");expect(f.publish).toHaveBeenCalledOnce();
});
it("ignores a late snapshot and releases a late listener after disposal",async()=>{
  const f=fixture({pendingListen:true});await f.tick();f.dispose();f.ready();await f.tick(1000);
  expect(f.unlisten).toHaveBeenCalledOnce();expect(f.request).not.toHaveBeenCalled();expect(f.publish).not.toHaveBeenCalled();
});
it("does not spin after a failed readback with no new source or document event",async()=>{
  const f=fixture();f.request.mockRejectedValue(new Error("request unavailable"));await f.tick(60000);expect(f.request).toHaveBeenCalledOnce();
});
it("keeps syntax feedback during recovery and upgrades to current physical diagnostics",async()=>{
  const f=fixture({held:true});let resolve!:(value:DiagnosticSnapshot|null)=>void;
  f.request.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));await f.tick(120);const syntax=f.request.mock.calls[0]![0];
  f.change({execution:{},lspAllowed:true,metadataAllowed:true,analysisToken:"restored"});resolve({...syntax,diagnostics:[f.diagnostic]});await f.tick(0);
  expect(f.publish).toHaveBeenCalledOnce();await f.tick(120);expect(f.request).toHaveBeenCalledTimes(2);expect(f.request.mock.calls[1]![0]).toMatchObject({mode:"metadata",oxideAnalysisToken:"restored"});
});
