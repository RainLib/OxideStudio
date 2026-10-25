/** @vitest-environment happy-dom */
import {act,StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {LspClient} from "@/services/lsp/client";
import {defaultDatabaseCapabilities} from "@/lib/databaseDialect";
import {useTabStore} from "@/store/useTabStore";
import {useProjectStore} from "@/store/useProjectStore";
import type {FileQuerySession} from "@/services/tauri/file-query.service";
import {useFileQueryIntelligence} from "./useFileQueryIntelligence";
const api=vi.hoisted(()=>({runtime:null as any,invoke:vi.fn(),listen:vi.fn()}));
vi.mock("@/hooks/useLspClient",()=>({useLspClient:()=>api.runtime}));
vi.mock("@tauri-apps/api/core",()=>({invoke:api.invoke}));
vi.mock("@tauri-apps/api/event",()=>({listen:api.listen}));
const cleanups:Array<()=>Promise<void>>=[];
beforeEach(()=>{vi.clearAllMocks();api.invoke.mockResolvedValue("initialized");api.listen.mockResolvedValue(()=>{});(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;});
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();});
function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
async function fixture(options:{pendingConfig?:boolean;pendingConfirmation?:boolean;strict?:boolean}={}){
  useTabStore.setState({tabs:[],activeTabId:null});useProjectStore.setState({activeProjectId:"file-project"});
  const session:FileQuerySession={id:"a1e2aab5-77bb-454b-9407-d2741b25241f",projectId:"file-project",fileName:"data.csv",format:"csv",sourceBytes:12,driverId:"sqlite",packageVersion:"0.1.0",languageId:"sqlite",initialSql:"SELECT re FROM data",csvHeader:"auto",capabilities:defaultDatabaseCapabilities("sqlite")};
  const id=useTabStore.getState().createTab("query","data.csv",session.initialSql,{fileQuery:{source:{kind:"picker",projectId:session.projectId},session,schema:[{name:"revenue",data_type:"BIGINT"}],driverId:"sqlite",packageVersion:"0.1.0",csvHeader:"auto"}});
  const uri="oxide-file-query://file-project/"+id+".sql",client=new LspClient("file-query:hook");await client.initialize("/fixture/sql-lsp");
  const notifications:Array<(event:any)=>void>=[];api.listen.mockImplementation((_event,listener)=>{notifications.push(listener);return Promise.resolve(()=>{});});
  const configuration=deferred(),send=vi.fn().mockResolvedValue(undefined);if(options.pendingConfig)send.mockImplementationOnce(()=>configuration.promise);
  const confirmation=deferred<boolean>(),confirm=vi.fn().mockResolvedValue(true);if(options.pendingConfirmation)confirm.mockImplementationOnce(()=>confirmation.promise);
  client.confirmAnalysisConfiguration=confirm;client.updateConfiguration=send;client.didOpen=vi.fn().mockResolvedValue(undefined);client.didChange=vi.fn().mockResolvedValue(undefined);client.didClose=vi.fn().mockResolvedValue(undefined);
  client.getCompletionList=vi.fn().mockResolvedValue({items:[{label:"revenue",kind:5}],isIncomplete:false});client.formatDocument=vi.fn().mockResolvedValue([{range:{start:{line:0,character:0},end:{line:0,character:19}},newText:"SELECT revenue FROM data"}]);
  client.getDiagnosticSnapshot=vi.fn().mockImplementation(async request=>({...request,diagnostics:[]}));
  client.getHover=vi.fn().mockResolvedValue({contents:"revenue BIGINT"});
  client.getDocumentSemantics=vi.fn().mockResolvedValue({value:{contents:"local_count INTEGER"}});
  client.getDocumentCompletions=vi.fn().mockResolvedValue({items:[{label:"local_id",kind:5,detail:"Column: local_id (integer)"}],isIncomplete:false,resolveProvider:false});
  client.getDocumentStructure=vi.fn().mockResolvedValue({items:[{name:"local_cte",kind:13,range:{start:{line:0,character:0},end:{line:0,character:5}},selectionRange:{start:{line:0,character:0},end:{line:0,character:5}}}]});
  api.runtime={client,isReady:true,status:"ready",error:null,sessionKey:client.getSessionKey(),profile:{documentLanguageId:"sql",languageId:"sqlite",serverDialect:"sqlite"}};
  let text=session.initialSql,version=1,listVisible=false,control!:ReturnType<typeof useFileQueryIntelligence>;
  class Range {constructor(public startLineNumber:number,public startColumn:number,public endLineNumber:number,public endColumn:number){}}
  const model={uri:{toString:()=>uri},getValue:()=>text,getVersionId:()=>version,isDisposed:()=>false,getValueLength:()=>text.length,getLineContent:()=>text,
    getPositionAt:(offset:number)=>({lineNumber:1,column:offset+1}),getOffsetAt:({column}:{column:number})=>column-1,getWordUntilPosition:()=>({word:"re",startColumn:8,endColumn:10}),getWordAtPosition:()=>({word:"re",startColumn:8,endColumn:10})};
  const providers=new Map<string,any>(),markers=new Map<string,any[]>();
  const languages=new Proxy({CompletionItemKind:{Field:4,Text:0,Keyword:17},InlayHintKind:{Parameter:2},CompletionItemInsertTextRule:{None:0,InsertAsSnippet:4}} as any,{get:(target,key:string)=>key.startsWith("register")?(_language:string,provider:any)=>{providers.set(key,provider);return {dispose:vi.fn()};}:target[key]});
  const monaco={Range,languages,Uri:{parse:(uri:string)=>uri},MarkerSeverity:{Error:8,Warning:4,Info:2,Hint:1},editor:{getModel:()=>model,setModelMarkers:(_model:any,owner:string,value:any[])=>markers.set(owner,value)}};
  const editor={getModel:()=>model,getPosition:()=>({lineNumber:1,column:10}),hasTextFocus:()=>true,getDomNode:()=>({querySelector:()=>listVisible?{}:null}),trigger:vi.fn((_source,command)=>{if(command==="hideSuggestWidget")listVisible=false;})};
  function Probe(){const tab=useTabStore(state=>state.tabs.find(value=>value.id===id));if(!tab)return null;control=useFileQueryIntelligence(tab,uri,monaco as any,editor);return null;}
  const root=createRoot(document.createElement("div"));await act(async()=>root.render(options.strict?<StrictMode><Probe/></StrictMode>:<Probe/>));let mounted=true;
  cleanups.push(async()=>{if(mounted){mounted=false;await act(async()=>root.unmount());}});
  const request=()=>providers.get("registerCompletionItemProvider").provideCompletionItems(model,{lineNumber:1,column:10},{},{isCancellationRequested:false});
  const change=async(patch:Record<string,unknown>)=>act(async()=>{useTabStore.setState(state=>({tabs:state.tabs.map(tab=>tab.id===id?{...tab,fileQuery:{...tab.fileQuery!,...patch}}:tab)}));await flush();});
  return {id,uri,client,send,configuration,confirm,confirmation,providers,markers,model,editor,request,change,control:()=>control,
    visible:()=>{listVisible=true;},edit:()=>{text="SELECT region FROM data";version++;},flush:()=>act(flush),
    emit:()=>{for(const listener of notifications)listener({payload:{sessionKey:client.getSessionKey(),method:"textDocument/publishDiagnostics",params:{uri,version:1,oxideAnalysisToken:send.mock.calls[0]![0].oxideAnalysisToken,diagnostics:[{message:"Ambiguous field",code:"OXIDE004",range:{start:{line:0,character:7},end:{line:0,character:9}}}]}}});},
    project:()=>act(async()=>{useProjectStore.setState({activeProjectId:"different"});await flush();})};
}
it("keeps local candidates while waiting for the exact file configuration before physical completions",async()=>{
  const f=await fixture({pendingConfig:true});expect(f.control().ready).toBe(false);expect((await f.request()).suggestions[0].label).toBe("local_id");expect(f.client.getCompletionList).not.toHaveBeenCalled();
  await act(async()=>{f.configuration.resolve();await flush();});expect(f.control().ready).toBe(true);expect((await f.request()).suggestions[0].label).toBe("revenue");
  expect(f.client.didClose).not.toHaveBeenCalled();expect(f.send.mock.calls[0]![0].oxideAnalysisToken).toBe(f.control().getSemanticContext().analysisToken);
});
it("revokes file metadata synchronously before a schema-change render",async()=>{
  const f=await fixture();f.visible();await act(async()=>{
    useTabStore.setState(state=>({tabs:state.tabs.map(tab=>({...tab,fileQuery:{...tab.fileQuery!,schema:[{name:"region",data_type:"TEXT"}]}}))}));
    expect(f.control().getSemanticContext().metadataAllowed).toBe(false);expect(f.editor.trigger).toHaveBeenCalledWith("oxide.completionContext","hideSuggestWidget",{});await flush();
  });
});
it("does not grant an older configuration while its same-session replacement is pending",async()=>{
  const f=await fixture({pendingConfig:true}),second=deferred();f.send.mockImplementationOnce(()=>second.promise);await f.change({schema:[{name:"region",data_type:"TEXT"}]});
  await act(async()=>{f.configuration.resolve();await flush();});expect(f.control().ready).toBe(false);await act(async()=>{second.resolve();await flush();});
  expect(f.control().ready).toBe(true);expect(f.control().getSemanticContext().analysisToken).toBe(f.send.mock.calls[1]![0].oxideAnalysisToken);
});
it("does not close the file URI or resend schema for SQL and result updates",async()=>{
  const f=await fixture();await act(async()=>{useTabStore.getState().updateTabSql(f.id,"SELECT 2 FROM data");await flush();});expect(f.send).toHaveBeenCalledOnce();expect(f.client.didClose).not.toHaveBeenCalled();
});
it("drops a late completion after replacing the schema without editing SQL",async()=>{
  const f=await fixture(),pending=deferred<any>();vi.mocked(f.client.getCompletionList).mockReturnValue(pending.promise);const request=f.request();await f.flush();expect(f.client.getCompletionList).toHaveBeenCalledOnce();await f.change({schema:[{name:"region",data_type:"TEXT"}]});pending.resolve({items:[{label:"revenue",kind:5}],isIncomplete:false});expect((await request).suggestions).toEqual([]);
});
it("does not issue a completion RPC after a stale document sync finishes",async()=>{
  const f=await fixture(),pending=deferred();vi.mocked(f.client.didChange).mockReturnValue(pending.promise);f.edit();const request=f.request();await f.flush();await f.change({session:null});pending.resolve();expect((await request).suggestions).toEqual([]);expect(f.client.getCompletionList).not.toHaveBeenCalled();
});
it("does not apply late format edits after the file session closes",async()=>{
  const f=await fixture(),pending=deferred<any[]>();vi.mocked(f.client.formatDocument).mockReturnValue(pending.promise);const provider=f.providers.get("registerDocumentFormattingEditProvider"),request=provider.provideDocumentFormattingEdits(f.model,{tabSize:2,insertSpaces:true},{});
  await f.flush();expect(f.client.formatDocument).toHaveBeenCalledOnce();await f.change({session:null});pending.resolve([{range:{start:{line:0,character:0},end:{line:0,character:1}},newText:"OLD"}]);expect(await request).toEqual([]);expect(f.control().formatResultRef.current).toBeNull();
});
it("revokes a file grant on a project switch while retaining saved SQL",async()=>{
  const f=await fixture();await f.project();expect(f.control().ready).toBe(false);expect(f.control().getSemanticContext().metadataAllowed).toBe(false);expect(useTabStore.getState().tabs.find(value=>value.id===f.id)?.sql).toBe("SELECT re FROM data");
});
it("requires a fresh configuration and open after the same client restarts",async()=>{
  const f=await fixture(),before=f.send.mock.calls.length;await act(async()=>{f.client.markDisconnected();await flush();});expect(f.control().ready).toBe(false);
  await act(async()=>{await f.client.initialize("/fixture/sql-lsp");await flush();});expect(f.control().ready).toBe(true);expect(f.send.mock.calls.length).toBeGreaterThan(before);expect(f.client.didOpen).toHaveBeenCalledTimes(2);
});
it("remains usable under StrictMode effect cleanup and recreation",async()=>{
  const f=await fixture({strict:true});await f.flush();expect(f.control().ready).toBe(true);expect((await f.request()).suggestions[0].label).toBe("revenue");
});

