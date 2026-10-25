import {expect,it,vi} from "vitest";
import {getLspDocumentStructure,type DocumentStructureRequest} from "./documentStructure";
import type {LspClientBridge} from "./contracts";
import {LspClient} from "./LspClient";
const ports=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:ports.invoke}));
const range={start:{line:0,character:0},end:{line:2,character:8}};
const symbol={name:"q",kind:13,range,selectionRange:{start:{line:0,character:5},end:{line:0,character:6}}};
const base:DocumentStructureRequest={uri:"oxide://project/p/q.sql",version:7,dialect:"postgres",kind:"symbols"};
function fixture(value:unknown={...base,items:[symbol]}){const request=vi.fn().mockResolvedValue(value),client={isInitialized:()=>true,request}as unknown as LspClientBridge;return {client,request};}
it("sends only the declared document/profile/version over the scoped method",async()=>{
  const f=fixture();expect((await getLspDocumentStructure(f.client,base))?.items).toEqual([symbol]);expect(f.request).toHaveBeenCalledWith("oxide/documentStructure",{textDocument:{uri:base.uri},version:7,dialect:"postgres",kind:"symbols"});
});
it.each([{uri:"oxide://other/q.sql"},{version:8},{dialect:"mysql"},{kind:"folding"},{oxideAnalysisToken:"old"},{items:null},{items:[{...symbol,selectionRange:{start:{line:8,character:0},end:{line:8,character:1}}}]}])("rejects a foreign or malformed snapshot %o",async patch=>{
  expect(await getLspDocumentStructure(fixture({...base,items:[symbol],...patch}).client,base)).toBeNull();
});
it.each([{version:-1},{version:1.5},{version:2147483648},{dialect:"postgres "},{kind:"workspace"},{positions:[{line:0,character:0}]}])("rejects invalid request data before transport %o",async patch=>{
  const f=fixture();expect(await getLspDocumentStructure(f.client,{...base,...patch}as DocumentStructureRequest)).toBeNull();expect(f.request).not.toHaveBeenCalled();
});
it("validates selection cardinality, parent containment and positions",async()=>{
  const request:DocumentStructureRequest<"selection">={...base,kind:"selection",positions:[{line:1,character:2}]};
  const child={range:{start:{line:1,character:0},end:{line:1,character:8}},parent:{range}};
  const value={...base,kind:"selection",items:[child]};expect((await getLspDocumentStructure(fixture(value).client,request))?.items).toEqual([child]);
  expect(await getLspDocumentStructure(fixture({...value,items:[]}).client,request)).toBeNull();
  expect(await getLspDocumentStructure(fixture({...value,items:[{...child,parent:{range:{start:{line:0,character:0},end:{line:0,character:1}}}}]}).client,request)).toBeNull();
  const f=fixture();expect(await getLspDocumentStructure(f.client,{...request,positions:[{line:-1,character:0}]})).toBeNull();expect(f.request).not.toHaveBeenCalled();
});
it("validates folding bounds without coercing strings or fractional lines",async()=>{
  const request:DocumentStructureRequest<"folding">={...base,kind:"folding"};
  const value={...base,kind:"folding",items:[{startLine:0,endLine:2}]};expect((await getLspDocumentStructure(fixture(value).client,request))?.items).toEqual(value.items);
  for(const item of [{startLine:3,endLine:2},{startLine:"0",endLine:2},{startLine:0.5,endLine:2}])expect(await getLspDocumentStructure(fixture({...value,items:[item]}).client,request)).toBeNull();
});
it("does not accept a response when the client stops during the request",async()=>{
  const f=fixture();f.request.mockImplementation(async()=>{f.client.isInitialized=()=>false;return {...base,items:[symbol]};});expect(await getLspDocumentStructure(f.client,base)).toBeNull();
});
it("does not issue transport for a stopped client",async()=>{const f=fixture();f.client.isInitialized=()=>false;expect(await getLspDocumentStructure(f.client,base)).toBeNull();expect(f.request).not.toHaveBeenCalled();});
it("the real client rejects an old structure response after a same-client fast restart",async()=>{
  let finish!:(value:unknown)=>void;
  ports.invoke.mockImplementation(async(command:string,payload:any)=>command==="lsp_request"&&payload.request.method==="oxide/documentStructure"?new Promise(done=>{finish=done;}):command==="lsp_is_running"?true:"initialized");
  const client=new LspClient("structure-runtime");await client.initialize("/fixture/sql-lsp");const pending=client.getDocumentStructure(base);
  await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));client.markDisconnected();await client.initialize("/fixture/sql-lsp");finish({...base,items:[symbol]});expect(await pending).toBeNull();await client.shutdown();
});
it("the real unready client does not issue a document structure command",async()=>{
  ports.invoke.mockClear();expect(await new LspClient("structure-unready").getDocumentStructure(base)).toBeNull();expect(ports.invoke).not.toHaveBeenCalled();
});
