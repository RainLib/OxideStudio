import {expect,it,vi} from "vitest";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import {captureInlineProviderRequest,watchInlineProviderContext} from "./inlineProviderContext";
function fixture(){
  let state:CompletionContextState={connection:{},runtime:{},execution:{},metadataVersion:1,projectId:"p",route:"r",generation:{},available:true,syntaxAllowed:true,lspAllowed:true,metadataAllowed:true,analysisToken:"current"};
  let version=1,dead=false,active=true;const token={isCancellationRequested:false};
  const model={getVersionId:()=>version,isDisposed:()=>dead},read=()=>state;
  const capture=()=>captureInlineProviderRequest({read,model,token,isActive:()=>active});
  return {read,capture,token,change:(patch:Partial<CompletionContextState>)=>{state={...state,...patch};},edit:()=>version++,dispose:()=>{dead=true;},inactive:()=>{active=false;}};
}
it.each(["connection","runtime","execution","generation","analysisToken","metadataVersion","projectId","route"] as const)("rejects a result after %s changes without a SQL edit",key=>{
  const f=fixture(),request=f.capture();f.change({[key]:key==="metadataVersion"?2:key==="projectId"||key==="route"||key==="analysisToken"?"next":{}});expect(request.isCurrent()).toBe(false);
});
it("keeps document-only work available while execution holds physical metadata",()=>{
  const f=fixture();f.change({lspAllowed:false,metadataAllowed:false});const request=f.capture();expect(request.allowed).toBe(true);expect(request.metadataAllowed).toBe(false);expect(request.isCurrent()).toBe(true);
});
it("allows offline document work without borrowing an old metadata grant",()=>{
  const f=fixture();f.change({available:false,lspAllowed:true,metadataAllowed:true});const request=f.capture();expect(request.allowed).toBe(true);expect(request.metadataAllowed).toBe(false);expect(request.isCurrent()).toBe(true);
});
it("rejects work outside the document scope",()=>{const f=fixture();f.change({syntaxAllowed:false});expect(f.capture().isCurrent()).toBe(false);});
it.each(["edit","dispose","inactive","cancel"] as const)("rejects %s while a request is pending",action=>{
  const f=fixture(),request=f.capture();if(action==="cancel")f.token.isCancellationRequested=true;else f[action]();expect(request.isCurrent()).toBe(false);
});
it("invalidates synchronously, hides visible ghost text and ignores unrelated state events",()=>{
  const f=fixture();let notify=()=>{};const release=vi.fn(),invalidate=vi.fn(),trigger=vi.fn();
  const dispose=watchInlineProviderContext({getSemanticContext:f.read,subscribeSemanticContext:listener=>{notify=listener;return release;},invalidate,editor:{trigger}});
  notify();expect(invalidate).not.toHaveBeenCalled();f.change({execution:{}});notify();expect(invalidate).toHaveBeenCalledOnce();expect(trigger).toHaveBeenCalledWith("oxide.inlineContext","editor.action.inlineSuggest.hide",{});dispose();expect(release).toHaveBeenCalledOnce();
});