it("routes diagnostics to the explicit file tab and clears markers/problems on source invalidation",async()=>{
  const f=await fixture();await act(async()=>f.emit());expect(f.markers.get("sql-lsp")).toHaveLength(1);expect(useTabStore.getState().tabs.find(value=>value.id===f.id)?.lspDiagnostics).toHaveLength(1);
  await f.change({session:null});expect(f.markers.get("sql-lsp")).toEqual([]);expect(useTabStore.getState().tabs.find(value=>value.id===f.id)?.lspDiagnostics).toEqual([]);await act(async()=>f.emit());expect(f.markers.get("sql-lsp")).toEqual([]);
});

it("keeps providers unavailable until the server confirms its committed configuration",async()=>{
  const f=await fixture({pendingConfirmation:true});expect(f.send).toHaveBeenCalledOnce();expect(f.confirm).toHaveBeenCalledOnce();expect(f.control().ready).toBe(false);
  expect(f.control().isFormatReady()).toBe(false);expect((await f.request()).suggestions[0].label).toBe("local_id");expect(f.client.getCompletionList).not.toHaveBeenCalled();
  await act(async()=>{f.confirmation.resolve(true);await flush();});expect(f.control().ready).toBe(true);expect((await f.request()).suggestions[0].label).toBe("revenue");
});
it("reports rejected configuration confirmation without exposing metadata providers",async()=>{
  const f=await fixture({pendingConfirmation:true});await act(async()=>{f.confirmation.resolve(false);await flush();});expect(f.control().ready).toBe(false);
  expect(f.control().error).toContain("not been confirmed");expect(f.control().getSemanticContext().metadataAllowed).toBe(false);expect((await f.request()).suggestions[0].label).toBe("local_id");expect(f.client.getCompletionList).not.toHaveBeenCalled();
});
it("rejects a late confirmation after the source closes",async()=>{
  const f=await fixture({pendingConfirmation:true});await f.change({session:null});await act(async()=>{f.confirmation.resolve(true);await flush();});
  expect(f.control().ready).toBe(false);expect(f.control().getSemanticContext().analysisToken).toBeUndefined();expect((await f.request()).suggestions).toEqual([]);expect(f.client.getCompletionList).not.toHaveBeenCalled();
});

