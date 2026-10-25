import {createElement,useState}from"react";
import {createRoot}from"react-dom/client";
import {WhereCompletionInput}from"@/components/workspace/WhereCompletionInput";
import {getLspSessionDescriptor,shutdownLspSession}from"@/services/lsp/sessionRegistry";
import {getLspDocumentUri}from"@/services/lsp/document";
import {defaultDatabaseCapabilities,lspLanguageIdForCapabilities}from"@/lib/databaseDialect";
import {semanticConnectionToken,semanticTabRoute}from"@/services/lsp/semanticContext";
import {useConnectionStore}from"@/store/useConnectionStore";
import {useSchemaStore}from"@/store/useSchemaStore";
import {useTabStore}from"@/store/useTabStore";
import {useProjectStore}from"@/store/useProjectStore";
import {useLspSemanticStatusStore}from"@/store/useLspSemanticStatusStore";
import {useConnectionSemanticStore}from"@/services/lsp/connectionSemanticState";
import {interceptors}from"@/services/tauri/client";
import type{LspClient}from"@/services/lsp/client/LspClient";
type Environment={client:LspClient;check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};

/** Real production Where input and wire snapshots; version fixtures do not
 * claim an actual ClickHouse connection or grant renderer metadata reads. */
export async function runWherePatternAcceptance(environment:Environment){
 const {step}=environment,check:Environment["check"]=environment.check;
 const connectionId="where-pattern-capability",tabId=connectionId,projectId="where-pattern-project";
 const capabilities={...defaultDatabaseCapabilities("mysql"),lspLanguageId:"sql",lspServerDialect:"clickhouse"};
 const descriptor=getLspSessionDescriptor({connectionId,driver:"mysql",capabilities});check(descriptor,"versioned WHERE descriptor exists");const client=descriptor.client;await client.initialize(environment.client.getBinaryPath()!);
 const connection={id:connectionId,name:"WHERE version fixture",driver:"mysql",url:"mysql://fixture"}as any,runtime={status:"connected"as const,updatedAt:1};
 const tab={id:tabId,type:"table",connectionId,targetSchema:"app",schemaName:"app",tableName:"users"};
 const uri=getLspDocumentUri(tabId,"mysql",lspLanguageIdForCapabilities(capabilities)),schemaId="00000000-0000-4000-8000-000000000095";
 const prior={connection:useConnectionStore.getState(),schema:useSchemaStore.getState(),tabs:useTabStore.getState(),project:useProjectStore.getState(),status:useLspSemanticStatusStore.getState(),semantic:useConnectionSemanticStore.getState()};
 const element=document.createElement("div");element.style.cssText="position:fixed;left:10px;bottom:10px;width:760px;z-index:10000";document.body.append(element);const root=createRoot(element);
 let setText:(value:string)=>void=()=>{},accepted="",probeRevision=0,catalog=0,catalogCalls=0,local=0,driverReads=0,hold=false,held=false,heldPatternEscape=false,mounted=true,release=()=>{};
 let lastCatalog:Awaited<ReturnType<LspClient["getCompletionSnapshot"]>>,lastLocal:Awaited<ReturnType<LspClient["getDocumentCompletions"]>>,lastRequest:Parameters<LspClient["getCompletionSnapshot"]>[0]|undefined;
 const originalCatalog=client.getCompletionSnapshot,originalLocal=client.getDocumentCompletions,originalRequests=interceptors.runRequestInterceptors;
 client.getCompletionSnapshot=async(...args)=>{catalogCalls++;const revision=probeRevision,result=await originalCatalog.apply(client,args);if(hold&&result?.patternEscape===true&&revision===probeRevision){hold=false;held=true;heldPatternEscape=true;await new Promise<void>(done=>{release=done;});held=false;}if(result&&revision===probeRevision){lastCatalog=result;lastRequest=args[0];catalog++;}return result;};
 client.getDocumentCompletions=async(...args)=>{const revision=probeRevision,result=await originalLocal.apply(client,args);if(result&&revision===probeRevision){lastLocal=result;local++;}return result;};
 interceptors.runRequestInterceptors=async(command,args)=>{if(["get_columns","get_database_columns"].includes(command)&&args?.connectionId===connectionId)driverReads++;return originalRequests.call(interceptors,command,args);};
 const pause=()=>new Promise<void>(done=>setTimeout(done,25));
 const input=()=>element.querySelector<HTMLInputElement>("input")!;
 const labels=()=>Array.from(element.querySelectorAll("[role=option] .font-mono")).map(node=>node.textContent);
 const wait=async(predicate:()=>boolean,message:string)=>{const end=performance.now()+12000;while(!predicate()&&performance.now()<end)await pause();check(predicate(),message+"; "+JSON.stringify({value:input()?.value,labels:labels().slice(0,20),catalog,local,server:lastCatalog?.patternEscape,document:lastLocal?.patternEscape,logical:lastCatalog?.logicalContinuation}));};
 const publish=(token?:string)=>{probeRevision++;lastCatalog=null;lastLocal=null;useLspSemanticStatusStore.getState().setStatus(connectionId,{state:token?"full":"error",totalObjects:1,cacheHits:0,cacheMisses:1,failedObjects:token?0:1,context:{identity:{connection:semanticConnectionToken(connection),runtime,lspRuntime:client.getRuntimeSnapshot().generation,metadataVersion:1,projectId,currentSchema:"app",routes:{[tabId]:semanticTabRoute(tab)}},analysisToken:token,sourcesReady:Boolean(token),metadataReady:false}});};
 const configure=async(token:string,version?:string)=>{await client.updateConfiguration({oxideAnalysisToken:token,defaultDialect:"clickhouse",schemas:[{id:schemaId,database:"app",server_version:version,tables:[{name:"users",columns:[]}],functions:[]}],fileSchemas:{[uri]:schemaId},fileDialects:{[uri]:"clickhouse"},completionPreferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}});check(await client.confirmAnalysisConfiguration(token),"actual server confirms the version fixture");publish(token);};
 const trigger=async(text:string,cursor=text.length)=>{probeRevision++;lastCatalog=null;lastLocal=null;setText(text);await wait(()=>input()?.value===text,"WHERE keeps the exact condition");input().focus();input().setSelectionRange(cursor,cursor);input().dispatchEvent(new KeyboardEvent("keydown",{key:" ",code:"Space",ctrlKey:true,bubbles:true}));};
 const choose=async(label:string,expected:string)=>{await wait(()=>labels().includes(label),"actual WHERE offers "+label);Array.from(element.querySelectorAll<HTMLButtonElement>("[role=option]")).find(node=>node.querySelector(".font-mono")?.textContent===label)!.click();await wait(()=>accepted.trimEnd()===expected,"actual WHERE accepts the complete "+label+" edit");};
 const source="/*😀*/ LOWER('oxide_1') LIKE 'oxide#_1' ";
 try{
  useConnectionSemanticStore.setState({enabled:false,owner:null,transport:"loading",byConnectionId:{}});useConnectionStore.setState({connections:[connection],activeConnectionId:connectionId,connectionRuntimeStates:{[connectionId]:runtime}});useSchemaStore.setState({metadataVersion:1,currentSchema:"app"});useTabStore.setState({tabs:[tab as any],activeTabId:tabId});useProjectStore.setState({activeProjectId:projectId});
  await configure("where-pattern-initial");await client.didOpen(uri,"WITH source_probe AS (SELECT 1 AS untouched) SELECT * FROM source_probe",1,lspLanguageIdForCapabilities(capabilities));
  function Probe(){const[text,update]=useState("");setText=update;return createElement(WhereCompletionInput,{value:text,onChange:value=>{accepted=value;update(value);},connectionId,driver:"mysql",capabilities,tabId,schemaName:"app",tableName:"users"});}
  root.render(createElement(Probe));await wait(()=>Boolean(input()),"production versioned WHERE mounts");
  await step("where-clickhouse-pattern-capability-follows-version-without-sql-edits",async()=>{
   const versions=new Set<number>();
   for(const[index,[version,expected]]of ([[undefined,undefined],["26.5.2",false],["26.6.1.123",true],["26.5.2",false]]as const).entries()){
    const before=catalog;await configure("where-pattern-version-"+index,version);await trigger(source);
    await wait(()=>catalog>before&&lastCatalog?.logicalContinuation===true&&lastCatalog.patternEscape===expected&&labels().includes("AND")&&labels().includes("ESCAPE")===(expected===true),"version knowledge updates the same condition");check(lastRequest?.dialect==="clickhouse","explicit profile wins over the mysql URI");versions.add(lastRequest!.version);check(input().value===source,"version refresh preserves SQL");
   }
   check(versions.size===1,"schema version changes do not need a document text change");
  });
  await step("where-clickhouse-versioned-escape-keyword-and-character-acceptance",async()=>{
   await configure("where-pattern-accept","26.6.1.123");await trigger(source+"ESuffix尾",source.length+1);await wait(()=>lastCatalog?.patternEscape===true,"keyword uses explicit support");await choose("ESCAPE",source+"ESCAPE");
   const value=source+"ESCAPE ";await trigger(value+"Suffix",value.length);await wait(()=>lastCatalog?.valueRole==="pattern-escape"&&labels().includes("'#'"),"character role follows the accepted keyword");await choose("'#'",value+"'#'");
  });
  await step("where-clickhouse-document-recovery-keeps-version-unknown-with-warm-catalog",async()=>{
   await configure("where-pattern-warm","26.6.1.123");await trigger(source);await wait(()=>lastCatalog?.patternEscape===true&&labels().includes("ESCAPE"),"catalog positive control is visible");const request=lastRequest!,before=local,beforeCatalog=catalogCalls;publish();
   await wait(()=>local>before&&lastLocal?.logicalContinuation===true&&lastLocal.patternEscape===undefined&&!labels().includes("ESCAPE"),"document-only recovery cannot inherit the version");check(catalogCalls===beforeCatalog,"recovery does not request physical snapshots");
   const warm=await originalCatalog.call(client,request);check(warm?.patternEscape===true,"actual shared server retains the warm version independently");await pause();check(!labels().includes("ESCAPE"),"direct positive control does not grant renderer authority");
  });
  await step("where-clickhouse-late-capability-cannot-reappear-after-document-recovery",async()=>{
   await configure("where-pattern-late","26.6.1.123");hold=true;await trigger(source);await wait(()=>held,"actual catalog capability is held");const before=local;publish();await wait(()=>local>before&&lastLocal?.logicalContinuation===true&&lastLocal.patternEscape===undefined&&!labels().includes("ESCAPE"),"new document context is active");release();await pause();await pause();check(heldPatternEscape&&!labels().includes("ESCAPE"),"late old support cannot republish the keyword");
  });
  await step("where-clickhouse-similar-escape-requires-the-supported-version",async()=>{
   const similar="/*😀*/ LOWER('oxide_1') SIMILAR TO 'oxide#_1' ";await configure("where-pattern-similar-old","26.9.1");const before=catalog;await trigger(similar);await wait(()=>catalog>before&&Boolean(lastCatalog)&&lastCatalog?.patternEscape===undefined&&!labels().includes("ESCAPE"),"older similar syntax never gains support");
   await configure("where-pattern-similar-new","26.10.1");await trigger(similar+"ESuffix",similar.length+1);await wait(()=>lastCatalog?.patternEscape===true,"new similar version grants the keyword");await choose("ESCAPE",similar+"ESCAPE");
  });
  check(driverReads===0,"versioned syntax does not grant grid metadata authority");
  return{productionInput:true,explicitCapabilityProfile:true,versionedKeywordAcceptance:true,characterRoleAcceptance:true,versionRefreshWithoutSqlEdits:true,unknownDocumentVersion:true,warmCatalogRetained:true,lateCapabilityRejected:true,noDriverMetadataGrant:true,realClickhouse:false};
 }finally{release();if(mounted){root.unmount();mounted=false;}element.remove();client.getCompletionSnapshot=originalCatalog;client.getDocumentCompletions=originalLocal;interceptors.runRequestInterceptors=originalRequests;await client.didClose(uri);await shutdownLspSession(descriptor.key);useConnectionStore.setState(prior.connection,true);useSchemaStore.setState(prior.schema,true);useTabStore.setState(prior.tabs,true);useProjectStore.setState(prior.project,true);useLspSemanticStatusStore.setState(prior.status,true);useConnectionSemanticStore.setState(prior.semantic,true);}
}
