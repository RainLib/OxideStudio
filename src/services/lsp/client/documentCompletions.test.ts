import {expect,it,vi} from "vitest";
import {getLspDocumentCompletions,type DocumentCompletionRequest} from "./documentCompletions";
import type {LspClientBridge} from "./contracts";
import {LspClient} from "./LspClient";
const ports=vi.hoisted(()=>({invoke:vi.fn()}));vi.mock("@tauri-apps/api/core",()=>({invoke:ports.invoke}));
const uri="oxide://local/current.sql",base:DocumentCompletionRequest={uri,version:7,dialect:"duckdb",position:{line:0,character:6},preferences:{keywordCase:"upper",functionCase:"preserve",tableAlias:"none"}};
const item={label:"local_id",kind:5,detail:"INTEGER",textEdit:{range:{start:{line:0,character:4},end:{line:0,character:12}},newText:"local_id"}};
function fixture(patch:Record<string,unknown>={}){const result={uri,version:7,dialect:"duckdb",isIncomplete:false,items:[item],...patch},request=vi.fn().mockResolvedValue(result);return {request,result,client:{isInitialized:()=>true,requestSessionPayload:()=>({}),invokeCancellable:(_command:string,payload:any)=>request(payload.method,payload.params)}as unknown as LspClientBridge};}
it("sends only document inputs and inline caller preferences, with no metadata authority",async()=>{
  const f=fixture(),request={...base,oxideAnalysisToken:"ignored",preferences:{...base.preferences,schemas:"ignored"}};
  expect(await getLspDocumentCompletions(f.client,request)).toEqual({items:[item],isIncomplete:false,resolveProvider:false});
  expect(f.request).toHaveBeenCalledWith("oxide/documentCompletions",{textDocument:{uri},version:7,dialect:"duckdb",position:base.position,preferences:base.preferences});
});
it.each([{uri:"oxide://foreign.sql"},{version:8},{dialect:"sqlite"},{oxideAnalysisToken:"warm"},{isIncomplete:1},{items:[{...item,data:{schemaId:"secret"}}]},{items:[{...item,command:{command:"sql.execute"}}]},{items:[{...item,additionalTextEdits:[]}]},{items:[{...item,textEdit:{newText:"x",range:{start:{line:1,character:0},end:{line:0,character:0}}}}]},{items:[{...item,label:4}]},{items:[{...item,kind:99}]},{items:Array.from({length:513},()=>item)}])("rejects foreign or malformed scoped candidates %o",async patch=>{
  expect(await getLspDocumentCompletions(fixture(patch).client,base)).toBeNull();
});
it.each([{version:-1},{version:2147483648},{dialect:"duckdb "},{position:{line:0.5,character:0}},{preferences:{...base.preferences,keywordCase:"auto"}},{preferences:{...base.preferences,tableAlias:"any"}}])("does not send invalid arguments %o",async patch=>{
  const f=fixture();expect(await getLspDocumentCompletions(f.client,{...base,...patch}as DocumentCompletionRequest)).toBeNull();expect(f.request).not.toHaveBeenCalled();
});
it("keeps incomplete scoped results explicit without enabling catalog resolve",async()=>{
  expect(await getLspDocumentCompletions(fixture({isIncomplete:true}).client,base)).toMatchObject({isIncomplete:true,resolveProvider:false});
});
it("rejects a response from the previous process incarnation",async()=>{
  let finish!:(value:unknown)=>void;ports.invoke.mockImplementation(async(command:string)=>command==="lsp_request"?new Promise(done=>{finish=done;}):command==="lsp_is_running"?true:"initialized");
  const client=new LspClient("document-completion-runtime");await client.initialize("/fixture/lsp");const pending=client.getDocumentCompletions(base);await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));client.markDisconnected();await client.initialize("/fixture/lsp");finish(fixture().result);expect(await pending).toBeNull();await client.shutdown();
});
it("does not send before initialization",async()=>{ports.invoke.mockClear();expect(await new LspClient("unready-local-list").getDocumentCompletions(base)).toBeNull();expect(ports.invoke).not.toHaveBeenCalled();});
it("does not send an already-cancelled document completion request",async()=>{const f=fixture();expect(await getLspDocumentCompletions(f.client,base,{isCancellationRequested:true})).toBeNull();expect(f.request).not.toHaveBeenCalled();});
it("cancels the actual generic Host request token and drops a late result",async()=>{
  let finish!:(value:unknown)=>void,cancel!:()=>void;ports.invoke.mockImplementation(async(command:string)=>command==="lsp_request"?new Promise(done=>{finish=done;}):command==="lsp_is_running"?true:"initialized");
  const client=new LspClient("cancel-local-list");await client.initialize("/fixture/lsp");const token={isCancellationRequested:false,onCancellationRequested:(listener:()=>void)=>{cancel=listener;return {dispose:vi.fn()};}};
  const pending=client.getDocumentCompletions(base,token);await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));token.isCancellationRequested=true;cancel();finish(fixture().result);expect(await pending).toBeNull();
  const request=ports.invoke.mock.calls.find(call=>call[0]==="lsp_request")?.[1]?.request;expect(request.request_token).toMatch(/^document-completion-/);expect(ports.invoke).toHaveBeenCalledWith("lsp_cancel_request",{sessionKey:"cancel-local-list",requestToken:request.request_token});await client.shutdown();
});
