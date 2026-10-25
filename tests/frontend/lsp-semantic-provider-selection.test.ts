/** @vitest-environment happy-dom */
import {afterEach,expect,it,vi} from "vitest";
// @ts-expect-error Monaco's internal merge function has no published declaration.
import {getDocumentSemanticTokens} from "monaco-editor/esm/vs/editor/contrib/semanticTokens/common/getSemanticTokens.js";
import {registerLspCoreProviders} from "@/features/query-editor/hooks/useLspCoreProviderCoordinator";
import type {LspClient} from "@/services/lsp/client/LspClient";
import type {CompletionContextState} from "@/services/lsp/semanticContext";

const cleanup:Array<()=>void>=[];afterEach(()=>{for(const dispose of cleanup.splice(0))dispose();});
function fixture(count=2,canUseLsp=true){
  const providers:any[]=[],registrations:Array<{dispose:()=>void}>=[];
  const languages=new Proxy({} as any,{get:(_target,key:string)=>(_language:unknown,provider:any)=>{
    if(key==="registerDocumentSemanticTokensProvider")providers.push(provider);
    return {dispose:()=>{const index=providers.indexOf(provider);if(index>=0)providers.splice(index,1);}};
  }});
  const monaco={languages};
  const uris=Array.from({length:count},(_,index)=>"oxide://owner-"+index+"/same/path.sql");
  const models=uris.map(uri=>({uri:{toString:()=>uri},getVersionId:()=>7,isDisposed:()=>false}));
  const calls=uris.map((_,index)=>vi.fn().mockResolvedValue({resultId:"tokens-"+index,data:[0,index+1,3,2,0]}));
  const states:CompletionContextState[]=uris.map(uri=>({connection:{},runtime:{},execution:{},metadataVersion:1,projectId:"test",route:uri,generation:{},available:true,lspAllowed:true,metadataAllowed:true,analysisToken:"current"}));
  const listeners=uris.map(()=>new Set<()=>void>()),publish:Array<(value:any)=>void>=[];
  for(let index=0;index<count;index++)registrations.push(registerLspCoreProviders({canUseLsp,documentUri:uris[index]!,editorLanguageId:"sql",monaco,
    lspClient:{getSessionKey:()=>"owner-"+index,getSemanticTokens:calls[index]} as unknown as LspClient,
    getSemanticContext:()=>states[index]!,subscribeSemanticContext:listener=>{listeners[index]!.add(listener);return ()=>listeners[index]!.delete(listener);},
    subscribeAnalysis:options=>{publish[index]=options.onPublication;return {dispose:()=>{}};}}));
  cleanup.push(()=>{for(const registration of registrations)registration.dispose();});
  const registry={orderedGroups:()=>[providers.slice().reverse()]};
  const tokens=(index:number,token:Record<string,unknown>={})=>getDocumentSemanticTokens(registry,models[index],null,null,token);
  const change=(index:number,patch:Partial<CompletionContextState>)=>{states[index]={...states[index]!,...patch};for(const listener of listeners[index]!)listener();};
  return {providers,registrations,models,calls,tokens,change,publish,registry};
}
it("lets Monaco select the older registered owner instead of a newer wrong-URI empty response",async()=>{
  const f=fixture(),result=await f.tokens(0);expect(result.provider).toBe(f.providers[0]);expect(Array.from(result.tokens.data)).toEqual([0,1,3,2,0]);
  expect(f.calls[0]).toHaveBeenCalledExactlyOnceWith("oxide://owner-0/same/path.sql");expect(f.calls[1]).not.toHaveBeenCalled();
});
it("keeps the most recently registered model's own tokens",async()=>{
  const f=fixture(),result=await f.tokens(1);expect(result.provider).toBe(f.providers[1]);expect(Array.from(result.tokens.data)).toEqual([0,2,3,2,0]);expect(f.calls[0]).not.toHaveBeenCalled();
});
it("returns no token result for an unowned model with the same language and path",async()=>{
  const f=fixture(),model={...f.models[0]!,uri:{toString:()=>"oxide://unowned/same/path.sql"}};
  const result=await getDocumentSemanticTokens(f.registry,model,null,null,{});expect(result.tokens).toBeNull();for(const call of f.calls)expect(call).not.toHaveBeenCalled();
});
it("distinguishes nonownership null from an owning invalid-context clear",async()=>{
  const f=fixture();await f.tokens(0);f.change(0,{lspAllowed:false,metadataAllowed:false,generation:{}});
  const result=await f.tokens(0);expect(result.provider).toBe(f.providers[0]);expect(Array.from(result.tokens.data)).toEqual([]);expect(f.calls[0]).toHaveBeenCalledOnce();
});
it("retains an explicit owning clear for cancellation without requesting metadata",async()=>{
  const f=fixture(),result=await f.tokens(0,{isCancellationRequested:true});expect(result.provider).toBe(f.providers[0]);expect(Array.from(result.tokens.data)).toEqual([]);
  for(const call of f.calls)expect(call).not.toHaveBeenCalled();
});
it("refreshes the owning cache on new metadata while the model version remains unchanged",async()=>{
  const f=fixture();expect(Array.from((await f.tokens(0)).tokens.data)).toEqual([0,1,3,2,0]);
  f.calls[0]!.mockResolvedValue({resultId:"updated",data:[0,9,4,1,0]});f.change(0,{metadataVersion:2,generation:{},analysisToken:"new-token"});
  const result=await f.tokens(0);expect(result.provider).toBe(f.providers[0]);expect(Array.from(result.tokens.data)).toEqual([0,9,4,1,0]);expect(f.models[0]!.getVersionId()).toBe(7);expect(f.calls[1]).not.toHaveBeenCalled();
});
it("preserves context-scoped publication refresh without recreating the providers",async()=>{
  const f=fixture();await f.tokens(0);f.publish[0]!({version:7,analysisToken:"foreign"});await f.tokens(0);expect(f.calls[0]).toHaveBeenCalledOnce();
  f.publish[0]!({version:7,analysisToken:"current"});await f.tokens(0);expect(f.calls[0]).toHaveBeenCalledTimes(2);expect(f.providers.length).toBe(2);
});
it("keeps the remaining model after its sibling provider is disposed",async()=>{
  const f=fixture();f.registrations[1]!.dispose();expect(Array.from((await f.tokens(0)).tokens.data)).toEqual([0,1,3,2,0]);expect(f.calls[1]).not.toHaveBeenCalled();
});
it("does not allow a late owning result to repopulate tokens after context invalidation",async()=>{
  const f=fixture();let resolve!:(value:any)=>void;f.calls[0]!.mockReturnValue(new Promise(done=>{resolve=done;}));const pending=f.tokens(0);
  await vi.waitFor(()=>expect(f.calls[0]).toHaveBeenCalledOnce());f.change(0,{generation:{},lspAllowed:false});resolve({data:[0,1,3,2,0]});
  const result=await pending;expect(result.provider).toBe(f.providers[0]);expect(Array.from(result.tokens.data)).toEqual([]);
});
it("only requests the actual model's LSP tokens in a large same-language provider group",async()=>{
  const f=fixture(128),result=await f.tokens(0);expect(Array.from(result.tokens.data)).toEqual([0,1,3,2,0]);expect(f.calls.reduce((sum,call)=>sum+call.mock.calls.length,0)).toBe(1);
});

it("keeps an owning clear when its LSP runtime is unavailable",async()=>{
  const f=fixture(2,false),result=await f.tokens(0);expect(result.provider).toBe(f.providers[0]);expect(Array.from(result.tokens.data)).toEqual([]);
  for(const call of f.calls)expect(call).not.toHaveBeenCalled();
});
it("preserves an actual empty owning token result",async()=>{
  const f=fixture();f.calls[0]!.mockResolvedValue({data:[]});const result=await f.tokens(0);expect(result.provider).toBe(f.providers[0]);expect(Array.from(result.tokens.data)).toEqual([]);expect(f.calls[1]).not.toHaveBeenCalled();
});
it("does not let a wrong-URI empty result hide the actual owner's error",async()=>{
  const f=fixture();f.calls[0]!.mockRejectedValue(new Error("owning LSP failure"));await expect(f.tokens(0)).rejects.toThrow("owning LSP failure");expect(f.calls[1]).not.toHaveBeenCalled();
});
