import {afterEach,expect,it,vi} from "vitest";
import {attachCompletionContextRefresh,rememberIncompleteCompletionInteraction} from "./completionContextRefresh";
import type {CompletionContextState} from "@/services/lsp/semanticContext";

function fixture(visible=true,allowDocumentOnly=false){
  vi.useFakeTimers();let state:CompletionContextState={connection:{},runtime:{},metadataVersion:1,projectId:"p",route:"app",generation:{},available:true,lspAllowed:true,metadataAllowed:true};
  const events=new Map<string,Function>();let notify=()=>{};
  let focus=true,position={lineNumber:1,column:8},version=1,model={getVersionId:()=>version};
  const trigger=vi.fn((_source:string,command:string)=>{visible=command==="editor.action.triggerSuggest";});
  const listener=(name:string)=>(fn:Function)=>{events.set(name,fn);return {dispose:()=>events.delete(name)};};
  const editor={getModel:()=>model,getPosition:()=>position,hasTextFocus:()=>focus,getDomNode:()=>({querySelector:()=>visible}),trigger,
    onDidBlurEditorText:listener("blur"),onDidChangeCursorPosition:listener("cursor"),onDidChangeModelContent:listener("text"),onDidChangeModel:listener("model"),onKeyDown:listener("key")};
  const invalidate=vi.fn(),unsubscribe=vi.fn(),markChained=vi.fn();
  const attachment=attachCompletionContextRefresh({editor:editor as any,read:()=>state,subscribe:fn=>{notify=fn;return unsubscribe;},invalidate,markChained,allowDocumentOnly});
  const change=(patch:Partial<CompletionContextState>)=>{state={...state,...patch};notify();};
  const pending=()=>change({runtime:{},available:false,lspAllowed:false,metadataAllowed:false});
  const ready=()=>change({generation:{},available:true,lspAllowed:true,metadataAllowed:true});
  return {attachment,trigger,invalidate,unsubscribe,markChained,events,change,pending,ready,notify:()=>notify(),remember:()=>rememberIncompleteCompletionInteraction(editor as any,model,position),
    hideWidget:()=>{visible=false;},
    mutate:(key:string)=>{if(key==="blur")focus=false;if(key==="cursor")position={lineNumber:2,column:1};if(key==="text")version++;if(key==="model")model={getVersionId:()=>1};events.get(key)?.();}};
}
afterEach(()=>vi.useRealTimers());
it("recovers the first invoked empty list while metadata is still progressive",async()=>{
 const f=fixture(false,true);f.change({metadataAllowed:false,syntaxAllowed:true,generation:{}});f.remember();f.ready();await vi.runAllTimersAsync();expect(f.trigger).toHaveBeenCalledWith("oxide.completionContext","editor.action.triggerSuggest",{});f.attachment.dispose();
});
it("does not retain an arbitrary full-source empty request",async()=>{
 const f=fixture(false,true);f.remember();f.ready();await vi.runAllTimersAsync();expect(f.trigger).not.toHaveBeenCalled();f.attachment.dispose();
});
it("leaves ordinary providers opted out of first-empty recovery",async()=>{
 const f=fixture(false,false);f.change({metadataAllowed:false,syntaxAllowed:true});f.remember();f.ready();await vi.runAllTimersAsync();expect(f.trigger).not.toHaveBeenCalled();f.attachment.dispose();
});
it.each(["blur","cursor","text","model","escape"])("does not recover the first empty list after %s",async key=>{
 const f=fixture(false,true);f.change({metadataAllowed:false,syntaxAllowed:true});f.remember();if(key==="escape")f.events.get("key")?.({key:"Escape"});else f.mutate(key);f.ready();await vi.runAllTimersAsync();expect(f.trigger).not.toHaveBeenCalled();f.attachment.dispose();
});
it("removes the incomplete-interaction listener when disposed",async()=>{
 const f=fixture(false,true);f.change({metadataAllowed:false,syntaxAllowed:true});f.attachment.dispose();f.remember();f.ready();await vi.runAllTimersAsync();expect(f.trigger).not.toHaveBeenCalled();
});
it("resets Monaco's logically active empty result before asking recovered sources again",async()=>{
  const f=fixture(true,true);f.change({available:false,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false,generation:{}});await vi.runAllTimersAsync();f.hideWidget();f.ready();await vi.runAllTimersAsync();expect(f.trigger.mock.calls.slice(-2).map(call=>call[1])).toEqual(["hideSuggestWidget","editor.action.triggerSuggest"]);f.attachment.dispose();
});
it("keeps recovery through an empty progressive server list before renderer metadata is complete",async()=>{
  const f=fixture(true,true);f.change({available:false,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false,generation:{}});await vi.runAllTimersAsync();f.hideWidget();f.change({available:true,lspAllowed:true,metadataAllowed:false,generation:{}});await vi.runAllTimersAsync();f.hideWidget();f.ready();await vi.runAllTimersAsync();expect(f.markChained).toHaveBeenCalledTimes(3);f.attachment.dispose();
});
it("keeps the original interaction after an empty local recovery until physical sources arrive",async()=>{
  const f=fixture(true,true);f.change({available:false,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false,generation:{}});await vi.runAllTimersAsync();f.hideWidget();f.ready();await vi.runAllTimersAsync();expect(f.markChained).toHaveBeenCalledTimes(2);f.attachment.dispose();
});
it.each(["blur","cursor","text","model","escape"])("does not restore physical results after local recovery and interaction change: %s",async key=>{
  const f=fixture(true,true);f.change({available:false,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false,generation:{}});await vi.runAllTimersAsync();f.hideWidget();if(key==="escape")f.events.get("key")?.({key:"Escape"});else f.mutate(key);f.ready();await vi.runAllTimersAsync();expect(f.markChained).toHaveBeenCalledOnce();f.attachment.dispose();
});
it("recovers document suggestions while physical availability remains false",async()=>{
  const f=fixture(true,true);f.change({available:false,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false,generation:{}});await vi.runAllTimersAsync();expect(f.trigger).toHaveBeenCalledWith("oxide.completionContext","editor.action.triggerSuggest",{});f.attachment.dispose();
});
it("reopens the original interaction under an explicit document-only grant",async()=>{
  const f=fixture(true,true);f.pending();f.change({available:true,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false,generation:{}});await vi.runAllTimersAsync();expect(f.trigger).toHaveBeenCalledWith("oxide.completionContext","editor.action.triggerSuggest",{});f.attachment.dispose();
});
it("does not grant document-only recovery to ordinary metadata-only providers",async()=>{
  const f=fixture();f.pending();f.change({available:true,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false,generation:{}});await vi.runAllTimersAsync();expect(f.markChained).not.toHaveBeenCalled();f.attachment.dispose();
});
it("withdraws a visible list synchronously and reopens only after safe sources arrive",async()=>{
  const f=fixture();f.pending();expect(f.trigger.mock.calls.map(c=>c[1])).toEqual(["hideSuggestWidget"]);
  await vi.runAllTimersAsync();expect(f.markChained).not.toHaveBeenCalled();
  f.ready();await vi.runAllTimersAsync();expect(f.trigger.mock.calls.map(c=>c[1])).toEqual(["hideSuggestWidget","editor.action.triggerSuggest"]);
  expect(f.markChained).toHaveBeenCalledOnce();f.attachment.dispose();
});
it.each(["blur","cursor","text","model"])("does not reopen after the original interaction changes: %s",async key=>{
  const f=fixture();f.pending();f.mutate(key);f.ready();await vi.runAllTimersAsync();
  expect(f.markChained).not.toHaveBeenCalled();f.attachment.dispose();
});
it("does not reopen after Escape dismisses the pending interaction",async()=>{
  const f=fixture();f.pending();f.events.get("key")?.({browserEvent:{key:"Escape"}});f.ready();await vi.runAllTimersAsync();
  expect(f.markChained).not.toHaveBeenCalled();f.attachment.dispose();
});
it("leaves a previously hidden widget closed and ignores identical publications",async()=>{
  const f=fixture(false);f.pending();f.ready();f.notify();await vi.runAllTimersAsync();
  expect(f.trigger).not.toHaveBeenCalled();expect(f.invalidate).toHaveBeenCalledTimes(2);f.attachment.dispose();
});
it("drops a queued reopen after another context change and cleans up listeners",async()=>{
  const f=fixture();f.pending();f.ready();f.change({available:false});f.attachment.dispose();await vi.runAllTimersAsync();f.notify();
  expect(f.markChained).not.toHaveBeenCalled();expect(f.unsubscribe).toHaveBeenCalledOnce();expect(f.events.size).toBe(0);
});
