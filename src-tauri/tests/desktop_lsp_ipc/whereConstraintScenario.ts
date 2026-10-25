import {createElement,useState} from "react";
import {createRoot} from "react-dom/client";
import {WhereCompletionInput} from "@/components/workspace/WhereCompletionInput";
import {getLspSessionDescriptor,shutdownLspSession} from "@/services/lsp/sessionRegistry";
import {getLspDocumentUri} from "@/services/lsp/document";
import {defaultDatabaseCapabilities,lspLanguageIdForCapabilities} from "@/lib/databaseDialect";
import {semanticConnectionToken,semanticTabRoute} from "@/services/lsp/semanticContext";
import {useConnectionStore} from "@/store/useConnectionStore";
import {useSchemaStore} from "@/store/useSchemaStore";
import {useTabStore} from "@/store/useTabStore";
import {useProjectStore} from "@/store/useProjectStore";
import {useLspSemanticStatusStore} from "@/store/useLspSemanticStatusStore";
import {useConnectionSemanticStore} from "@/services/lsp/connectionSemanticState";
import {interceptors} from "@/services/tauri/client";
import type {LspClient} from "@/services/lsp/client/LspClient";
type Environment={client:LspClient;check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};
export async function runWhereConstraintAcceptance(environment:Environment){
 const {step}=environment,check:Environment["check"]=environment.check;
 const connectionId="where-pg-contract",tabId="where-pg-contract",capabilities=defaultDatabaseCapabilities("postgres");
 const descriptor=getLspSessionDescriptor({connectionId,driver:"postgres",capabilities});check(descriptor,"Where constraint descriptor exists");const client=descriptor.client;await client.initialize(environment.client.getBinaryPath()!);
 const connection={id:connectionId,name:"Where contract fixture",driver:"postgres",url:"postgres://fixture"} as any,runtime={status:"connected" as const,updatedAt:1};
 const tab={id:tabId,type:"table",connectionId,targetSchema:"app",schemaName:"app",tableName:"users"};
 const uri=getLspDocumentUri(tabId,"postgres",lspLanguageIdForCapabilities(capabilities)),schemaId="00000000-0000-4000-8000-000000000086";
 const prior={connection:useConnectionStore.getState(),schema:useSchemaStore.getState(),tabs:useTabStore.getState(),project:useProjectStore.getState(),status:useLspSemanticStatusStore.getState(),semantic:useConnectionSemanticStore.getState()};
 const element=document.createElement("div");element.style.cssText="position:fixed;left:10px;bottom:10px;width:760px;z-index:10000";document.body.append(element);const root=createRoot(element);
 let setText:(value:string)=>void=()=>{},accepted="",probeRevision=0,catalog=0,catalogCalls=0,catalogNullReplies=0,local=0,driverReads=0,hold=false,held=false,mounted=true,release=()=>{};
 let lastCatalog:Awaited<ReturnType<LspClient["getCompletionSnapshot"]>>,lastLocal:Awaited<ReturnType<LspClient["getDocumentCompletions"]>>;
 const original=client.getCompletionSnapshot,originalLocal=client.getDocumentCompletions,originalRequests=interceptors.runRequestInterceptors;
 // Calls prove authorization; only a real response for the active probe can
 // satisfy semantic waits. Canceled and intentionally held old replies still
 // reach the production session, whose publication guards are tested below.
 client.getCompletionSnapshot=async(...args)=>{catalogCalls++;const revision=probeRevision,result=await original.apply(client,args);if(result===null)catalogNullReplies++;if(hold&&result&&revision===probeRevision){hold=false;held=true;await new Promise<void>(done=>{release=done;});held=false;}if(result&&revision===probeRevision){lastCatalog=result;catalog++;}return result;};
 client.getDocumentCompletions=async(...args)=>{const revision=probeRevision,result=await originalLocal.apply(client,args);if(result&&revision===probeRevision){lastLocal=result;local++;}return result;};
 interceptors.runRequestInterceptors=async(command,args)=>{if(["get_columns","get_database_columns"].includes(command)&&args?.connectionId===connectionId)driverReads++;return originalRequests.call(interceptors,command,args);};
 const pause=()=>new Promise<void>(done=>setTimeout(done,25));
 const wait=async(predicate:()=>boolean,message:string)=>{const end=performance.now()+12000;while(!predicate()&&performance.now()<end)await pause();check(predicate(),message+"; "+JSON.stringify({catalog,catalogNullReplies,local,constraints:lastCatalog?.constraints,documentConstraints:lastLocal?.constraints}));};
 const input=()=>element.querySelector<HTMLInputElement>("input")!;
 const labels=()=>Array.from(element.querySelectorAll("[role=option] .font-mono")).map(node=>node.textContent);
 const publish=(token?:string)=>{probeRevision++;lastCatalog=null;lastLocal=null;useLspSemanticStatusStore.getState().setStatus(connectionId,{state:token?"full":"error",totalObjects:1,cacheHits:0,cacheMisses:1,failedObjects:token?0:1,context:{identity:{connection:semanticConnectionToken(connection),runtime,lspRuntime:client.getRuntimeSnapshot().generation,metadataVersion:1,projectId:"where-contract-project",currentSchema:"app",routes:{[tabId]:semanticTabRoute(tab)}},analysisToken:token,sourcesReady:Boolean(token),metadataReady:false}});};
 const configure=async(token:string,type:string)=>{
  await client.updateConfiguration({oxideAnalysisToken:token,defaultDialect:"postgres",schemas:[{id:schemaId,database:"app",tables:[{name:"users",columns:[]}],functions:[{name:"semantic_result",routine_type:"function",parameters:[],return_type:type}]}],fileSchemas:{[uri]:schemaId},fileDialects:{[uri]:"postgres"},completionPreferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}});
  check(await client.confirmAnalysisConfiguration(token),"actual server confirms the function return metadata");publish(token);
 };
 const trigger=async(text:string,cursor=text.length)=>{probeRevision++;lastCatalog=null;lastLocal=null;setText(text);await wait(()=>input()?.value===text,"Where renders the exact current condition");input().focus();input().setSelectionRange(cursor,cursor);input().dispatchEvent(new KeyboardEvent("keydown",{key:" ",code:"Space",ctrlKey:true,bubbles:true}));};
 const choose=async(label:string,expected:string)=>{await wait(()=>labels().includes(label),"actual Where list offers "+label);Array.from(element.querySelectorAll<HTMLButtonElement>("[role=option]")).find(node=>node.querySelector(".font-mono")?.textContent===label)!.click();await wait(()=>accepted.trimEnd()===expected,"actual Where acceptance preserves the full predicate");};
 const condition="/*😀*/ semantic_result() IS ";
 try{
  useConnectionSemanticStore.setState({enabled:false,owner:null,transport:"loading",byConnectionId:{}});useConnectionStore.setState({connections:[connection],activeConnectionId:connectionId,connectionRuntimeStates:{[connectionId]:runtime}});useSchemaStore.setState({metadataVersion:1,currentSchema:"app"});useTabStore.setState({tabs:[tab as any],activeTabId:tabId});useProjectStore.setState({activeProjectId:"where-contract-project"});
  await configure("where-contract-integer","pg_catalog.int4");await client.didOpen(uri,"WITH source_probe AS (SELECT 1 AS untouched) SELECT * FROM source_probe",1,lspLanguageIdForCapabilities(capabilities));
  function Probe(){const[text,update]=useState("");setText=update;return createElement(WhereCompletionInput,{value:text,onChange:value=>{accepted=value;update(value);},connectionId,driver:"postgres",capabilities,tabId,schemaName:"app",tableName:"users"});}
  root.render(createElement(Probe));await wait(()=>Boolean(input()),"real Where constraint input mounts");
  await step("where-catalog-constraint-withdraws-local-truth-and-accepts-null",async()=>{
   hold=true;await trigger(condition);await wait(()=>held&&labels().includes("TRUE"),"local unknown return hints remain available while real RPC waits");const before=catalog;release();await wait(()=>catalog>before&&labels().includes("NULL")&&!labels().includes("TRUE"),"catalog constraint removes the initially visible TRUE");
   check(lastCatalog?.constraints?.allowedKeywords.includes("NULL")&&!lastCatalog.constraints.allowedKeywords.includes("TRUE"),"actual validated snapshot carries a complete nonboolean keyword set");check(lastCatalog?.constraints?.truthTests===false,"actual nonboolean knowledge is explicitly false");await choose("NULL",condition+"NULL");
  });
  await step("where-return-refresh-recommends-and-accepts-confirmed-boolean",async()=>{
   await configure("where-contract-boolean","boolean");const before=catalog;await trigger(condition);await wait(()=>catalog>before&&lastCatalog?.constraints?.truthTests===true&&lastCatalog.constraints.allowedKeywords.includes("TRUE")&&labels().includes("TRUE"),"fresh confirmed Boolean snapshot restores TRUE");check(lastCatalog?.constraints?.allowedKeywords.includes("TRUE"),"new actual snapshot carries Boolean truth keywords");check(lastCatalog?.constraints?.truthTests===true,"actual Boolean type is positively confirmed");await choose("TRUE",condition+"TRUE");
  });
  await step("where-document-constraints-use-builtins-without-borrowing-warm-functions",async()=>{
   publish();const beforeCatalog=catalogCalls,before=local,text="/*😀*/ STRPOS('a','b') IS ";await trigger(text);await wait(()=>local>before&&labels().includes("NULL")&&!labels().includes("TRUE"),"document-only fixed builtin type constrains local hints");check(lastLocal?.constraints&&!lastLocal.constraints.allowedKeywords.includes("TRUE"),"document-only result contains an explicit nonboolean constraint");await choose("NULL",text+"NULL");
   const unknown=local;await trigger(condition);await wait(()=>local>unknown&&labels().includes("TRUE"),"document-only custom function remains unknown despite warm catalog");check(catalogCalls===beforeCatalog,"document-only context never invokes catalog snapshot");await choose("TRUE",condition+"TRUE");
  });
  await step("where-late-catalog-contract-cannot-restrict-recovered-document-context",async()=>{
   await configure("where-contract-stale","integer");hold=true;await trigger(condition);await wait(()=>held,"actual old catalog result is held");const before=local;publish();await wait(()=>local>before&&labels().includes("TRUE"),"same input recovers independent document hints");release();await pause();await pause();check(labels().includes("TRUE"),"late nonboolean catalog contract cannot prune the new document scope");await choose("TRUE",condition+"TRUE");
  });
  await step("where-unknown-backend-truth-keeps-known-local-text-restrictions",async()=>{
   await configure("where-contract-unknown","integer");const before=catalog,text="/*😀*/ TRIM('x') IS ";await trigger(text);await wait(()=>catalog>before&&labels().includes("NULL")&&!labels().includes("TRUE"),"unknown backend type cannot replace the known local text result");
   check(lastCatalog?.constraints&&lastCatalog.constraints.truthTests===undefined&&lastCatalog.constraints.allowedKeywords.includes("TRUE"),"actual broad keyword fallback is explicitly distinct from confirmed Boolean knowledge");await choose("NULL",text+"NULL");
  });
  await step("where-comparison-value-type-withdraws-truth-and-accepts-numeric-value",async()=>{
   await configure("where-value-integer","pg_catalog.int4");const text="/*😀*/ semantic_result() = ";hold=true;await trigger(text);await wait(()=>held&&labels().includes("TRUE"),"unknown local comparison values remain until actual type knowledge arrives");const before=catalog;release();await wait(()=>catalog>before&&labels().includes("0")&&!labels().includes("TRUE"),"actual numeric return replaces unknown local values");check(lastCatalog?.valueType==="pg_catalog.int4","catalog type is bound to the real request");await choose("0",text+"0");
  });
  await step("where-comparison-return-refresh-and-document-type-isolation",async()=>{
   await configure("where-value-boolean","boolean");const text="/*😀*/ semantic_result() = ",before=catalog;await trigger(text);await wait(()=>catalog>before&&lastCatalog?.valueType==="boolean"&&labels().includes("TRUE")&&!labels().includes("0"),"confirmed Boolean refresh removes numeric templates");await choose("TRUE",text+"TRUE");
   publish();const localBefore=local,catalogBefore=catalogCalls,builtin="/*😀*/ STRPOS('ab','b') = ";await trigger(builtin);await wait(()=>local>localBefore&&lastLocal?.valueType==="integer"&&labels().includes("0")&&!labels().includes("TRUE"),"document-only AST inference supplies the builtin numeric value type");await choose("0",builtin+"0");
   const unknownBefore=local;await trigger(text);await wait(()=>local>unknownBefore&&labels().includes("TRUE"),"document-only unknown function does not borrow the warm return type");check(lastLocal?.valueType===undefined&&catalogCalls===catalogBefore,"document-only type has no catalog authority");await choose("TRUE",text+"TRUE");
  });
  await step("where-late-comparison-value-type-cannot-restrict-recovered-document-context",async()=>{
   await configure("where-value-stale","integer");const text="/*😀*/ semantic_result() = ";hold=true;await trigger(text);await wait(()=>held,"old catalog value type is held");const before=local;publish();await wait(()=>local>before&&labels().includes("TRUE"),"document scope recovers unknown values");release();await pause();await pause();check(labels().includes("TRUE")&&!labels().includes("0"),"late numeric result cannot replace independent unknown document knowledge");await choose("TRUE",text+"TRUE");
  });
  await step("where-schema-free-comparison-values-preserve-warm-catalog-isolation",async()=>{
   const token="where-no-catalog";
   await client.updateConfiguration({oxideAnalysisToken:token,defaultDialect:"postgres",schemas:[{id:schemaId,database:"private",tables:[],functions:[{name:"semantic_result",routine_type:"function",parameters:[],return_type:"integer"}]}],fileSchemas:{},fileDialects:{[uri]:"postgres"}});
   check(await client.confirmAnalysisConfiguration(token),"actual server confirms an unbound warm catalog");publish(token);
   const before=catalog,text="/*😀*/ STRPOS('ab','b') = ";await trigger(text);await wait(()=>catalog>before&&lastCatalog?.valueType==="integer"&&labels().includes("0")&&!labels().includes("TRUE"),"schema-free catalog snapshot uses document expression inference");await choose("0",text+"0");
   const unknown=catalog,custom="/*😀*/ semantic_result() = ";await trigger(custom);await wait(()=>catalog>unknown&&labels().includes("TRUE")&&!labels().includes("0"),"unbound warm function return does not become local authority");check(lastCatalog?.valueType===undefined,"unknown schema-free return has no positive type field");await choose("TRUE",custom+"TRUE");
  });
  await step("where-snapshot-position-rejection-and-valid-utf16-recovery",async()=>{
   const probeUri="oxide://native/no-catalog/value.postgres.sql",text="/*😀*/\r\nSELECT CAST(1 AS INTEGER) = ";await client.didOpen(probeUri,text,1,"postgres");
   try{
    for(const position of [{line:0,character:3},{line:0,character:7},{line:1,character:29},{line:4,character:0}]){
     let error="";try{await client.getDocumentCompletions({uri:probeUri,version:1,dialect:"postgres",position,preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}});}catch(value){error=String(value);}
     check(error.includes("Invalid completion position"),"actual Host and LSP reject invalid document positions before type inference");
    }
    const result=await client.getDocumentCompletions({uri:probeUri,version:1,dialect:"postgres",position:{line:1,character:28},preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}});
    check(result?.valueType==="INTEGER"&&result.items.some(item=>item.label==="0"),"valid CRLF and UTF-16 coordinates recover typed document values");
    const standard=await client.getCompletions(probeUri,1,28,{triggerKind:1});check(standard.some(item=>item.label==="0")&&!standard.some(item=>item.label==="TRUE"),"schema-free standard completion uses the same local expression type");
   }finally{await client.didClose(probeUri);}
  });
  await step("where-logical-return-refresh-and-full-keyword-suffix-acceptance",async()=>{
   await configure("where-logical-integer","integer");const text="/*😀*/ semantic_result() ",before=catalog;await trigger(text);await wait(()=>catalog>before&&lastCatalog?.logicalContinuation===false&&!labels().includes("AND")&&labels().includes("="),"actual nonboolean return removes logical continuations");await choose("=",text+"=");
   await configure("where-logical-boolean","boolean");const next=catalog,marked=text+"ASuffix";await trigger(marked,text.length+1);await wait(()=>catalog>next&&lastCatalog?.logicalContinuation===true&&labels().includes("AND"),"confirmed Boolean return enables a logical operator");await choose("AND",text+"AND");check(!accepted.includes("Suffix"),"actual logical keyword acceptance replaces the complete suffix after emoji");
  });
  await step("where-document-logical-types-preserve-warm-function-isolation",async()=>{
   publish();const before=local,text="/*😀*/ LOWER('x') ";await trigger(text);await wait(()=>local>before&&lastLocal?.logicalContinuation===false&&!labels().includes("AND"),"document builtin text result rejects standalone logical continuation");
   const next=local,custom="/*😀*/ semantic_result() ";await trigger(custom);await wait(()=>local>next&&lastLocal?.logicalContinuation===undefined,"document-only unknown function does not borrow warm Boolean knowledge");check(lastLocal?.valueType===undefined,"operator knowledge does not become RHS value knowledge");
  });
  await step("where-late-logical-contract-cannot-prune-recovered-document-candidates",async()=>{
   await configure("where-logical-stale","integer");const text="/*😀*/ semantic_result() ";hold=true;await trigger(text);await wait(()=>held,"old logical restriction is held after the real RPC");const before=local;publish();await wait(()=>local>before&&lastLocal?.logicalContinuation===undefined&&labels().includes("AND"),"independent unknown document context retains generic logical candidates");release();await pause();await pause();check(labels().includes("AND"),"old false logical contract cannot prune the recovered context");await choose("AND",text+"AND");
  });
  for(const documentOnly of [false,true])await step("where-pattern-value-and-required-to-"+(documentOnly?"document-only":"catalog"),async()=>{
   if(documentOnly)publish();else await configure("where-pattern-text","text");
   const prefix="/*😀*/ LOWER('oxide') SIMILAR ";await trigger(prefix+"TSuffix",prefix.length+1);await choose("TO",prefix+"TO");
   for(const operator of ["ILIKE","SIMILAR TO","~*"]){
    const text="/*😀*/ LOWER('oxide') "+operator+" ",before=documentOnly?local:catalog;await trigger(text);
    await wait(()=>(documentOnly?local:catalog)>before&&(documentOnly?lastLocal:lastCatalog)?.valueType==="text"&&labels().includes("''"),"actual pattern RHS carries the expected text type");
    check(!labels().includes("0")&&!labels().includes("TRUE"),"actual pattern values exclude numeric and Boolean templates");await choose("''",text+"''");
   }
  });
  for(const documentOnly of [false,true])await step("where-pattern-escape-character-"+(documentOnly?"document-only":"catalog"),async()=>{
   if(documentOnly)publish();else await configure("where-escape-text","text");
   const source="/*😀*/ LOWER('oxide_1') LIKE 'oxide#_1' ";await trigger(source+"ESuffix",source.length+1);await choose("ESCAPE",source+"ESCAPE");
   const text=source+"ESCAPE ",before=documentOnly?local:catalog;await trigger(text+"Suffix",text.length);
   await wait(()=>(documentOnly?local:catalog)>before&&(documentOnly?lastLocal:lastCatalog)?.valueRole==="pattern-escape"&&labels().includes("'#'"),"actual WHERE response binds the character role to its cursor and type");
   check(!labels().includes("TRUE")&&!labels().includes("0")&&!labels().includes("''"),"actual WHERE escape role excludes generic literal templates");await choose("'#'",text+"'#'");
  });
  check(driverReads===0,"syntax and committed server grants do not invent renderer metadata authority");root.unmount();mounted=false;await pause();check((await client.getDocumentSymbols(uri)).some(item=>item.name==="source_probe"),"closing constraint input preserves the main query");
  return {productionInput:true,explicitCatalogSnapshot:true,realKeywordWithdrawal:true,returnRefresh:true,documentBuiltinConstraint:true,warmFunctionIsolation:true,lateContractRejected:true,truthKnowledgeRefinement:true,comparisonValueTypes:true,schemaFreeValueTypes:true,invalidSnapshotPositionsRejected:true,logicalContinuationContract:true,logicalKeywordSuffixAcceptance:true,patternValueWidgetAcceptance:true,escapeCharacterWidgetAcceptance:true,noDriverMetadataGrant:true,realPostgres:false};
 }finally{
  release();if(mounted)root.unmount();element.remove();client.getCompletionSnapshot=original;client.getDocumentCompletions=originalLocal;interceptors.runRequestInterceptors=originalRequests;await client.didClose(uri);await shutdownLspSession(descriptor.key);useConnectionStore.setState(prior.connection,true);useSchemaStore.setState(prior.schema,true);useTabStore.setState(prior.tabs,true);useProjectStore.setState(prior.project,true);useLspSemanticStatusStore.setState(prior.status,true);useConnectionSemanticStore.setState(prior.semantic,true);
 }
}
