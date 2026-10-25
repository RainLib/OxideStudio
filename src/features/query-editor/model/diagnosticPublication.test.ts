import {expect,it,vi} from "vitest";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import type {PublishDiagnosticsParams} from "@/services/lsp/types";
import {createDiagnosticPublication} from "./diagnosticPublication";

function fixture(dialect?:string){
  const uri="oxide://query/current.postgres.sql";let text="SELECT shared FROM a JOIN b ON 1=1",version=42,dead=false;
  let state:CompletionContextState={connection:{},runtime:{},execution:{},metadataVersion:1,projectId:"p",route:"app",generation:{},available:true,lspAllowed:true,metadataAllowed:true,analysisToken:"first"};
  let shadow:{version:number|undefined;text:string|undefined}={version:7,text};
  const model={getValue:()=>text,getVersionId:()=>version,isDisposed:()=>dead},publish=vi.fn(),clear=vi.fn();
  const controller=createDiagnosticPublication({uri,dialect,read:()=>state,model:()=>model,shadow:()=>shadow,publish,clear});
  const publication=(patch:Partial<PublishDiagnosticsParams>={}):PublishDiagnosticsParams=>({uri,version:7,oxideAnalysisToken:"first",diagnostics:[{message:"Ambiguous field",code:"OXIDE004",range:{start:{line:0,character:7},end:{line:0,character:13}}}],...patch});
  return {controller,publish,clear,model,publication,context:(patch:Partial<CompletionContextState>)=>{state={...state,...patch};controller.refresh();},
    shadow:(next:typeof shadow)=>{shadow=next;controller.refresh();},edit:()=>{text="SELECT 1";version++;controller.refresh();},disposeModel:()=>{dead=true;controller.refresh();}};
}
it("applies diagnostics only for the exact configuration and acknowledged SQL snapshot",()=>{
  const f=fixture(),publication=f.publication();f.controller.accept(publication);
  expect(f.publish).toHaveBeenCalledWith(f.model,publication.diagnostics);f.controller.accept(publication);expect(f.publish).toHaveBeenCalledOnce();
});
it("buffers an early publication until its configuration is granted",()=>{
  const f=fixture();f.controller.accept(f.publication({oxideAnalysisToken:"next"}));expect(f.publish).not.toHaveBeenCalled();
  f.context({analysisToken:"next"});expect(f.publish).toHaveBeenCalledOnce();
});
it("buffers a publication until the document shadow is acknowledged",()=>{
  const f=fixture();f.shadow({version:undefined,text:undefined});f.controller.accept(f.publication());expect(f.publish).not.toHaveBeenCalled();
  f.shadow({version:7,text:f.model.getValue()});expect(f.publish).toHaveBeenCalledOnce();
});
it.each([{available:false},{lspAllowed:false},{metadataAllowed:false},{analysisToken:undefined}])("withdraws visible metadata diagnostics immediately for %o",patch=>{
  const f=fixture();f.controller.accept(f.publication());f.context(patch);expect(f.clear).toHaveBeenCalledOnce();
  f.controller.accept(f.publication());expect(f.publish).toHaveBeenCalledOnce();
});
it("does not restore an old token after a driver operation completes",()=>{
  const f=fixture();f.controller.accept(f.publication());f.context({execution:{},metadataAllowed:false,analysisToken:undefined});
  f.controller.accept(f.publication());f.context({execution:{},metadataAllowed:true,analysisToken:"second"});
  expect(f.publish).toHaveBeenCalledOnce();f.controller.accept(f.publication({oxideAnalysisToken:"second",diagnostics:[]}));
  expect(f.publish).toHaveBeenLastCalledWith(f.model,[]);
});
it("ignores late old-token publications without overwriting current markers",()=>{
  const f=fixture();f.context({analysisToken:"new"});f.controller.accept(f.publication({oxideAnalysisToken:"new"}));
  f.controller.accept(f.publication());expect(f.publish).toHaveBeenCalledOnce();expect(f.clear).not.toHaveBeenCalled();
});
it.each([undefined,"","a b","K","x".repeat(129),"sql;drop"])("does not grant a malformed/missing token: %s",token=>{
  const f=fixture();f.controller.accept(f.publication({oxideAnalysisToken:token}));expect(f.publish).not.toHaveBeenCalled();expect(f.controller.pendingCount).toBe(0);
});
it.each([undefined,-1,1.5,Number.MAX_SAFE_INTEGER+1])("rejects unbound document versions: %s",version=>{
  const f=fixture();f.controller.accept(f.publication({version}));expect(f.publish).not.toHaveBeenCalled();
});
it("never applies another document's notification",()=>{
  const f=fixture();f.controller.accept(f.publication({uri:"oxide://query/other.sql"}));expect(f.publish).not.toHaveBeenCalled();
});
it("clears old diagnostics on SQL edits and waits for the new acknowledged text",()=>{
  const f=fixture();f.controller.accept(f.publication());f.edit();expect(f.clear).toHaveBeenCalledOnce();
  f.controller.accept(f.publication());expect(f.publish).toHaveBeenCalledOnce();
  f.controller.accept(f.publication({version:8,diagnostics:[]}));expect(f.publish).toHaveBeenCalledOnce();
  f.shadow({version:8,text:f.model.getValue()});expect(f.publish).toHaveBeenLastCalledWith(f.model,[]);
});
it("rejects malformed diagnostic ranges",()=>{
  const f=fixture();f.controller.accept(f.publication({diagnostics:[{message:"bad",range:{start:{line:-1,character:0},end:{line:0,character:1}}}]}));
  expect(f.publish).not.toHaveBeenCalled();
});
it("bounds unmatched configuration buffers and does not retain SQL separately",()=>{
  const f=fixture();for(let i=0;i<100;i++)f.controller.accept(f.publication({oxideAnalysisToken:`token-${i}`}));
  expect(f.controller.pendingCount).toBe(4);expect(f.publish).not.toHaveBeenCalled();f.context({analysisToken:"token-99"});expect(f.publish).toHaveBeenCalledOnce();
});
it("releases pending publications and ignores callbacks after disposal",()=>{
  const f=fixture();f.controller.accept(f.publication());f.controller.dispose();f.controller.dispose();f.controller.accept(f.publication());f.controller.refresh();
  expect(f.publish).toHaveBeenCalledOnce();expect(f.clear).toHaveBeenCalledOnce();expect(f.controller.pendingCount).toBe(0);
});
it("withdraws diagnostics when the model is disposed",()=>{
  const f=fixture();f.controller.accept(f.publication());f.disposeModel();expect(f.clear).toHaveBeenCalledOnce();f.controller.accept(f.publication());expect(f.publish).toHaveBeenCalledOnce();
});
it("does not replace a newer document publication with an old version under the same token",()=>{
  const f=fixture();f.shadow({version:8,text:f.model.getValue()});
  f.controller.accept(f.publication({version:8,diagnostics:[]}));f.controller.accept(f.publication());
  f.context({metadataAllowed:false});f.context({metadataAllowed:true});expect(f.publish).toHaveBeenLastCalledWith(f.model,[]);
});