it("provides file-column hover through the acknowledged isolated LSP",async()=>{
  const f=await fixture(),provider=f.providers.get("registerHoverProvider");expect(provider).toBeDefined();
  expect(await provider.provideHover(f.model,{lineNumber:1,column:10},{})).toMatchObject({contents:[{value:"revenue BIGINT"}]});
  expect(f.client.getHover).toHaveBeenCalledWith(f.uri,0,9);expect(f.client.didOpen).toHaveBeenCalledOnce();
});
it.each(["pendingConfig","pendingConfirmation"] as const)("keeps document-local hover and outline during %s without granting physical candidates",async phase=>{
  const f=await fixture({[phase]:true}),hover=f.providers.get("registerHoverProvider"),outline=f.providers.get("registerDocumentSymbolProvider");
  expect(hover).toBeDefined();expect(outline).toBeDefined();expect(f.control().ready).toBe(false);expect((await f.request()).suggestions[0].label).toBe("local_id");expect(f.client.getCompletionList).not.toHaveBeenCalled();
  expect(await hover.provideHover(f.model,{lineNumber:1,column:10},{})).toMatchObject({contents:[{value:"local_count INTEGER"}]});
  expect(f.client.getDocumentSemantics).toHaveBeenCalledWith({uri:f.uri,version:1,dialect:"sqlite",operation:{kind:"hover",position:{line:0,character:9}}});expect(f.client.getHover).not.toHaveBeenCalled();
  expect(await outline.provideDocumentSymbols(f.model,{})).toMatchObject([{name:"local_cte"}]);expect(f.client.getDocumentStructure).toHaveBeenCalledWith({uri:f.uri,version:1,dialect:"sqlite",kind:"symbols"});
});
it("does not format using unconfirmed file preferences while document navigation is usable",async()=>{
  const f=await fixture({pendingConfirmation:true}),provider=f.providers.get("registerDocumentFormattingEditProvider");expect(provider).toBeDefined();
  expect(await provider.provideDocumentFormattingEdits(f.model,{tabSize:2,insertSpaces:true},{})).toEqual([]);expect(f.client.formatDocument).not.toHaveBeenCalled();expect(f.control().formatResultRef.current).toBeNull();
});
it("drops nonempty file hover after a source change without editing SQL",async()=>{
  const f=await fixture(),response=deferred<any>(),provider=f.providers.get("registerHoverProvider");expect(provider).toBeDefined();vi.mocked(f.client.getHover).mockReturnValue(response.promise);
  const pending=provider.provideHover(f.model,{lineNumber:1,column:10},{});await f.flush();expect(f.client.getHover).toHaveBeenCalledOnce();await f.change({schema:[{name:"region",data_type:"TEXT"}]});response.resolve({contents:"old BIGINT"});expect(await pending).toBeNull();
});
it("keeps local navigation after rejected metadata confirmation and withdraws it on project change",async()=>{
  const f=await fixture({pendingConfirmation:true});await act(async()=>{f.confirmation.resolve(false);await flush();});const provider=f.providers.get("registerHoverProvider");expect(provider).toBeDefined();
  expect(await provider.provideHover(f.model,{lineNumber:1,column:10},{})).not.toBeNull();await f.project();expect(await provider.provideHover(f.model,{lineNumber:1,column:10},{})).toBeNull();expect(f.client.getHover).not.toHaveBeenCalled();
});
it("binds local candidates to the exact version, profile and current explicit preferences",async()=>{
  const f=await fixture({pendingConfirmation:true});expect((await f.request()).suggestions[0].label).toBe("local_id");
  expect(f.client.getDocumentCompletions).toHaveBeenCalledWith({uri:f.uri,version:1,dialect:"sqlite",position:{line:0,character:9},preferences:{keywordCase:expect.any(String),functionCase:expect.any(String),tableAlias:expect.any(String)}},expect.anything());expect(f.client.getCompletionList).not.toHaveBeenCalled();
});
it.each(["schema","close","project","sql"])("rejects nonempty local candidates after %s changes",async reason=>{
  const f=await fixture({pendingConfirmation:true}),response=deferred<any>();vi.mocked(f.client.getDocumentCompletions).mockReturnValue(response.promise);
  const pending=f.request();await f.flush();expect(f.client.getDocumentCompletions).toHaveBeenCalledOnce();
  if(reason==="schema")await f.change({schema:[{name:"replacement",data_type:"TEXT"}]});else if(reason==="close")await f.change({session:null});else if(reason==="project")await f.project();else f.edit();
  response.resolve({items:[{label:"stale_local",kind:5}],isIncomplete:false,resolveProvider:false});expect((await pending).suggestions).toEqual([]);
});
it("keeps the same completion registration through a schema acknowledgement",async()=>{
  const f=await fixture(),provider=f.providers.get("registerCompletionItemProvider"),confirmation=deferred<boolean>();f.confirm.mockReturnValueOnce(confirmation.promise);
  await f.change({schema:[{name:"replacement",data_type:"TEXT"}]});expect(f.providers.get("registerCompletionItemProvider")).toBe(provider);expect((await f.request()).suggestions[0].label).toBe("local_id");
  await act(async()=>{confirmation.resolve(true);await flush();});expect(f.providers.get("registerCompletionItemProvider")).toBe(provider);expect((await f.request()).suggestions[0].label).toBe("revenue");
});
