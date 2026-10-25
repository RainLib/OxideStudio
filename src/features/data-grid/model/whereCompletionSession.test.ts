import {expect,it,vi} from "vitest";
import {createWhereColumnSource} from "./whereColumnSource";
import {createWhereCompletionSession,whereCompletionDocumentUri} from "./whereCompletionSession";
import {defaultDatabaseCapabilities} from "@/lib/databaseDialect";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import {buildWhereCompletionDocument,mergeWhereCompletionCandidates} from "@/lib/whereCompletion";
function fixture(local=false,dialect="sqlserver"){
 let context:CompletionContextState={connection:{},runtime:{},lspRuntime:{},metadataVersion:1,projectId:"p",route:"r",generation:{},available:true,syntaxAllowed:true,lspAllowed:!local,metadataAllowed:!local};
 let runtime={generation:{},ready:true},notify=()=>{},focused=true;
 const interaction={condition:"EXISTS (SELECT 1 WHERE local|Suffix = 1)".replace("|",""),cursorOffset:28,manual:true};
 const client={didOpen:vi.fn().mockResolvedValue(undefined),didChange:vi.fn().mockResolvedValue(undefined),didClose:vi.fn().mockResolvedValue(undefined),getRuntimeSnapshot:()=>runtime,getCompletionSnapshot:vi.fn().mockResolvedValue(null),getCompletions:vi.fn().mockResolvedValue([]),getDocumentCompletions:vi.fn().mockResolvedValue({items:[{label:"local_id",insertText:"local_id"}],isIncomplete:false,resolveProvider:false})};
 const publish=vi.fn();
 const columnLoad=vi.fn().mockResolvedValue([{name:"old_field",data_type:"text",is_nullable:true,is_primary_key:false}]);
 const columnSource=createWhereColumnSource({read:()=>context,scope:"test",load:columnLoad});
 const session=createWhereCompletionSession({client:client as any,sessionKey:"test",uri:whereCompletionDocumentUri("oxide://query/a.mysql.sql","owner",dialect),driver:"mysql",capabilities:{...defaultDatabaseCapabilities("mysql"),identifierQuote:"["},schema:"app",table:"users",dialect,preferences:{keywordCase:"upper",functionCase:"lower",tableAlias:"none"},read:()=>context,subscribe:listener=>{notify=listener;return vi.fn();},columns:columnSource,isCurrent:()=>focused,publish});
 return {session,client,publish,interaction,columnLoad,change:(patch:Partial<CompletionContextState>)=>{context={...context,...patch};notify();},blur:()=>{focused=false;},restart:()=>{runtime={generation:{},ready:true};context={...context,lspRuntime:runtime.generation};notify();}};
}
it("requests a bound continuation snapshot and keeps versioned ESCAPE after late metadata",async()=>{
 const f=fixture(false,"clickhouse");f.change({analysisToken:"pattern-26-6"});let finish!:(value:unknown)=>void;f.columnLoad.mockImplementation(()=>new Promise(done=>{finish=done;}));
 f.client.getCompletionSnapshot.mockResolvedValue({items:[],logicalContinuation:true,patternEscape:true});
 const condition="/*😀*/ LOWER('x') LIKE 'x' ",work=f.session.request({condition,cursorOffset:condition.length,manual:true});
 await vi.waitFor(()=>expect(f.client.getCompletionSnapshot).toHaveBeenCalled());
 await vi.waitFor(()=>expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="ESCAPE")).toBe(true));
 finish([{name:"old_field",data_type:"text"}]);await work;expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="ESCAPE")).toBe(true);expect(f.client.getCompletions).not.toHaveBeenCalled();await f.session.dispose();
});
it("withdraws an accepted local keyword after a bound denial and keeps it withdrawn after late columns",async()=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"pattern-denied"});let finish!:(value:unknown)=>void,columns!:(value:unknown)=>void;
 f.client.getCompletionSnapshot.mockImplementation(()=>new Promise(done=>{finish=done;}));f.columnLoad.mockImplementation(()=>new Promise(done=>{columns=done;}));
 const condition="'x' LIKE 'x' ",work=f.session.request({condition,cursorOffset:condition.length,manual:true});await vi.waitFor(()=>expect(f.client.getCompletionSnapshot).toHaveBeenCalled());
 const old=f.publish.mock.lastCall?.[0].find((item:any)=>item.label==="ESCAPE");expect(old).toBeDefined();expect(f.session.isCandidateCurrent(old)).toBe(true);
 finish({items:[],logicalContinuation:true,patternEscape:false});await vi.waitFor(()=>expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="ESCAPE")).toBe(false));expect(f.session.isCandidateCurrent(old)).toBe(false);
 columns([{name:"old_field",data_type:"text"}]);await work;expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="ESCAPE")).toBe(false);await f.session.dispose();
});
it("cannot restore a late optional ESCAPE grant after document-only recovery",async()=>{
 const f=fixture(false,"clickhouse");f.change({analysisToken:"pattern-old"});let finish!:(value:unknown)=>void;f.client.getCompletionSnapshot.mockImplementation(()=>new Promise(done=>{finish=done;}));f.client.getDocumentCompletions.mockResolvedValue({items:[],isIncomplete:false,resolveProvider:false,logicalContinuation:true});
 const condition="'x' LIKE 'x' ",work=f.session.request({condition,cursorOffset:condition.length,manual:true});await vi.waitFor(()=>expect(f.client.getCompletionSnapshot).toHaveBeenCalled());
 f.change({lspAllowed:false,metadataAllowed:false,generation:{}});await vi.waitFor(()=>expect(f.client.getDocumentCompletions).toHaveBeenCalled());finish({items:[{label:"ESCAPE",kind:14}],logicalContinuation:true,patternEscape:true});await work;
 expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="ESCAPE")).toBe(false);await f.session.dispose();
});
it("applies a bound escape role when delayed metadata republishes the same input",async()=>{
 const f=fixture(false,"clickhouse");f.change({analysisToken:"escape-confirmed"});let finish!:(value:unknown)=>void;f.columnLoad.mockImplementation(()=>new Promise(done=>{finish=done;}));
 f.client.getCompletionSnapshot.mockResolvedValue({items:[{label:"'#'",kind:12,insertText:"'#'"},{label:"''",kind:15,insertText:"''"}],valueType:"String",valueRole:"pattern-escape"});
 const condition="'oxide_1' LIKE 'oxide#_1' ESCAPE ",work=f.session.request({condition,cursorOffset:condition.length,manual:true});
 await vi.waitFor(()=>expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="'#'")).toBe(true));
 finish([{name:"old_field",data_type:"text"}]);await work;const labels=f.publish.mock.lastCall?.[0].map((item:any)=>item.label);expect(labels).toContain("'#'");expect(labels).not.toContain("''");expect(labels).not.toContain("TRUE");await f.session.dispose();
});
it("rejects a late versioned escape role after recovery to an unknown document profile",async()=>{
 const f=fixture(false,"clickhouse");f.change({analysisToken:"escape-old"});let finish!:(value:unknown)=>void;f.client.getCompletionSnapshot.mockImplementation(()=>new Promise(done=>{finish=done;}));f.client.getDocumentCompletions.mockResolvedValue({items:[],isIncomplete:false,resolveProvider:false});
 const condition="'x' LIKE 'x' ESCAPE ",work=f.session.request({condition,cursorOffset:condition.length,manual:true});await vi.waitFor(()=>expect(f.client.getCompletionSnapshot).toHaveBeenCalled());
 f.change({lspAllowed:false,metadataAllowed:false,generation:{}});await vi.waitFor(()=>expect(f.client.getDocumentCompletions).toHaveBeenCalled());finish({items:[{label:"'#'",kind:12,insertText:"'#'"}],valueType:"String",valueRole:"pattern-escape"});await work;
 expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="'#'")).toBe(false);await f.session.dispose();
});
it("encodes independent owners and a source URI without sharing wire identity",()=>{
 const source="oxide://query/a.mysql.sql";const a=whereCompletionDocumentUri(source,":a:","sqlserver"),b=whereCompletionDocumentUri(source,":b:","sqlserver");expect(a).not.toBe(b);expect(a).not.toBe(source);expect(new URL(a).searchParams.get("source")).toBe(source);
});
it("uses exact acknowledged version, explicit dialect, preferences and capability quoting for document-only semantics",async()=>{
 const f=fixture(true);await f.session.request(f.interaction);expect(f.client.getCompletions).not.toHaveBeenCalled();expect(f.client.didOpen.mock.calls[0]?.[1]).toContain("[app].[users]");expect(f.client.getDocumentCompletions).toHaveBeenCalledWith(expect.objectContaining({version:1,dialect:"sqlserver",preferences:{keywordCase:"upper",functionCase:"lower",tableAlias:"none"}}),expect.anything());expect(f.publish.mock.calls.flat(2).map(item=>item.label)).not.toContain("old_field");await f.session.dispose();
});
it.each(["available","lspAllowed","metadataAllowed"] as const)("does not borrow grid metadata when %s is withdrawn",async key=>{
 const f=fixture(true);f.change({[key]:false});await f.session.request({...f.interaction,condition:"old",cursorOffset:3});expect(f.publish.mock.calls.flat(2).map(item=>item.label)).not.toContain("old_field");await f.session.dispose();
});
it("cancels the actual transport token and rejects its late response",async()=>{
 const f=fixture();let resolve!:(items:any[])=>void;const cancelled=vi.fn();f.client.getCompletions.mockImplementation(async(...args:any[])=>{args[4].onCancellationRequested(cancelled);return new Promise<any[]>(done=>{resolve=done;});});
 const pending=f.session.request(f.interaction);await vi.waitFor(()=>expect(f.client.getCompletions).toHaveBeenCalled());f.session.cancel();resolve([{label:"expired"}]);await pending;expect(cancelled).toHaveBeenCalledOnce();expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="expired")).toBe(false);await f.session.dispose();
});
it("invalidates candidate acceptance synchronously and recovers the same interaction locally",async()=>{
 const f=fixture();f.client.getCompletions.mockResolvedValue([{label:"physical",insertText:"physical"}] as never);await f.session.request(f.interaction);const old=f.publish.mock.lastCall![0][0];expect(f.session.isCandidateCurrent(old)).toBe(true);
 f.change({lspAllowed:false,metadataAllowed:false,generation:{}});expect(f.session.isCandidateCurrent(old)).toBe(false);await vi.waitFor(()=>expect(f.client.getDocumentCompletions).toHaveBeenCalled());await f.session.dispose();
});
it("does not reopen an interaction after blur or cancellation on later metadata recovery",async()=>{
 const f=fixture(true);await f.session.request(f.interaction);f.session.cancel();f.blur();f.change({lspAllowed:true,metadataAllowed:true,generation:{}});expect(f.client.getCompletions).not.toHaveBeenCalled();await f.session.dispose();
});
it("does not re-authorize an unchanged grid snapshot when a new physical receipt arrives",async()=>{
 const f=fixture();await f.session.request(f.interaction);f.columnLoad.mockResolvedValue([{name:"new_field",data_type:"text",is_nullable:true,is_primary_key:false}]);f.change({analysisToken:"new",generation:{}});await f.session.request({...f.interaction,condition:"old",cursorOffset:3});expect(f.publish.mock.calls.flat(2).map(item=>item.label)).not.toContain("old_field");await f.session.dispose();
});
it("opens again in the replacement process and closes only its own URI",async()=>{
 const f=fixture(true);await f.session.request(f.interaction);f.restart();await vi.waitFor(()=>expect(f.client.didOpen).toHaveBeenCalledTimes(2));await f.session.dispose();expect(f.client.didClose.mock.calls.every(([uri])=>uri.startsWith("oxide://where/"))).toBe(true);
});
it("retries after a failed didOpen without pretending the shadow was committed",async()=>{
 const f=fixture(true);f.client.didOpen.mockRejectedValueOnce(new Error("transient"));await f.session.request(f.interaction);expect(f.client.getDocumentCompletions).not.toHaveBeenCalled();await f.session.request(f.interaction);expect(f.client.didOpen).toHaveBeenCalledTimes(2);expect(f.client.getDocumentCompletions).toHaveBeenCalledOnce();await f.session.dispose();
});
it("publishes driver fallback while a separate LSP response is still pending",async()=>{
 const f=fixture();let resolve!:(items:any[])=>void;f.client.getCompletions.mockImplementation(()=>new Promise<any[]>(done=>{resolve=done;}));
 const work=f.session.request({condition:"old",cursorOffset:3,manual:true});await vi.waitFor(()=>expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="old_field")).toBe(true));resolve([]);await work;await f.session.dispose();
});
it("retains the mapped LSP edit when delayed metadata republishes the list",async()=>{
 const f=fixture();let resolve!:(value:any)=>void;f.columnLoad.mockReturnValueOnce(new Promise(done=>{resolve=done;}));
 const condition="oldSuffix > 0",document=buildWhereCompletionDocument({condition,cursorOffset:3,driver:"mysql",identifierQuote:"[",schema:"app",table:"users"});
 f.client.getCompletions.mockResolvedValue([{label:"remote_field",textEdit:{newText:"remote_field",range:{start:{line:0,character:document.conditionStart},end:{line:0,character:document.conditionStart+9}}}}] as never);
 const work=f.session.request({condition,cursorOffset:3,manual:true});await vi.waitFor(()=>expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="remote_field")).toBe(true));resolve([{name:"old_field",data_type:"integer"}]);await work;
 expect(f.publish.mock.lastCall?.[0].find((item:any)=>item.label==="remote_field")?.replacementRange).toEqual({start:0,end:9});await f.session.dispose();
});
it("publishes asynchronous pinyin comment matches through the authorized production session",async()=>{
 const f=fixture();f.columnLoad.mockResolvedValue([{name:"customer_name",data_type:"text",comment:"用户名称"}] as never);
 await f.session.request({condition:"yhmcSuffix > 0",cursorOffset:4,manual:true});
 const item=f.publish.mock.lastCall?.[0].find((value:any)=>value.label==="customer_name");expect(item?.insertText).toBe("customer_name");expect(item?.detail).toContain("用户名称");expect(f.session.isCandidateCurrent(item)).toBe(true);await f.session.dispose();
});
it("drops a pending pinyin search when the interaction is cancelled",async()=>{
 const f=fixture();f.columnLoad.mockResolvedValue([{name:"用户名称",data_type:"text"}] as never);const work=f.session.request({condition:"yhmc",cursorOffset:4,manual:true});f.session.cancel();await work;
 expect(f.publish.mock.calls.flat(2).some((value:any)=>value.label==="用户名称")).toBe(false);await f.session.dispose();
});
it("refilters a remote continuation after delayed authoritative types and revokes the old candidate",async()=>{
 const f=fixture();let resolve!:(value:any)=>void;f.columnLoad.mockReturnValueOnce(new Promise(done=>{resolve=done;}));
 f.client.getCompletions.mockResolvedValue([{label:"AND",kind:14,insertText:"AND "},{label:"=",kind:24,insertText:"= "}] as never);
 const work=f.session.request({condition:"COALESCE(old_field, '') ",cursorOffset:24,manual:true});
 await vi.waitFor(()=>expect(f.publish.mock.lastCall?.[0].some((value:any)=>value.label==="AND")).toBe(true));
 const old=f.publish.mock.lastCall?.[0].find((value:any)=>value.label==="AND");expect(f.session.isCandidateCurrent(old)).toBe(true);
 resolve([{name:"old_field",data_type:"text"}]);await work;
 expect(f.publish.mock.lastCall?.[0].some((value:any)=>value.label==="AND")).toBe(false);expect(f.session.isCandidateCurrent(old)).toBe(false);
 expect(f.publish.mock.lastCall?.[0].some((value:any)=>value.label==="=")).toBe(true);await f.session.dispose();
});
it("keeps an unchanged semantic candidate acceptable across same-interaction publications",async()=>{
 const f=fixture();let resolve!:(value:any)=>void;f.columnLoad.mockReturnValueOnce(new Promise(done=>{resolve=done;}));f.client.getCompletions.mockResolvedValue([{label:"=",kind:24,insertText:"= "}] as never);
 const work=f.session.request({condition:"LOWER(old_field) ",cursorOffset:17,manual:true});
 const original=f.publish.mock.calls[0]?.[0].find((item:any)=>item.label==="=");expect(original).toBeDefined();
 await vi.waitFor(()=>expect(f.client.getCompletions).toHaveBeenCalled());resolve([{name:"old_field",data_type:"text"}]);await work;
 expect(f.session.isCandidateCurrent(original)).toBe(true);await f.session.dispose();
});
it.each(["postgres","mysql","sqlserver","sqlite","duckdb","clickhouse","hive","argo"] as const)("maps UTF-16 multiline replacement bounds for %s nested predicates",driver=>{
 const condition="EXISTS (SELECT 1\n WHERE '😀' = '😀' AND localSuffix = 1)";const start=condition.indexOf("localSuffix");const document=buildWhereCompletionDocument({condition,cursorOffset:start+3,driver,schema:"app",table:"users"});const before=document.text.slice(0,document.conditionStart+start),line=before.split("\n").length-1,character=before.split("\n").pop()!.length;
 const items=mergeWhereCompletionCandidates([],[{label:"local_id",textEdit:{newText:"local_id",range:{start:{line,character},end:{line,character:character+11}}}}],{document,condition});expect(items[0]?.replacementRange).toEqual({start,end:start+11});
});
it("rejects prefix, external and out-of-condition edits instead of partially applying them",()=>{
 const condition="valSuffix",document=buildWhereCompletionDocument({condition,cursorOffset:3,driver:"postgres",table:"users"});
 const items=mergeWhereCompletionCandidates([],[{label:"prefix",textEdit:{newText:"bad",range:{start:{line:0,character:0},end:{line:0,character:6}}}},{label:"external",additionalTextEdits:[{newText:"bad",range:{start:{line:0,character:0},end:{line:0,character:0}}}]},{label:"outside",textEdit:{newText:"bad",range:{start:{line:99,character:0},end:{line:99,character:3}}}}],{document,condition});expect(items).toEqual([]);
});