it("retains schema-free syntax feedback while physical metadata is held",()=>{
  const f=fixture("postgres"),publication=f.publication();f.context({syntaxAllowed:true,lspAllowed:false,metadataAllowed:false,analysisToken:undefined});
  f.controller.accept(publication);expect(f.publish).not.toHaveBeenCalled();
  f.controller.acceptSnapshot({uri:publication.uri,version:7,dialect:"postgres",mode:"syntax",diagnostics:[{...publication.diagnostics[0]!,code:"SYNTAX_ERROR"}]});
  expect(f.publish.mock.calls[f.publish.mock.calls.length-1]?.[1][0].code).toBe("SYNTAX_ERROR");expect(f.controller.snapshotMode).toBeUndefined();
});
it("uses syntax as a fallback but replaces it with the exact metadata publication",()=>{
  const f=fixture("postgres"),publication=f.publication();
  f.controller.acceptSnapshot({uri:publication.uri,version:7,dialect:"postgres",mode:"syntax",diagnostics:[]});expect(f.controller.snapshotMode).toBe("metadata");
  f.controller.accept(publication);expect(f.publish.mock.calls[f.publish.mock.calls.length-1]?.[1][0].code).toBe("OXIDE004");expect(f.controller.snapshotMode).toBeUndefined();
});
it.each([{dialect:"mysql"},{oxideAnalysisToken:"old"}])("does not accept a wrong-profile or schema-tagged syntax snapshot: %o",patch=>{
  const f=fixture("postgres"),publication=f.publication();f.context({syntaxAllowed:true,metadataAllowed:false});
  f.controller.acceptSnapshot({uri:publication.uri,version:7,dialect:"postgres",mode:"syntax",diagnostics:[],...patch});expect(f.publish).not.toHaveBeenCalled();
});
it("does not show cached syntax outside its document scope",()=>{
  const f=fixture("postgres"),publication=f.publication();f.context({syntaxAllowed:true,metadataAllowed:false});
  f.controller.acceptSnapshot({uri:publication.uri,version:7,dialect:"postgres",mode:"syntax",diagnostics:[]});
  f.context({syntaxAllowed:false,projectId:"other"});expect(f.clear).toHaveBeenCalledOnce();
});
