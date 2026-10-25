import {expect,it,vi} from "vitest";
import {registerLspDocumentFormatter,registerLspRangeFormatter} from "./lspFormattingRegistry";

function fixture(){
  const providers=new Map<string,any>(),dispose=vi.fn();
  const api={registerDocumentFormattingEditProvider:vi.fn((_language:unknown,provider:any)=>{providers.set("document",provider);return {dispose};}),
    registerDocumentRangeFormattingEditProvider:vi.fn((_language:unknown,provider:any)=>{providers.set("range",provider);return {dispose};})};
  const model=(uri:string)=>({uri:{toString:()=>uri},isDisposed:()=>false}) as any;
  const document=(uri:string,request=vi.fn().mockResolvedValue([{text:uri}]),language="sql")=>({request,lease:registerLspDocumentFormatter(api,language,uri,{provideDocumentFormattingEdits:request})});
  const range=(uri:string,request=vi.fn().mockResolvedValue([{text:uri}]))=>({request,lease:registerLspRangeFormatter(api,"sql",uri,{provideDocumentRangeFormattingEdits:request})});
  const format=(uri:string)=>providers.get("document").provideDocumentFormattingEdits(model(uri),{tabSize:2,insertSpaces:true},{});
  return {api,dispose,model,document,range,format,providers};
}
it("shares one language formatter and routes distinct authorities with identical paths",async()=>{
  const f=fixture(),a=f.document("oxide://a/shared.sql"),b=f.document("oxide://b/shared.sql");
  expect(f.api.registerDocumentFormattingEditProvider).toHaveBeenCalledTimes(1);
  expect(await f.format("oxide://a/shared.sql")).toEqual([{text:"oxide://a/shared.sql"}]);expect(a.request).toHaveBeenCalledOnce();expect(b.request).not.toHaveBeenCalled();
  expect(await f.format("oxide://b/shared.sql")).toEqual([{text:"oxide://b/shared.sql"}]);expect(b.request).toHaveBeenCalledOnce();a.lease.dispose();b.lease.dispose();
});
it("matches exact full URIs including query, fragment, case and scheme",async()=>{
  const f=fixture(),a=f.document("oxide://a/Case.sql?v=1#cell");
  for(const uri of ["oxide://a/Case.sql?v=2#cell","oxide://a/Case.sql?v=1#other","oxide://a/case.sql?v=1#cell","other://a/Case.sql?v=1#cell"])
    expect(await f.format(uri)).toEqual([]);
  expect(a.request).not.toHaveBeenCalled();a.lease.dispose();
});
it("does not interpret glob characters or decoded filename delimiters",async()=>{
  const f=fixture(),a=f.document("oxide://a/[x]*?literal#part");expect(await f.format("oxide://a/[x]*?literal#part")).toHaveLength(1);
  expect(await f.format("oxide://a/xxx?literal#part")).toEqual([]);expect(a.request).toHaveBeenCalledOnce();a.lease.dispose();
});
it("forwards range formatting arguments to only the exact source",async()=>{
  const f=fixture(),a=f.range("oxide://a/shared.sql"),b=f.range("oxide://b/shared.sql"),model=f.model("oxide://a/shared.sql");
  const range={startLineNumber:2,startColumn:3,endLineNumber:5,endColumn:8},options={tabSize:4,insertSpaces:false},token={};
  expect(await f.providers.get("range").provideDocumentRangeFormattingEdits(model,range,options,token)).toHaveLength(1);
  expect(a.request).toHaveBeenCalledWith(model,range,options,token);expect(b.request).not.toHaveBeenCalled();expect(f.api.registerDocumentRangeFormattingEditProvider).toHaveBeenCalledOnce();a.lease.dispose();b.lease.dispose();
});
it("keeps the other URI usable when a sibling formatter is disposed",async()=>{
  const f=fixture(),a=f.document("a"),b=f.document("b");b.lease.dispose();expect(f.dispose).not.toHaveBeenCalled();expect(await f.format("a")).toHaveLength(1);
  expect(await f.format("b")).toEqual([]);expect(b.request).not.toHaveBeenCalled();a.lease.dispose();expect(f.dispose).toHaveBeenCalledOnce();
});
it("releases a final registration exactly once and can recreate it",async()=>{
  const f=fixture(),a=f.document("a");a.lease.dispose();a.lease.dispose();expect(f.dispose).toHaveBeenCalledOnce();const b=f.document("a");
  expect(f.api.registerDocumentFormattingEditProvider).toHaveBeenCalledTimes(2);expect(await f.format("a")).toHaveLength(1);b.lease.dispose();
});
it("keeps document/range, language and Monaco runtimes independent",async()=>{
  const f=fixture(),other=fixture(),a=f.document("a"),b=f.range("a"),c=f.document("a",vi.fn().mockResolvedValue([]),"pgsql"),d=other.document("a");
  a.lease.dispose();expect(f.dispose).toHaveBeenCalledOnce();expect(other.dispose).not.toHaveBeenCalled();expect(f.api.registerDocumentFormattingEditProvider).toHaveBeenCalledTimes(2);
  expect(await other.format("a")).toHaveLength(1);b.lease.dispose();c.lease.dispose();d.lease.dispose();
});
it("routes the latest same-URI owner and restores the prior mounted owner on disposal",async()=>{
  const f=fixture(),a=f.document("a"),b=f.document("a");await f.format("a");expect(a.request).not.toHaveBeenCalled();expect(b.request).toHaveBeenCalledOnce();
  b.lease.dispose();await f.format("a");expect(a.request).toHaveBeenCalledOnce();a.lease.dispose();
});
it("rejects a late result after replacing its URI owner",async()=>{
  const f=fixture();let resolve!:(value:any[])=>void;const a=f.document("a",vi.fn().mockReturnValue(new Promise(done=>{resolve=done;}))),pending=f.format("a"),b=f.document("a");
  resolve([{text:"stale"}]);expect(await pending).toEqual([]);a.lease.dispose();b.lease.dispose();
});
it("rejects owner ABA even if a temporary replacement is gone before the result",async()=>{
  const f=fixture();let resolve!:(value:any[])=>void;const a=f.document("a",vi.fn().mockReturnValue(new Promise(done=>{resolve=done;}))),pending=f.format("a"),b=f.document("a");
  b.lease.dispose();resolve([{text:"stale"}]);expect(await pending).toEqual([]);a.lease.dispose();
});
it("does not invalidate a current owner when an older duplicate owner is disposed",async()=>{
  const f=fixture(),a=f.document("a");let resolve!:(value:any[])=>void;const b=f.document("a",vi.fn().mockReturnValue(new Promise(done=>{resolve=done;}))),pending=f.format("a");
  a.lease.dispose();resolve([{text:"current"}]);expect(await pending).toEqual([{text:"current"}]);b.lease.dispose();
});
it("rejects in-flight results after disposal and does not retain removed routes",async()=>{
  const f=fixture();let resolve!:(value:any[])=>void;const a=f.document("a",vi.fn().mockReturnValue(new Promise(done=>{resolve=done;}))),b=f.document("b"),pending=f.format("a");
  a.lease.dispose();resolve([{text:"stale"}]);expect(await pending).toEqual([]);expect(await f.format("a")).toEqual([]);b.lease.dispose();
});
it("does not invoke a formatter for a disposed Monaco model",async()=>{
  const f=fixture(),a=f.document("a"),model=f.model("a");model.isDisposed=()=>true;
  expect(await f.providers.get("document").provideDocumentFormattingEdits(model,{},{})).toEqual([]);expect(a.request).not.toHaveBeenCalled();a.lease.dispose();
});
it("propagates owner failures without falling back to another document",async()=>{
  const f=fixture(),a=f.document("a",vi.fn().mockRejectedValue(new Error("source failure"))),b=f.document("b");
  await expect(f.format("a")).rejects.toThrow("source failure");expect(b.request).not.toHaveBeenCalled();a.lease.dispose();b.lease.dispose();
});

it("dispatches a large same-language workspace without scanning or calling sibling formatters",async()=>{
  const f=fixture(),owners=Array.from({length:1024},(_,index)=>f.document("oxide://workspace/"+index+".sql"));
  await f.format("oxide://workspace/1023.sql");expect(f.api.registerDocumentFormattingEditProvider).toHaveBeenCalledOnce();
  expect(owners.reduce((total,owner)=>total+owner.request.mock.calls.length,0)).toBe(1);
  for(const owner of owners)owner.lease.dispose();expect(f.dispose).toHaveBeenCalledOnce();
});
