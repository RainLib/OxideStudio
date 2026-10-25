import {useState} from "react";
import {createRoot} from "react-dom/client";
import {WhereCompletionInput} from "@/components/workspace/WhereCompletionInput";
import {runWherePatternAcceptance} from "./wherePatternScenario";
import {GridFilterRow} from "@/components/workspace/GridFilterRow";
import {LspConnectionSyncer} from "@/components/lsp/LspConnectionSyncer";
import {interceptors} from "@/services/tauri/client";
import {getLspSessionDescriptor,shutdownLspSession} from "@/services/lsp/sessionRegistry";
import {getLspDocumentUri} from "@/services/lsp/document";
import {defaultDatabaseCapabilities,lspLanguageIdForCapabilities} from "@/lib/databaseDialect";
import {semanticConnectionToken,semanticTabRoute} from "@/services/lsp/semanticContext";
import {executeQuery} from "@/services/tauri/query.service";
import {getColumns} from "@/services/tauri/schema/catalog";
import {useConnectionStore} from "@/store/useConnectionStore";
import {useSchemaStore} from "@/store/useSchemaStore";
import {useTabStore} from "@/store/useTabStore";
import {useProjectStore} from "@/store/useProjectStore";
import {useLspSemanticStatusStore} from "@/store/useLspSemanticStatusStore";
import {useConnectionSemanticStore,isSemanticObservationIdle} from "@/services/lsp/connectionSemanticState";
import type {LspClient} from "@/services/lsp/client/LspClient";
import {runWhereConstraintAcceptance} from "./whereConstraintScenario";
type Environment={client:LspClient;check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};
async function runBaseWhereCompletionAcceptance(environment:Environment){
 const {step}=environment,check:Environment["check"]=environment.check;
 const connectionId="semantic-sqlite",tabId="where-native",capabilities=defaultDatabaseCapabilities("sqlite");
 const descriptor=getLspSessionDescriptor({connectionId,driver:"sqlite",capabilities});check(descriptor,"real Where registry descriptor exists");
 const client=descriptor.client;await client.initialize(environment.client.getBinaryPath()!);
 const connection={id:connectionId,name:"Where SQLite",driver:"sqlite",url:"sqlite::memory:"} as any;
 const runtime={status:"connected" as const,updatedAt:1};
 const tab={id:tabId,type:"table",connectionId,targetSchema:"main",schemaName:"main",tableName:"where_ledger"};
 const uri=getLspDocumentUri(tabId,"sqlite",lspLanguageIdForCapabilities(capabilities)),schemaId="00000000-0000-4000-8000-000000000078";
 const prior={connection:useConnectionStore.getState(),schema:useSchemaStore.getState(),tabs:useTabStore.getState(),project:useProjectStore.getState(),status:useLspSemanticStatusStore.getState(),semantic:useConnectionSemanticStore.getState()};
 const element=document.createElement("div");element.style.cssText="position:fixed;left:10px;bottom:10px;width:760px;z-index:10000";document.body.append(element);const root=createRoot(element);
 let setText:(value:string)=>void=()=>{},accepted="",calls=0,localCalls=0,hold=false,release:()=>void=()=>{},mounted=true;
 let redraw=()=>{},emptyStandard=false,poisonRemote=false,columnRequests=0,completedCalls=0;
 const originalRequests=interceptors.runRequestInterceptors;
 interceptors.runRequestInterceptors=async(command,args)=>{
  if(command==="get_columns"&&args?.connectionId===connectionId&&args?.table==="where_ledger")columnRequests++;
  return originalRequests.call(interceptors,command,args);
 };
 const original=client.getCompletions,originalSnapshot=client.getCompletionSnapshot,originalLocal=client.getDocumentCompletions,originalOpen=client.didOpen;
 const opened:string[]=[];
 client.didOpen=async(...args)=>{opened.push(args[0]);return originalOpen.apply(client,args);};
 client.getCompletions=async(...args)=>{calls++;const result=await original.apply(client,args);if(hold){hold=false;await new Promise<void>(done=>{release=done;});}completedCalls++;return emptyStandard?[]:poisonRemote?[...result,{label:"AND",kind:14,insertText:"AND "},{label:"where_auto_final",kind:5,insertText:"where_auto_final"},{label:"=",kind:24,insertText:"= "}]:result;};
 client.getCompletionSnapshot=async(...args)=>{calls++;const result=await originalSnapshot.apply(client,args);completedCalls++;return result?{...result,items:emptyStandard?[]:poisonRemote?[...result.items,{label:"AND",kind:14,insertText:"AND "},{label:"where_auto_final",kind:5,insertText:"where_auto_final"},{label:"=",kind:24,insertText:"= "}]:result.items}:result;};
 client.getDocumentCompletions=(...args)=>{localCalls++;return originalLocal.apply(client,args);};
 const input=()=>element.querySelector<HTMLInputElement>("input")!;
 const wait=async(test:()=>boolean,message:string)=>{const end=Date.now()+15000;while(!test()&&Date.now()<end)await new Promise(done=>setTimeout(done,20));check(test(),message+"; "+JSON.stringify({value:input()?.value,visible:element.textContent,calls,localCalls,opened}));};
 const trigger=async(text:string,cursor:number)=>{setText(text);await wait(()=>input()?.value===text,"controlled Where input has current text");input().focus();input().setSelectionRange(cursor,cursor);input().dispatchEvent(new MouseEvent("click",{bubbles:true}));input().dispatchEvent(new KeyboardEvent("keydown",{key:" ",code:"Space",ctrlKey:true,bubbles:true}));};
 const publish=(token?:string)=>useLspSemanticStatusStore.getState().setStatus(connectionId,{state:token?"full":"error",totalObjects:1,cacheHits:0,cacheMisses:1,failedObjects:token?0:1,context:{identity:{connection:semanticConnectionToken(connection),runtime,lspRuntime:client.getRuntimeSnapshot().generation,metadataVersion:1,projectId:"where-project",currentSchema:"main",routes:{[tabId]:semanticTabRoute(tab)}},analysisToken:token,sourcesReady:Boolean(token),metadataReady:Boolean(token)}});
 async function configure(token:string){const columns=await getColumns(connectionId,"main","where_ledger");check(columns.length===1,"physical columns come from real SQLite metadata");await client.updateConfiguration({oxideAnalysisToken:token,defaultDialect:"sqlite",schemas:[{id:schemaId,database:"main",functions:[],tables:[{name:"where_ledger",columns:columns.map(column=>({name:column.name,data_type:column.data_type,nullable:column.is_nullable}))}]}],fileSchemas:{[uri]:schemaId},fileDialects:{[uri]:"sqlite"}});check(await client.confirmAnalysisConfiguration(token),"actual server confirms Where source route");publish(token);}
 try {
  await executeQuery(connectionId,"CREATE TABLE where_ledger(where_old INTEGER)");
  useConnectionSemanticStore.setState({enabled:false,owner:null,transport:"loading",byConnectionId:{}});
  useConnectionStore.setState({connections:[connection],activeConnectionId:connectionId,connectionRuntimeStates:{[connectionId]:runtime}});useSchemaStore.setState({metadataVersion:1,currentSchema:"main"});useTabStore.setState({tabs:[tab as any],activeTabId:tabId});useProjectStore.setState({activeProjectId:"where-project"});
  await configure("where-initial");await client.didOpen(uri,"WITH main_probe AS (SELECT 1 AS untouched) SELECT * FROM main_probe",9,"sqlite");
  function Probe(){const [text,update]=useState("where_oSuffix > 0");setText=update;return <WhereCompletionInput value={text} onChange={value=>{accepted=value;update(value);}} connectionId={connectionId} driver="sqlite" capabilities={capabilities} tabId={tabId} schemaName="main" tableName="where_ledger"/>;}
  root.render(<Probe/>);await wait(()=>Boolean(input()),"production Where input mounts");
  await step("where-real-input-physical-route-and-suffix-acceptance",async()=>{
   await trigger("where_oSuffix > 0",7);await wait(()=>Boolean(element.querySelector("[role=option]"))&&element.textContent!.includes("where_old"),"real Where list displays SQLite field");
   input().dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await wait(()=>accepted==="where_old > 0","actual Where acceptance consumes the entire physical suffix");
   check(opened.some(value=>value.startsWith("oxide://where/")),"Where owns its separate URI");check(opened.filter(value=>value===uri).length===1,"Where never opens over the main query");
   check((await client.getDocumentSymbols(uri)).some(item=>item.name==="main_probe"),"actual main query text remains untouched");
  });
  await step("where-revoked-metadata-keeps-nested-local-expression",async()=>{
   input().dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));publish();
   const text="EXISTS (SELECT 1 FROM (SELECT CAST(1 AS INTEGER) AS local_id) x WHERE x.locSuffix = 1)";const before=calls;
   await trigger(text,text.indexOf("locSuffix")+3);await wait(()=>localCalls>0&&Boolean(element.textContent?.includes("local_id")),"nested derived alias is offered through document-only RPC");
   check(calls===before,"revoked metadata never invokes standard physical completion");check(!element.textContent?.includes("where_old"),"revoked grid columns are absent");
   input().dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await wait(()=>accepted.includes("x.local_id = 1")&&!accepted.includes("Suffix"),"actual nested local edit preserves the enclosing expression");
  });
  await step("where-real-alter-and-confirmed-physical-recovery",async()=>{
   input().dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await executeQuery(connectionId,"ALTER TABLE where_ledger RENAME COLUMN where_old TO where_new");await configure("where-repaired");
   await trigger("where_nSuffix > 0",7);await wait(()=>Boolean(element.textContent?.includes("where_new")),"fresh SQLite metadata restores physical Where fields");
   input().dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await wait(()=>accepted==="where_new > 0","actual repaired field is accepted");
  });
  const ready=()=>{
   const observation=useConnectionSemanticStore.getState().byConnectionId[connectionId],status=useLspSemanticStatusStore.getState().byConnectionId[connectionId];
   const context=status?.context;
   return Boolean(isSemanticObservationIdle(observation)&&context&&context.identity.execution===observation&&context.metadataReady&&context.analysisToken!=="where-repaired");
  };
  await step("where-production-sync-and-driver-fallback-ignore-remapped-old-grid-columns",async()=>{
   input().dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
   useConnectionStore.setState({isConnected:true});useSchemaStore.setState({schemas:["main"],tables:[]});
   function AutoProbe(){const [text,update]=useState("where_nSuffix > 0"),[,paint]=useState(0);setText=update;redraw=()=>paint(value=>value+1);
    const staleResult=[{name:"where_old"}];
    return <GridFilterRow columns={staleResult.map(value=>({id:value.name,title:value.name}))} mode="sql" visualFilters={[]} sqlFilter={text} onModeChange={()=>{}} onVisualFiltersChange={()=>{}} onSqlFilterChange={value=>{accepted=value;update(value);}} connectionId={connectionId} driver="sqlite" capabilities={capabilities} tabId={tabId} schemaName="main" tableName="where_ledger"/>;
   }
   root.render(<><LspConnectionSyncer/><AutoProbe/></>);
   await wait(()=>Boolean(input())&&Boolean(ready()),"actual connection syncer observes the driver epoch and publishes complete Where metadata");
   emptyStandard=true;const before=columnRequests;
   await trigger("where_nSuffix > 0",7);await wait(()=>Boolean(element.textContent?.includes("where_new")),"driver fallback displays the actual field despite empty standard LSP items");
   check(columnRequests===before+1,"first fallback obtains one real driver column snapshot");
   for(let i=0;i<5;i++){redraw();await new Promise(done=>setTimeout(done,15));await trigger("where_nSuffix > 0",7);}
   check(columnRequests===before+1,"remapping old grid arrays and repeated input do not reload the stable snapshot");
   check(!Array.from(element.querySelectorAll("[role=option] .font-mono")).some(value=>value.textContent==="where_old"),"freshly mapped old result fields cannot authorize suggestions");
  });
  await step("where-real-driver-operation-automatically-revokes-and-refreshes-fallback",async()=>{
   const previous=useLspSemanticStatusStore.getState().byConnectionId[connectionId]?.context?.analysisToken;
   const version=useSchemaStore.getState().metadataVersion;
   let observedFence=false,hiddenAtFence=false;
   const observeFence=useConnectionSemanticStore.subscribe(state=>{
    if(!observedFence&&(state.byConnectionId[connectionId]?.localOperations??0)>0){
     observedFence=true;const list=element.querySelector<HTMLElement>("[role=listbox]");hiddenAtFence=!list||list.hidden;
    }
   });
   const operation=executeQuery(connectionId,"ALTER TABLE where_ledger RENAME COLUMN where_new TO where_auto_final");
   try{await operation;}finally{observeFence();}
   check(observedFence&&hiddenAtFence,"the actual first local-operation fence hides the visible Where list synchronously before React commits");
   await wait(()=>Boolean(ready())&&useLspSemanticStatusStore.getState().byConnectionId[connectionId]?.context?.analysisToken!==previous,"actual driver events cause fresh acknowledged metadata without manual publication");
   await trigger("where_aSuffix > 0",7);await wait(()=>Boolean(element.textContent?.includes("where_auto_final")),"fresh driver fallback recovers after real ALTER and automatic sync");
   check(!Array.from(element.querySelectorAll("[role=option] .font-mono")).some(value=>value.textContent==="where_new"||value.textContent==="where_old"),"neither stale field returns with the new receipt");
   input().dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await wait(()=>accepted==="where_auto_final > 0","automatic fallback accepts the exact fresh identifier and full suffix");
   check(useSchemaStore.getState().metadataVersion===version,"driver epoch recovery needs no manual global metadata version bump");
   emptyStandard=false;
  });
  await step("where-real-driver-pinyin-fallback-and-quoted-suffix-acceptance",async()=>{
   input().dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
   const previous=useLspSemanticStatusStore.getState().byConnectionId[connectionId]?.context?.analysisToken;
   await executeQuery(connectionId,'ALTER TABLE where_ledger ADD COLUMN "用户名称" TEXT');
   await wait(()=>Boolean(ready())&&useLspSemanticStatusStore.getState().byConnectionId[connectionId]?.context?.analysisToken!==previous,"actual driver epoch refreshes Chinese column metadata");
   emptyStandard=true;
   await trigger("yhmcSuffix > 0",4);await wait(()=>Boolean(element.textContent?.includes("用户名称")),"production fallback loads the shared pinyin matcher for real SQLite identifiers");
   input().dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await wait(()=>accepted==='"用户名称" > 0',"pinyin selection quotes the real identifier and consumes its entire suffix");
  });
  await step("where-real-input-suppresses-local-fields-in-literals-and-comments",async()=>{
   for(const marked of ["where_auto_final = 'where_a|Suffix'", "where_auto_final > 0 /* where_a|Suffix */", "where_auto_final > 0 -- where_a|Suffix"]){
    const before=completedCalls;await trigger(marked.replace("|",""),marked.indexOf("|"));
    await wait(()=>completedCalls>before,"real LSP request finishes before checking the controlled-empty fallback");
    await new Promise(done=>setTimeout(done,50));
    check(!element.querySelector("[role=listbox]"),"production local fallback stays hidden inside SQLite literal/comment: "+marked);
   }
   emptyStandard=false;
  });
  const labels=()=>Array.from(element.querySelectorAll("[role=option] .font-mono")).map(value=>value.textContent);
  const choose=async(label:string)=>{
   await wait(()=>labels().includes(label),"production input offers "+label);
   const option=Array.from(element.querySelectorAll<HTMLButtonElement>("[role=option]")).find(value=>value.querySelector(".font-mono")?.textContent===label)!;
   option.click();
  };
  await step("where-complex-scalar-context-filters-real-and-controlled-remote-candidates",async()=>{
   poisonRemote=true;const before=completedCalls;
   const expression="COALESCE(where_auto_final, 0) ";await trigger(expression,expression.length);
   await wait(()=>completedCalls>before&&labels().includes("="),"actual server response is merged with the current scalar grammar slot");
   check(labels().includes("AND")&&!labels().includes("where_auto_final"),"SQLite numeric coercion preserves valid AND while rejecting an unrelated field in the operator slot");
   await choose("=");await wait(()=>accepted===expression+"= ","actual operator acceptance preserves the complete scalar expression");
   const predicate=expression+"= ";await trigger(predicate,predicate.length);await choose("0");await wait(()=>accepted===predicate+"0 ","real INTEGER metadata infers numeric fallback values after COALESCE");
   const result=await executeQuery(connectionId,"SELECT COUNT(*) FROM where_ledger WHERE "+accepted);check(result[0]?.rows.length===1,"the accepted production predicate executes in actual SQLite");
   poisonRemote=false;
  });
  await step("where-nested-range-list-case-fallback-and-real-sqlite-expression-execution",async()=>{
   emptyStandard=true;
   for(const [text,label,expected] of [
    ["where_auto_final BETWEEN COALESCE(1, 0)","AND","where_auto_final BETWEEN COALESCE(1, 0) AND "],
    ["where_auto_final IN (COALESCE(1, 0)",")","where_auto_final IN (COALESCE(1, 0)) "],
    ["CASE WHEN where_auto_final > 0 THEN 1 ELSE 0","END","CASE WHEN where_auto_final > 0 THEN 1 ELSE 0 END "],
   ] as const){
    await trigger(text,text.length);await choose(label);await wait(()=>accepted===expected,"actual nested acceptance preserves scalar operands: "+label);
   }
   const result=await executeQuery(connectionId,"SELECT CASE WHEN 2 BETWEEN COALESCE(1,0) AND 3 THEN 1 ELSE 0 END AS matched, 1 IN (COALESCE(1,0),2) AS found, CASE WHEN 'x'='IN (' THEN 0 ELSE 1 END AS opaque");
   check(result[0]?.rows[0]?.length===3&&result[0].rows[0]!.every(value=>value===1),"actual SQLite verifies nested range/list/CASE semantics and opaque keyword literals");
   emptyStandard=false;
  });
  await step("where-complete-keyword-value-edits-preserve-operators",async()=>{
   emptyStandard=true;
   for(const [text,label,expected] of [
    ["where_auto_final BETWEEN","0","where_auto_final BETWEEN 0 "],
    ["where_auto_final IS NOT","NULL","where_auto_final IS NOT NULL "],
   ] as const){await trigger(text,text.length);await choose(label);await wait(()=>accepted===expected,"actual input retains the completed keyword: "+text);}
   emptyStandard=false;
  });
  await step("where-null-safe-comparison-keywords-and-real-sqlite-execution",async()=>{
   emptyStandard=true;
   const initial="where_auto_final IS ";await trigger(initial,initial.length);await choose("NOT DISTINCT FROM");await wait(()=>accepted===initial+"NOT DISTINCT FROM ","SQLite local IS list completes its null-safe comparison");
   const right=accepted;await trigger(right,right.length);await choose("where_auto_final");await wait(()=>accepted===right+"where_auto_final","comparison RHS keeps the field without an extra equals");
   const result=await executeQuery(connectionId,"SELECT COUNT(*) FROM where_ledger WHERE "+accepted);check(result[0]?.rows.length===1,"actual SQLite executes the accepted IS NOT DISTINCT FROM field expression");
   const incomplete="where_auto_final IS NOT DISTINCT";await trigger(incomplete,incomplete.length);await choose("FROM");await wait(()=>accepted===incomplete+" FROM ","mandatory FROM acceptance retains the complete DISTINCT keyword");
   emptyStandard=false;
  });
  await step("where-sqlite-scalar-logical-continuation-and-real-engine-coercion",async()=>{
   const expression="COALESCE(where_auto_final, 0) ";emptyStandard=true;await trigger(expression,expression.length);await choose("AND");await wait(()=>accepted===expression+"AND ","actual SQLite Where input accepts the scalar logical continuation");
   const result=await executeQuery(connectionId,"SELECT 1 AND 1 AS numeric_operand, '1x' AND 1 AS text_operand, NULL AND 0 AS null_operand");check(JSON.stringify(result[0]?.rows[0])==="[1,1,0]","actual SQLite evaluates scalar logical coercions and NULL combinations");
   const acceptedQuery=await executeQuery(connectionId,"SELECT COUNT(*) FROM where_ledger WHERE "+accepted+"1");check(acceptedQuery[0]?.rows.length===1,"actual SQLite executes the logical operator accepted by the production input");emptyStandard=false;
  });
  await step("where-sqlite-glob-pattern-widget-and-real-engine-results",async()=>{
   for(const operator of ["GLOB","NOT GLOB"]){
    const expression="/*😀*/ LOWER('oxide') "+operator+" ";await trigger(expression,expression.length);await wait(()=>labels().includes("''"),"SQLite pattern RHS offers a text template");
    check(!labels().includes("TRUE")&&!labels().includes("0"),"SQLite pattern RHS does not offer Boolean or numeric literals");await choose("''");
    await wait(()=>accepted===expression+"'' ","actual SQLite pattern acceptance preserves the full operator and Unicode source");
    const executed=await executeQuery(connectionId,"SELECT ("+accepted+")");check(executed[0]?.rows[0]?.[0]===(operator==="GLOB"?0:1),"actual SQLite executes the accepted pattern");
   }
   const actual=await executeQuery(connectionId,"SELECT typeof('oxide' GLOB 'ox*'), 'oxide' GLOB 'ox*', 'oxide' NOT GLOB 'db*', NULL GLOB 'ox*'");
   check(JSON.stringify(actual[0]?.rows[0])==='["integer",1,1,null]',"actual SQLite verifies pattern storage, negation and NULL results");
  });
  await step("where-sqlite-pattern-escape-widget-and-real-unicode-results",async()=>{
   const source="/*😀*/ LOWER('oxide_1') LIKE 'oxide#_1' ESCAPE ";await trigger(source+"Suffix",source.length);await wait(()=>labels().includes("'#'"),"actual SQLite WHERE offers an escape character");
   check(!labels().includes("TRUE")&&!labels().includes("0")&&!labels().includes("''"),"actual SQLite escape suggestions omit invalid generic literals");await choose("'#'");
   await wait(()=>accepted===source+"'#' ","actual SQLite escape acceptance consumes the suffix");
   const acceptedQuery=await executeQuery(connectionId,"SELECT ("+accepted+")");check(acceptedQuery[0]?.rows[0]?.[0]===1,"actual SQLite executes the accepted escaped pattern");
   const actual=await executeQuery(connectionId,"SELECT 'oxide_1' LIKE 'oxide尾_1' ESCAPE '尾', 'oxide_1' LIKE 'oxide😀_1' ESCAPE '😀', 'oxide_1' LIKE 'oxide1_1' ESCAPE 1, 'oxide_' LIKE 'oxide1_' ESCAPE 1, 'oxide' LIKE 'oxide' ESCAPE NULL");
   check(JSON.stringify(actual[0]?.rows[0])==='[1,1,0,1,null]',"actual SQLite validates Unicode, trailing escape, numeric coercion and NULL semantics; "+JSON.stringify(actual[0]?.rows[0]));
  });
  await step("where-escape-rejects-real-delayed-completion-and-main-survives-close",async()=>{
   hold=true;release=()=>{};await trigger("where_aSuffix > 0",7);await wait(()=>!hold,"actual physical request was intercepted after reaching LSP");
   input().dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));release();await new Promise(done=>setTimeout(done,100));check(!element.querySelector("[role=listbox]"),"late real response does not reopen after Escape");
   root.unmount();mounted=false;await new Promise(done=>setTimeout(done,30));check((await client.getDocumentSymbols(uri)).some(item=>item.name==="main_probe"),"closing Where leaves main document live");
  });
  await step("where-sqlite-cast-affinity-matches-real-engine-storage",async()=>{
   // The actual Tauri SQLite connection independently checks storage results;
   // NUMERIC is an affinity, so this fixture's integer storage is not a claim
   // that every NUMERIC cast always has integer storage.
   for(const [declared,storage] of [["INTEGER","integer"],["BOOLEAN","integer"],["VARCHAR(8)","text"],["\"FLOATING POINT\"","integer"],["BLOB","blob"],["REAL","real"],["DATE","integer"]]){
    const result=await executeQuery(connectionId,`SELECT typeof(CAST(1 AS ${declared})) AS storage`);check(result[0]?.rows[0]?.[0]===storage,"actual SQLite CAST storage matches the declared affinity: "+declared);
   }
  });
  await step("where-sqlite-predicate-case-results-match-real-engine-storage",async()=>{
   const result=await executeQuery(connectionId,"SELECT typeof(CASE WHEN 1=1 THEN EXISTS(SELECT NULL) ELSE NOT EXISTS(SELECT 1 WHERE 1=0) END), CASE WHEN 1=1 THEN EXISTS(SELECT NULL) ELSE NOT EXISTS(SELECT 1 WHERE 1=0) END, CASE WHEN 1=0 THEN EXISTS(SELECT NULL) ELSE NULL END");check(JSON.stringify(result[0]?.rows[0])==='["integer",1,null]',"actual SQLite verifies the modeled predicate CASE storage, value and NULL branch");
  });
  return {productionInput:true,productionHook:true,realSqlite:true,realMetadata:true,independentDocument:true,nestedLocalAcceptance:true,physicalRecovery:true,escapeCancellation:true,mainSurvivesClose:true,productionConnectionSyncer:true,automaticDriverColumnRecovery:true,remappedGridIsolation:true,coalescedDriverReads:true,emptyStandardFallback:true,noManualMetadataVersionBump:true,immediateDomWithdrawal:true,realDriverPinyinFallback:true,pinyinQuotedSuffixAcceptance:true,literalAndCommentFallbackSuppression:true,realColumnCommentsTested:false,complexScalarGrammar:true,controlledInvalidRemoteCandidates:true,complexSuffixAcceptance:true,realSqliteExpressionExecution:true};
 } finally {
  release();if(mounted)root.unmount();element.remove();client.getCompletions=original;client.getCompletionSnapshot=originalSnapshot;client.getDocumentCompletions=originalLocal;client.didOpen=originalOpen;interceptors.runRequestInterceptors=originalRequests;
  await client.didClose(uri);await shutdownLspSession(descriptor.key);useConnectionStore.setState(prior.connection,true);useSchemaStore.setState(prior.schema,true);useTabStore.setState(prior.tabs,true);useProjectStore.setState(prior.project,true);useLspSemanticStatusStore.setState(prior.status,true);useConnectionSemanticStore.setState(prior.semantic,true);
 }
}
export async function runWhereCompletionAcceptance(environment:Environment){
 const result=await runBaseWhereCompletionAcceptance(environment);
 return {...result,keywordConstraints:await runWhereConstraintAcceptance(environment),patternCapabilities:await runWherePatternAcceptance(environment)};
}
