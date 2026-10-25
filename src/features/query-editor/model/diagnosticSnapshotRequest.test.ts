import {expect,it} from "vitest";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import {captureDiagnosticSnapshot} from "./diagnosticSnapshotRequest";
function fixture(){
  let state:CompletionContextState={connection:{},runtime:{},execution:{},metadataVersion:1,projectId:"p",route:"app",generation:{},available:true,syntaxAllowed:true,lspAllowed:true,metadataAllowed:true,analysisToken:"current"};
  let version=42,active=true,shadow={version:7,text:"SELECT 1"};const model={getVersionId:()=>version,getValue:()=>shadow.text,isDisposed:()=>false};
  const capture=(mode:"syntax"|"metadata")=>captureDiagnosticSnapshot({uri:"oxide://query/current.sql",dialect:"postgres",mode,read:()=>state,model:()=>model,shadow:()=>shadow,isActive:()=>active});
  return {capture,change:(patch:Partial<CompletionContextState>)=>{state={...state,...patch};},edit:()=>{version++;shadow={version:8,text:"SELECT 2"};},stop:()=>{active=false;}};
}
it("syntax inference survives physical-only operation changes",()=>{
  const f=fixture(),request=f.capture("syntax")!;f.change({execution:{},analysisToken:undefined,available:false,lspAllowed:false,metadataAllowed:false});
  expect(request.isCurrent()).toBe(true);expect(request.request).not.toHaveProperty("oxideAnalysisToken");
});
it.each(["connection","projectId","route"] as const)("syntax inference is revoked for another document scope: %s",key=>{
  const f=fixture(),request=f.capture("syntax")!;f.change({[key]:key==="connection"?{}:"other"});expect(request.isCurrent()).toBe(false);
});
it("metadata inference requires unchanged physical provenance",()=>{
  const f=fixture(),request=f.capture("metadata")!;expect(request.request.oxideAnalysisToken).toBe("current");f.change({execution:{}});expect(request.isCurrent()).toBe(false);
});
it.each(["edit","stop"] as const)("rejects a late response after %s",kind=>{
  const f=fixture(),request=f.capture("syntax")!;f[kind]();expect(request.isCurrent()).toBe(false);
});
it("does not capture metadata while held, but permits a document-local parser snapshot",()=>{
  const f=fixture();f.change({metadataAllowed:false,analysisToken:undefined});expect(f.capture("metadata")).toBeUndefined();expect(f.capture("syntax")?.isCurrent()).toBe(true);
});
