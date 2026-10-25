import {expect,it,vi} from "vitest";
import {createWhereColumnSource} from "./whereColumnSource";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import {MetadataTaskLimiter} from "@/services/metadataTaskLimiter";
const values=(name="fresh")=>[{name,data_type:"integer",is_nullable:true,is_primary_key:false}];
function fixture(){
 let context:CompletionContextState={connection:{},runtime:{},execution:{},lspRuntime:{},metadataVersion:1,projectId:"p",route:"r",generation:{},analysisToken:"a",available:true,lspAllowed:true,metadataAllowed:true,syntaxAllowed:true};
 const load=vi.fn().mockResolvedValue(values());const source=createWhereColumnSource({read:()=>context,scope:"test",load});
 return {source,load,read:()=>context,change:(patch:Partial<CompletionContextState>)=>{context={...context,...patch};}};
}
it("coalesces concurrent reads and serves a stable warm context without another driver read",async()=>{
 const f=fixture();let resolve!:(value:any)=>void;f.load.mockReturnValue(new Promise(done=>{resolve=done;}));const a=f.source.load(),b=f.source.load();expect(a).toBe(b);expect(f.load).toHaveBeenCalledOnce();resolve(values());expect(await a).toEqual([{name:"fresh",type:"integer"}]);await f.source.load();expect(f.load).toHaveBeenCalledOnce();expect(f.source.peek()).toEqual([{name:"fresh",type:"integer"}]);
});
it.each(["connection","runtime","execution","lspRuntime","generation","projectId","route","metadataVersion","analysisToken"] as const)("never carries cached columns across %s changes",async key=>{
 const f=fixture();await f.source.load();f.load.mockResolvedValue(values("replacement"));f.change({[key]:key==="metadataVersion"?2:["projectId","route","analysisToken"].includes(key)?"other":{}});expect(f.source.peek()).toEqual([]);expect(await f.source.load()).toEqual([{name:"replacement",type:"integer"}]);expect(f.load).toHaveBeenCalledTimes(2);
});
it.each([{available:false},{metadataAllowed:false},{lspAllowed:true,metadataAllowed:false}])("does not read physical fields without the renderer metadata grant: %o",async patch=>{
 const f=fixture();f.change(patch);expect(await f.source.load()).toEqual([]);expect(f.load).not.toHaveBeenCalled();expect(f.source.peek()).toEqual([]);
});
it("drops an old in-flight response and never lets it replace the new cache",async()=>{
 const f=fixture();let resolve!:(value:any)=>void;f.load.mockReturnValueOnce(new Promise(done=>{resolve=done;}));const old=f.source.load();f.change({analysisToken:"new",generation:{}});f.load.mockResolvedValue(values("new"));await f.source.load();resolve(values("old"));expect(await old).toEqual([]);expect(f.source.peek()).toEqual([{name:"new",type:"integer"}]);
});
it("rechecks the grant after queue admission, before invoking the driver",async()=>{
 const f=fixture(),limiter=new MetadataTaskLimiter(1,2);let release!:()=>void;const held=limiter.run("scope","held",()=>new Promise<void>(done=>{release=done;}));
 const source=createWhereColumnSource({read:f.read,scope:"scope",load:f.load,limiter});const pending=source.load();f.change({metadataAllowed:false});release();await held;expect(await pending).toEqual([]);expect(f.load).not.toHaveBeenCalled();
});
it("retries failed reads without caching an empty failure",async()=>{
 const f=fixture();f.load.mockRejectedValueOnce(new Error("metadata denied"));await expect(f.source.load()).rejects.toThrow("metadata denied");expect(f.source.peek()).toEqual([]);expect(await f.source.load()).toEqual([{name:"fresh",type:"integer"}]);expect(f.load).toHaveBeenCalledTimes(2);
});
it("ignores unrelated store copies while retaining the exact same source identity",async()=>{
 const f=fixture();await f.source.load();f.change({});await f.source.load();expect(f.load).toHaveBeenCalledOnce();
});
it("preserves the last field in large valid metadata without prefix truncation",async()=>{
 const f=fixture();f.load.mockResolvedValue(Array.from({length:10000},(_,i)=>values(`column_${i}`)[0]));const result=await f.source.load();expect(result).toHaveLength(10000);expect(result[9999]?.name).toBe("column_9999");await f.source.load();expect(f.load).toHaveBeenCalledOnce();
});
it("does not pin a column payload beyond the cache byte budget",async()=>{
 const f=fixture();f.load.mockResolvedValue(values("x".repeat(5*1024*1024)));expect(await f.source.load()).toHaveLength(1);expect(f.source.peek()).toEqual([]);await f.source.load();expect(f.load).toHaveBeenCalledTimes(2);
});
it("retains bounded Unicode comments in the same authorized cached snapshot",async()=>{
 const f=fixture();f.load.mockResolvedValue([{...values()[0],comment:"用户名称"+"😀".repeat(2000)}]);const result=await f.source.load();
 expect(result[0]?.comment).toBe("用户名称"+"😀".repeat(509));expect(f.source.peek()).toBe(result);await f.source.load();expect(f.load).toHaveBeenCalledOnce();
});