const keywordContract={slot:"is",allowedKeywords:["NULL","NOT NULL","DISTINCT FROM","NOT DISTINCT FROM"]};
it("revokes a previously offered logical action when backend type knowledge contradicts a local function assumption",async()=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"operator-live"});f.columnLoad.mockResolvedValue([{name:"old_field",data_type:"boolean"}] as never);let finish!:(value:unknown)=>void;f.client.getCompletionSnapshot.mockImplementation(()=>new Promise(done=>{finish=done;}));
 const condition="MIN(old_field) ";const work=f.session.request({condition,cursorOffset:condition.length,manual:true});await vi.waitFor(()=>expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="AND")).toBe(true));const old=f.publish.mock.lastCall?.[0].find((item:any)=>item.label==="AND");expect(f.session.isCandidateCurrent(old)).toBe(true);
 finish({items:[],isIncomplete:false,resolveProvider:false,logicalContinuation:false});await work;expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="AND")).toBe(false);expect(f.session.isCandidateCurrent(old)).toBe(false);await f.session.dispose();
});
it("retains proven logical permission after delayed column search republishes",async()=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"operator-live"});let finish!:(columns:any)=>void;f.columnLoad.mockImplementation(()=>new Promise(done=>{finish=done;}));f.client.getCompletionSnapshot.mockResolvedValue({items:[],isIncomplete:false,resolveProvider:false,logicalContinuation:true} as never);
 const condition="LOWER(old_field) ";const work=f.session.request({condition,cursorOffset:condition.length,manual:true});await vi.waitFor(()=>expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="AND")).toBe(true));const old=f.publish.mock.lastCall?.[0].find((item:any)=>item.label==="AND");finish([{name:"old_field",data_type:"text"}]);await work;
 expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="AND")).toBe(true);expect(f.session.isCandidateCurrent(old)).toBe(true);await f.session.dispose();
});
it("does not let an old logical restriction prune an independently recovered document context",async()=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"operator-live"});let finish!:(value:unknown)=>void;f.client.getCompletionSnapshot.mockImplementation(()=>new Promise(done=>{finish=done;}));
 const condition="semantic_result() ";const work=f.session.request({condition,cursorOffset:condition.length,manual:true});await vi.waitFor(()=>expect(f.client.getCompletionSnapshot).toHaveBeenCalled());
 f.client.getDocumentCompletions.mockResolvedValue({items:[{label:"AND",kind:14}],isIncomplete:false,resolveProvider:false});f.change({lspAllowed:false,metadataAllowed:false,generation:{}});await vi.waitFor(()=>expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="AND")).toBe(true));finish({items:[],isIncomplete:false,resolveProvider:false,logicalContinuation:false});await work;
 expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="AND")).toBe(true);await f.session.dispose();
});
it("withdraws logical operators after a confirmed nonpredicate function result",async()=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"operator-integer"});
 const items=[{label:"AND",kind:14},{label:"OR",kind:14},{label:"=",kind:24}];f.client.getCompletions.mockResolvedValue(items as never);f.client.getCompletionSnapshot.mockResolvedValue({items,isIncomplete:false,resolveProvider:false,logicalContinuation:false} as never);
 const condition="semantic_result() ";await f.session.request({condition,cursorOffset:condition.length,manual:true});expect(f.publish.mock.lastCall?.[0].map((item:any)=>item.label)).not.toContain("AND");await f.session.dispose();
});
it("adds logical operators from positive backend knowledge even without remote candidates",async()=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"operator-boolean"});f.client.getCompletionSnapshot.mockResolvedValue({items:[],isIncomplete:false,resolveProvider:false,logicalContinuation:true} as never);
 const condition="semantic_result() ";await f.session.request({condition,cursorOffset:condition.length,manual:true});expect(f.publish.mock.lastCall?.[0].map((item:any)=>item.label)).toContain("AND");await f.session.dispose();
});
it("rejects a late numeric type after the same input recovers document-only unknown knowledge",async()=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"value-live"});let finish!:(value:unknown)=>void;f.client.getCompletionSnapshot.mockImplementation(()=>new Promise(done=>{finish=done;}));
 const condition="semantic_result() = ";const work=f.session.request({condition,cursorOffset:condition.length,manual:true});await vi.waitFor(()=>expect(f.client.getCompletionSnapshot).toHaveBeenCalled());
 f.client.getDocumentCompletions.mockResolvedValue({items:[],isIncomplete:false,resolveProvider:false});f.change({lspAllowed:false,metadataAllowed:false,generation:{}});await vi.waitFor(()=>expect(f.client.getDocumentCompletions).toHaveBeenCalled());
 finish({items:[],isIncomplete:false,resolveProvider:false,valueType:"integer"});await work;expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="TRUE")).toBe(true);await f.session.dispose();
});
it("keeps a bound value type across delayed column refresh and revokes the old truth action",async()=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"value-live"});let finish!:(columns:any)=>void;f.columnLoad.mockImplementation(()=>new Promise(done=>{finish=done;}));
 f.client.getCompletionSnapshot.mockResolvedValue({items:[],isIncomplete:false,resolveProvider:false,valueType:"pg_catalog.int4"} as never);
 f.publish.mockClear();
 const condition="semantic_result() = ";const work=f.session.request({condition,cursorOffset:condition.length,manual:true});const old=f.publish.mock.calls[0]?.[0].find((item:any)=>item.label==="TRUE");expect(old).toBeDefined();
 await vi.waitFor(()=>expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="0")).toBe(true));finish([{name:"old_field",data_type:"text"}]);await work;
 expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="TRUE")).toBe(false);expect(f.session.isCandidateCurrent(old)).toBe(false);await f.session.dispose();
});
it.each([false,true])("uses a positively inferred comparison value type in the production session (document only=%s)",async local=>{
 const f=fixture(local,"postgres");f.change({analysisToken:"value-type"});
 const response={items:[],isIncomplete:false,resolveProvider:false,valueType:"pg_catalog.int4"};
 f.client.getCompletionSnapshot.mockResolvedValue(response as never);f.client.getDocumentCompletions.mockResolvedValue(response as never);
 const condition="semantic_result() = ";await f.session.request({condition,cursorOffset:condition.length,manual:true});
 const labels=f.publish.mock.lastCall?.[0].map((item:any)=>item.label);expect(labels).toContain("0");expect(labels).not.toContain("TRUE");await f.session.dispose();
});
const nullResult={items:[{label:"NULL",kind:14}],isIncomplete:false,resolveProvider:false,constraints:keywordContract};
it("keeps local text knowledge when backend keyword constraints have no proven Boolean type",async()=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"confirmed"});f.client.getCompletionSnapshot.mockResolvedValue({...nullResult,items:[{label:"TRUE",kind:14}],constraints:{slot:"is",allowedKeywords:["NULL","TRUE"]}});
 const condition="TRIM('x') IS ";await f.session.request({condition,cursorOffset:condition.length,manual:true});expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="TRUE")).toBe(false);await f.session.dispose();
});
it("withdraws an initially valid local truth candidate after the bound catalog contract arrives",async()=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"confirmed"});let finish!:(value:unknown)=>void;f.client.getCompletionSnapshot.mockImplementation(()=>new Promise(done=>{finish=done;}));
 const condition="custom_result() IS ";const work=f.session.request({condition,cursorOffset:condition.length,manual:true});await vi.waitFor(()=>expect(f.client.getCompletionSnapshot).toHaveBeenCalled());
 const old=f.publish.mock.lastCall?.[0].find((item:any)=>item.label==="TRUE");expect(old).toBeDefined();expect(f.session.isCandidateCurrent(old)).toBe(true);
 finish(nullResult);await work;expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="TRUE")).toBe(false);expect(f.session.isCandidateCurrent(old)).toBe(false);
 expect(f.client.getCompletionSnapshot).toHaveBeenCalledWith(expect.objectContaining({version:1,dialect:"postgres",analysisToken:"confirmed"}),expect.anything());expect(f.client.getCompletions).not.toHaveBeenCalled();await f.session.dispose();
});
it("does not restore a forbidden local keyword when delayed driver metadata republishes",async()=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"confirmed"});let finish!:(value:unknown)=>void;f.columnLoad.mockImplementation(()=>new Promise(done=>{finish=done;}));f.client.getCompletionSnapshot.mockResolvedValue(nullResult);
 const condition="custom_result() IS ";const work=f.session.request({condition,cursorOffset:condition.length,manual:true});
 await vi.waitFor(()=>expect(f.publish.mock.lastCall?.[0].map((item:any)=>item.label)).toEqual(expect.arrayContaining(["NULL"])));await vi.waitFor(()=>expect(f.client.getCompletionSnapshot).toHaveBeenCalled());
 finish([{name:"old_field",data_type:"text"}]);await work;expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="TRUE")).toBe(false);await f.session.dispose();
});
it("lets a confirmed backend Boolean result override a local builtin text assumption",async()=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"confirmed"});f.client.getCompletionSnapshot.mockResolvedValue({...nullResult,items:[{label:"TRUE",kind:14}],constraints:{slot:"is",allowedKeywords:["NULL","TRUE"],truthTests:true}});
 const condition="LOWER('x') IS ";await f.session.request({condition,cursorOffset:condition.length,manual:true});expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="TRUE")).toBe(true);await f.session.dispose();
});
it.each([undefined,null])("does not infer negative type knowledge from an absent snapshot contract %s",async result=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"confirmed"});f.client.getCompletionSnapshot.mockResolvedValue(result===null?null:{...nullResult,constraints:undefined,isIncomplete:true});
 const condition="custom_result() IS ";await f.session.request({condition,cursorOffset:condition.length,manual:true});expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="TRUE")).toBe(true);await f.session.dispose();
});
it("applies document-local fixed scalar knowledge without calling the catalog endpoint",async()=>{
 const f=fixture(true,"postgres");f.client.getDocumentCompletions.mockResolvedValue(nullResult);
 const condition="STRPOS('a','b') IS ";await f.session.request({condition,cursorOffset:condition.length,manual:true});expect(f.client.getCompletionSnapshot).not.toHaveBeenCalled();expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="TRUE")).toBe(false);await f.session.dispose();
});
it("rejects an old catalog contract after the same interaction recovers document-only",async()=>{
 const f=fixture(false,"postgres");f.change({analysisToken:"confirmed"});let finish!:(value:unknown)=>void;f.client.getCompletionSnapshot.mockImplementation(()=>new Promise(done=>{finish=done;}));
 const condition="custom_result() IS ";const work=f.session.request({condition,cursorOffset:condition.length,manual:true});await vi.waitFor(()=>expect(f.client.getCompletionSnapshot).toHaveBeenCalled());
 f.change({lspAllowed:false,metadataAllowed:false,generation:{}});await vi.waitFor(()=>expect(f.client.getDocumentCompletions).toHaveBeenCalled());finish(nullResult);await work;
 expect(f.publish.mock.lastCall?.[0].some((item:any)=>item.label==="TRUE")).toBe(true);await f.session.dispose();
});
