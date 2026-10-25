import {expect,it,vi} from "vitest";
import {getLspDocumentSemantics,type DocumentSemanticRequest} from "./documentSemantics";
import type {LspClientBridge} from "./contracts";
import {LspClient} from "./LspClient";
const ports=vi.hoisted(()=>({invoke:vi.fn()}));vi.mock("@tauri-apps/api/core",()=>({invoke:ports.invoke}));
const uri="oxide://project/p/current.sql",point={line:0,character:4},range={start:{line:0,character:0},end:{line:0,character:8}};
const base:DocumentSemanticRequest<"hover">={uri,version:7,dialect:"postgres",operation:{kind:"hover",position:point}};
function fixture(kind:string,value:unknown,patch:Record<string,unknown>={}){const response={uri,version:7,dialect:"postgres",kind,value,...patch},request=vi.fn().mockResolvedValue(response);return {client:{isInitialized:()=>true,request} as unknown as LspClientBridge,request,response};}
it("sends an explicit current-document request without authority fields and normalizes hover",async()=>{
  const f=fixture("hover",{contents:{kind:"markdown",value:"local bigint"},range});
  const result=await getLspDocumentSemantics(f.client,{...base,oxideAnalysisToken:"ignored",operation:{...base.operation,schema:"ignored"}} as typeof base);
  expect(result?.value).toEqual({contents:"local bigint",range});expect(f.request).toHaveBeenCalledWith("oxide/documentSemantics",{textDocument:{uri},version:7,dialect:"postgres",operation:base.operation});
});
it.each([{uri:"oxide://project/other.sql"},{version:8},{dialect:"mysql"},{kind:"tokens"},{oxideAnalysisToken:"old"},{value:{contents:"stale",range:{start:{line:3,character:0},end:{line:0,character:0}}}}])("rejects foreign or malformed provenance %o",async patch=>{
  expect(await getLspDocumentSemantics(fixture("hover",{contents:"local"},patch).client,base)).toBeNull();
});
it.each([{version:-1},{version:2147483648},{dialect:"postgres "},{operation:{kind:"hover",position:{line:0.5,character:0}}},{operation:{kind:"unknown"}},{operation:{kind:"rename",position:point}},{operation:{kind:"references",position:point}},{operation:{kind:"inlayHints",range:{start:{line:2,character:0},end:{line:0,character:0}}}},{operation:{kind:"codeActions",range,context:{diagnostics:[],only:[8]}}}])("does not send malformed semantic arguments %o",async patch=>{
  const f=fixture("hover",null);expect(await getLspDocumentSemantics(f.client,{...base,...patch} as DocumentSemanticRequest)).toBeNull();expect(f.request).not.toHaveBeenCalled();
});
it.each([
  {operation:{kind:"definitions",position:point},value:[{uri,range}]},
  {operation:{kind:"references",position:point,includeDeclaration:false},value:[{uri,range}]},
  {operation:{kind:"signature",position:point},value:{signatures:[{label:"COALESCE(value, ...)",parameters:[{label:[9,14]}]}],activeSignature:0}},
  {operation:{kind:"prepareRename",position:point},value:range},
  {operation:{kind:"rename",position:point,newName:"fresh"},value:{changes:{[uri]:[{range,newText:"fresh"}]}}},
  {operation:{kind:"codeActions",range,context:{diagnostics:[],only:["source"]}},value:[{title:"Format",edit:{changes:{[uri]:[{range,newText:"SELECT 1"}]}}}]},
  {operation:{kind:"tokens"},value:{data:[0,0,1,4,0]}},
  {operation:{kind:"inlayHints",range},value:[{position:point,label:"explicit:",kind:2}]},
])("accepts the bound $operation.kind payload",async({operation,value})=>{
  const request={...base,operation} as DocumentSemanticRequest;
  expect((await getLspDocumentSemantics(fixture(operation.kind,value).client,request))?.value).toEqual(value);
});
it.each([
  {kind:"definitions",value:[{uri:"file:///private-catalog.sql",range}]},
  {kind:"references",value:[{uri,range:{start:{line:0,character:-1},end:point}}]},
  {kind:"signature",value:{signatures:[{label:"f(x)",parameters:[{label:[0,20]}]}]}},
  {kind:"prepareRename",value:{start:{line:2,character:0},end:point}},
  {kind:"rename",value:{changes:{"file:///other.sql":[{range,newText:"bad"}]}}},
  {kind:"codeActions",value:[{title:"Run",command:{command:"sql.execute"}}]},
  {kind:"tokens",value:{data:[0,0,1,9,0]}},
  {kind:"tokens",value:{data:[0,0,1]}},
  {kind:"inlayHints",value:[{position:point,label:[],textEdits:[{range,newText:4}]}]},
])("rejects malformed or external $kind results",async({kind,value})=>{
  const operation=kind==="tokens"?{kind}:kind==="inlayHints"||kind==="codeActions"?{kind,range,context:{diagnostics:[]}}:{kind,position:point,newName:"fresh",includeDeclaration:true};
  expect(await getLspDocumentSemantics(fixture(kind,value).client,{...base,operation} as DocumentSemanticRequest)).toBeNull();
});
it("drops a semantic response after the client stops",async()=>{
  const f=fixture("hover",{contents:"local"});f.request.mockImplementation(async()=>{f.client.isInitialized=()=>false;return f.response;});expect(await getLspDocumentSemantics(f.client,base)).toBeNull();
});
it("does not send requests from an unready real client",async()=>{ports.invoke.mockClear();expect(await new LspClient("semantics-unready").getDocumentSemantics(base)).toBeNull();expect(ports.invoke).not.toHaveBeenCalled();});
it("the real client rejects an old response across a fast same-client restart",async()=>{
  let finish!:(value:unknown)=>void;ports.invoke.mockImplementation(async(command:string,payload:any)=>command==="lsp_request"&&payload.request.method==="oxide/documentSemantics"?new Promise(done=>{finish=done;}):command==="lsp_is_running"?true:"initialized");
  const client=new LspClient("semantic-runtime");await client.initialize("/fixture/lsp");const pending=client.getDocumentSemantics(base);await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));client.markDisconnected();await client.initialize("/fixture/lsp");finish(fixture("hover",{contents:"old"}).response);expect(await pending).toBeNull();await client.shutdown();
});
