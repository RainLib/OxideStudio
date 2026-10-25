import {expect,it,vi} from "vitest";
import {getLspCompletionSnapshot,type CompletionSnapshotRequest} from "./completionSnapshot";
import {getLspDocumentCompletions} from "./documentCompletions";
import {LspClient} from "./LspClient";
import type {LspClientBridge} from "./contracts";
const ports=vi.hoisted(()=>({invoke:vi.fn()}));vi.mock("@tauri-apps/api/core",()=>({invoke:ports.invoke}));
const request:CompletionSnapshotRequest={uri:"oxide://where/test.sql",version:3,dialect:"postgres",position:{line:1,character:7},analysisToken:"confirmed-3",context:{triggerKind:1}};
const constraints={slot:"is",allowedKeywords:["NULL","NOT NULL","DISTINCT FROM","NOT DISTINCT FROM"]};
const result={uri:request.uri,version:3,dialect:"postgres",position:request.position,oxideAnalysisToken:"confirmed-3",items:[{label:"NULL",kind:14}],isIncomplete:false,constraints};
it.each([true,false])("preserves bound optional pattern escape knowledge %s",async patternEscape=>{
 const patch={constraints:undefined,items:[],logicalContinuation:true,patternEscape};
 expect(await getLspCompletionSnapshot(fixture(patch).client,request)).toMatchObject({logicalContinuation:true,patternEscape});
 expect(await getLspDocumentCompletions(fixture({...patch,oxideAnalysisToken:undefined}).client,{...request,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}})).toMatchObject({logicalContinuation:true,patternEscape});
});
it("requires the exact document cursor for optional pattern escape knowledge",async()=>{
 expect(await getLspDocumentCompletions(fixture({constraints:undefined,oxideAnalysisToken:undefined,position:undefined,logicalContinuation:true,patternEscape:false}).client,{...request,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}})).toBeNull();
});
it.each([{patternEscape:null,logicalContinuation:true},{patternEscape:"true",logicalContinuation:true},{patternEscape:0,logicalContinuation:true},{patternEscape:{},logicalContinuation:true},{patternEscape:true},{patternEscape:false},{patternEscape:true,logicalContinuation:false},{patternEscape:false,logicalContinuation:false},{patternEscape:true,logicalContinuation:true,valueType:"text"}])("rejects unbound or contradictory pattern escape knowledge %o",async patch=>{
 expect(await getLspCompletionSnapshot(fixture({constraints:undefined,...patch}).client,request)).toBeNull();
 expect(await getLspDocumentCompletions(fixture({constraints:undefined,oxideAnalysisToken:undefined,...patch}).client,{...request,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}})).toBeNull();
});
it("preserves the bound escape-character role across catalog and document snapshots",async()=>{
 const patch={constraints:undefined,valueType:"text",valueRole:"pattern-escape",items:[]};
 expect(await getLspCompletionSnapshot(fixture(patch).client,request)).toMatchObject({valueType:"text",valueRole:"pattern-escape"});
 expect(await getLspDocumentCompletions(fixture({...patch,oxideAnalysisToken:undefined}).client,{...request,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}})).toMatchObject({valueType:"text",valueRole:"pattern-escape"});
});
it.each([{valueRole:"pattern-escape"},{valueRole:null,valueType:"text"},{valueRole:"escape",valueType:"text"},{valueRole:{},valueType:"text"},{valueRole:"pattern-escape",valueType:"integer"},{valueRole:"pattern-escape",valueType:"text",logicalContinuation:false}])("rejects malformed, untyped or conflicting escape roles %o",async patch=>{
 expect(await getLspCompletionSnapshot(fixture({constraints:undefined,...patch}).client,request)).toBeNull();
 expect(await getLspDocumentCompletions(fixture({constraints:undefined,oxideAnalysisToken:undefined,...patch}).client,{...request,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}})).toBeNull();
});
it.each([false,true])("preserves bound logical knowledge %s independently of empty or incomplete candidates",async logicalContinuation=>{
 const f=fixture({constraints:undefined,items:[],isIncomplete:true,logicalContinuation});expect(await getLspCompletionSnapshot(f.client,request)).toMatchObject({logicalContinuation,isIncomplete:true});
 expect(await getLspDocumentCompletions(fixture({constraints:undefined,oxideAnalysisToken:undefined,logicalContinuation}).client,{...request,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}})).toMatchObject({logicalContinuation});
});
it.each([{logicalContinuation:null},{logicalContinuation:"false"},{logicalContinuation:0},{logicalContinuation:{}},{logicalContinuation:false,valueType:"integer"},{logicalContinuation:true,constraints}])("rejects malformed or conflicting logical knowledge %o",async patch=>{
 expect(await getLspCompletionSnapshot(fixture({constraints:undefined,...patch}).client,request)).toBeNull();
 expect(await getLspDocumentCompletions(fixture({constraints:undefined,oxideAnalysisToken:undefined,...patch}).client,{...request,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}})).toBeNull();
});
it("rejects even false logical knowledge without document position binding",async()=>{
 expect(await getLspDocumentCompletions(fixture({constraints:undefined,oxideAnalysisToken:undefined,logicalContinuation:false,position:undefined}).client,{...request,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}})).toBeNull();
});
it.each(["integer","pg_catalog.int4","bit(8)","timestamp with time zone","timestamp\nwith time zone"])("preserves bound positive comparison type %s",async valueType=>{
 expect(await getLspCompletionSnapshot(fixture({constraints:undefined,valueType}).client,request)).toMatchObject({valueType});
 const local=fixture({oxideAnalysisToken:undefined,constraints:undefined,valueType});expect(await getLspDocumentCompletions(local.client,{...request,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}})).toMatchObject({valueType});
});
it.each([null,""," integer","x".repeat(257),7,"text\u0000",{}])("rejects malformed positive comparison knowledge %o",async valueType=>{
 expect(await getLspCompletionSnapshot(fixture({constraints:undefined,valueType}).client,request)).toBeNull();
 expect(await getLspDocumentCompletions(fixture({constraints:undefined,valueType,oxideAnalysisToken:undefined}).client,{...request,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}})).toBeNull();
});
it("rejects conflicting slots and document types without exact position binding",async()=>{
 expect(await getLspCompletionSnapshot(fixture({valueType:"integer"}).client,request)).toBeNull();
 expect(await getLspDocumentCompletions(fixture({constraints:undefined,valueType:"integer",oxideAnalysisToken:undefined,position:undefined}).client,{...request,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}})).toBeNull();
});
function fixture(patch:Record<string,unknown>={}){const invoke=vi.fn().mockResolvedValue({...result,...patch});return {invoke,client:{isInitialized:()=>true,requestSessionPayload:()=>({session_key:"isolated"}),invokeCancellable:invoke}as unknown as LspClientBridge};}
it("binds complete keyword constraints to the exact catalog request",async()=>{
 const f=fixture();expect(await getLspCompletionSnapshot(f.client,request)).toMatchObject({items:result.items,constraints,resolveProvider:false});
 expect(f.invoke).toHaveBeenCalledWith("lsp_request",{session_key:"isolated",method:"oxide/completionSnapshot",params:{textDocument:{uri:request.uri},version:3,dialect:"postgres",position:request.position,oxideAnalysisToken:"confirmed-3",context:{triggerKind:1}}},undefined);
});
it.each([{uri:"oxide://other.sql"},{version:4},{dialect:"mysql"},{oxideAnalysisToken:"old"},{position:{line:1,character:8}},{position:undefined},{items:[{label:"NULL",kind:99}]},{items:[{label:"NULL",additionalTextEdits:"bad"}]},{constraints:{slot:"value",allowedKeywords:["NULL"]}},{constraints:{slot:"is",allowedKeywords:["NULL","FROM"]}},{constraints:{slot:"is",allowedKeywords:["NULL","NULL"]}},{constraints:{slot:"is",allowedKeywords:["TRUE"]}}])("rejects stale, foreign or malformed explicit metadata %o",async patch=>{expect(await getLspCompletionSnapshot(fixture(patch).client,request)).toBeNull();});
it.each([{version:-1},{analysisToken:"not valid"},{analysisToken:"x".repeat(129)},{analysisToken:undefined},{analysisToken:null},{dialect:undefined},{dialect:"POSTGRES"},{position:{line:1.5,character:0}},{context:{triggerKind:9}},{context:{triggerKind:2,triggerCharacter:"two"}}])("does not send an invalid request %o",async patch=>{const f=fixture();expect(await getLspCompletionSnapshot(f.client,{...request,...patch}as CompletionSnapshotRequest)).toBeNull();expect(f.invoke).not.toHaveBeenCalled();});
it("keeps absent constraints distinct from an authoritative keyword contract",async()=>{expect(await getLspCompletionSnapshot(fixture({constraints:undefined,isIncomplete:true}).client,request)).toMatchObject({isIncomplete:true});expect(await getLspCompletionSnapshot(fixture({constraints:undefined}).client,request)).not.toHaveProperty("constraints");});
it.each([
 {slot:"is",allowedKeywords:["NULL","TRUE"],truthTests:false},
 {slot:"is",allowedKeywords:["NULL"],truthTests:true},
 {slot:"is",allowedKeywords:["NULL"],truthTests:"true"},
 {slot:"is",allowedKeywords:["NULL"],truthTests:null},
 {slot:"distinct-from",allowedKeywords:["FROM"],truthTests:false},
])("rejects inconsistent or malformed truth knowledge %o",async constraints=>{expect(await getLspCompletionSnapshot(fixture({constraints}).client,request)).toBeNull();});
it.each([false,true])("preserves explicit truth knowledge %s without collapsing false to unknown",async truthTests=>{
 const constraints={slot:"is",allowedKeywords:truthTests?["NULL","TRUE"]:["NULL"],truthTests};expect((await getLspCompletionSnapshot(fixture({constraints}).client,request))?.constraints).toEqual(constraints);
});
it("accepts document-only constraints without a catalog token",async()=>{
 const f=fixture({oxideAnalysisToken:undefined});expect(await getLspDocumentCompletions(f.client,{...request,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}})).toMatchObject({constraints});
});
it.each([{position:undefined},{position:{line:1,character:8}},{oxideAnalysisToken:"confirmed-3"}])("rejects unbound document-only constraints %o",async patch=>{
 const f=fixture({oxideAnalysisToken:undefined,...patch});expect(await getLspDocumentCompletions(f.client,{...request,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}})).toBeNull();
});
it("cancels the Host request and rejects its late response",async()=>{
 let finish!:(value:unknown)=>void,cancel!:()=>void;ports.invoke.mockImplementation(async(command:string)=>command==="lsp_request"?new Promise(done=>{finish=done;}):command==="lsp_is_running"?true:"initialized");
 const client=new LspClient("snapshot-cancellation");await client.initialize("/fixture/lsp");const token={isCancellationRequested:false,onCancellationRequested:(listener:()=>void)=>{cancel=listener;return {dispose:vi.fn()};}};
 const pending=client.getCompletionSnapshot(request,token);await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));token.isCancellationRequested=true;cancel();finish(result);expect(await pending).toBeNull();
 expect(ports.invoke).toHaveBeenCalledWith("lsp_cancel_request",expect.objectContaining({sessionKey:"snapshot-cancellation",requestToken:expect.any(String)}));await client.shutdown();
});
it("rejects a previous-process response even when it was not cancelled",async()=>{
 let finish!:(value:unknown)=>void;ports.invoke.mockImplementation(async(command:string)=>command==="lsp_request"?new Promise(done=>{finish=done;}):command==="lsp_is_running"?true:"initialized");
 const client=new LspClient("snapshot-restart");await client.initialize("/fixture/lsp");const pending=client.getCompletionSnapshot(request);await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));client.markDisconnected();await client.initialize("/fixture/lsp");finish(result);expect(await pending).toBeNull();await client.shutdown();
});
