import type * as Monaco from "monaco-editor";
import {listen} from "@tauri-apps/api/event";
import {createLspSyncJob} from "@/features/lsp-sync/runtime/createLspSyncJob";
import {createLspTableLoader} from "@/features/lsp-sync/runtime/createLspTableLoader";
import {createLspSchemaIdentity} from "@/features/lsp-sync/runtime/createLspSchemaIdentity";
import {getLspDocumentUri} from "@/services/lsp/document";
import {defaultDatabaseCapabilities,lspLanguageIdForCapabilities} from "@/lib/databaseDialect";
import {lspCompletionItemsToMonacoSuggestions} from "@/features/query-editor/model/lspCompletionPresentation";
import type {LspClient} from "@/services/lsp/client/LspClient";
import type {LspConfigurationPayload} from "@/services/lsp/configDispatch";
import type {CachedLspTableDefinition} from "@/features/lsp-sync/model/syncTypes";

type Environment={monaco:typeof import("monaco-editor/esm/vs/editor/editor.api.js");editor:Monaco.editor.IStandaloneCodeEditor;client:LspClient;check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};
export async function runLiveNamespaceAcceptance(environment:Environment) {
  const {monaco,editor,client,step}=environment,check:Environment["check"]=environment.check;
  const connection={id:"lookup-fixture",name:"Lookup metadata fixture",driver:"sqlserver"} as Parameters<typeof createLspSyncJob>[0]["connection"];
  const capabilitiesPromise=Promise.resolve({...defaultDatabaseCapabilities("postgres"),driver:"sqlserver",lspLanguageId:"sqlserver",lspServerDialect:"sqlserver",supportsFunctions:false,supportsTableIndexes:false,supportsTableConstraints:false});
  const metadataStats={cacheHits:0,cacheMisses:0,failedObjects:0},syncGenerationRef={current:1};
  const identity=createLspSchemaIdentity({activeConnectionId:connection.id,connection});
  const loader=createLspTableLoader({...identity,capabilitiesPromise,connection,activeConnectionId:connection.id,syncGenerationRef,syncGeneration:1,metadataStats,tableMetadataCacheRef:{current:new Map<string,CachedLspTableDefinition>()},recordMetadataCacheStatus:status=>{if(status==="hit")metadataStats.cacheHits++;else metadataStats.cacheMisses++;}});
  const documentLanguageId=lspLanguageIdForCapabilities(await capabilitiesPromise);
  const uri=getLspDocumentUri("live-namespace","sqlserver",documentLanguageId);
  const previous=editor.getModel(),model=monaco.editor.createModel("","sql",monaco.Uri.parse(uri));
  let publishedVersion:number|undefined,opened=false;
  const unlisten=await listen<{sessionKey?:string;method:string;params:{uri:string;version?:number}}>("lsp-notification",event=>{const n=event.payload;if(n.sessionKey===client.getSessionKey()&&n.method==="textDocument/publishDiagnostics"&&n.params.uri===uri)publishedVersion=n.params.version;});
  let acceptedConfig:LspConfigurationPayload|undefined;
  const receipt={productionSyncJob:false,productionTableLoader:false,realMetadataCommands:false,driverFixture:true,liveSqlServer:false,acceptedCompletion:false,namespaceAbsenceProven:false,resetRemovesPhysicalFields:false,queuedRestoreRetainsComplexTypes:false};
  try {
    await step("live-namespace-production-metadata-sync-default-schema-and-cte-acceptance",async()=>{
      let config:LspConfigurationPayload|undefined;
      const originalUpdate=client.updateConfiguration.bind(client);
      // Observe the payload while retaining the real production client and RPC.
      client.updateConfiguration=async next=>{config=next;await originalUpdate(next);};
      try {
        const selected={catalogName:null,databaseName:null,schemaName:"selected"};
        await createLspSyncJob({capabilitiesPromise,serverVersionPromise:Promise.resolve("16.0"),isCancelled:()=>false,syncGenerationRef,syncGeneration:1,setSemanticStatus:()=>{},activeConnectionId:connection.id,connection,activeProjectRoot:null,activeProjectId:"lookup-project",queryTabs:[{id:"live-namespace",type:"query",sql:"SELECT * FROM db..ledger"}],schemaByTabId:{"live-namespace":"selected"},catalogByTabId:{"live-namespace":selected},defaultSchema:"selected",defaultCatalog:selected,...identity,targetCatalogs:[selected],preferredTablesByCatalog:new Map(),metadataVersion:1,...loader,completionPreferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"},formattingPreferences:{keywordCase:"upper",functionCase:"upper",logicalOperatorNewline:"before",fromClauseLayout:"newLine"},lastConfigRef:{current:null},lspClient:client,synchronizeProjectDocuments:async()=>{},recordSemanticTelemetry:()=>{},metadataStats}).buildTableDefinitions();
      } finally {client.updateConfiguration=originalUpdate;}
      check(config!==undefined,"production sync job sent a real configuration");
      acceptedConfig=config;
      check(config.schemas.length===2,"actual default schema is added to selected schema");
      const sales=config.schemas.find(s=>s.database==="sales"),selected=config.schemas.find(s=>s.database==="selected");
      check(sales?.tables[0]?.columns[0]?.name==="sales_value","production loader fetched actual default-schema columns");
      check(selected?.tables[0]?.columns[0]?.name==="selected_value","selected schema has a distinct physical row");
      check(config.fileSchemas[uri]===selected?.id,"document binds the confirmed live catalog");
      check(config.schemas.every(s=>s.catalog==="db"&&s.namespace?.default_schema==="sales"&&s.namespace.tables_complete===false),"no metadata absence proof is invented");
      check(metadataStats.failedObjects===0&&metadataStats.cacheMisses===2,"two real metadata enrichment commands completed");
      receipt.productionSyncJob=true;receipt.productionTableLoader=true;receipt.realMetadataCommands=true;
      const marked="WITH report(net) AS (SELECT l.sales_value FROM db..ledger l) SELECT r.ne<cursor>tSuffix FROM report r";
      const offset=marked.indexOf("<cursor>");model.setValue(marked.replace("<cursor>",""));editor.setModel(model);editor.setPosition(model.getPositionAt(offset));
      await client.didOpen(uri,model.getValue(),model.getVersionId(),documentLanguageId);opened=true;
      const deadline=Date.now()+10000;while(publishedVersion!==model.getVersionId()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
      check(publishedVersion===model.getVersionId(),"new document diagnostics completed");
      const position=model.getPositionAt(offset),list=await client.getCompletionList(uri,position.lineNumber-1,position.column-1);
      const candidate=list.items.find(i=>i.label==="net");check(candidate!==undefined&&candidate.detail?.includes("bigint")===true,"omitted schema CTE uses the driver-confirmed default table type");
      const resolved=await client.resolveCompletionItem(candidate);
      const suggestions=lspCompletionItemsToMonacoSuggestions({monaco,ownerKey:"live-namespace",items:[resolved],typedWord:model.getWordUntilPosition(position).word,completedContextKeyword:false,defaultRange:new monaco.Range(position.lineNumber,position.column,position.lineNumber,position.column),rankByUsage:false,usageScope:"live-namespace",recordUsageCommand:"unused.acceptance",driver:"sqlserver",nextCharacter:model.getValue()[offset]}),suggestion=suggestions[0];
      check(suggestion!==undefined,"actual completion converts for Monaco");
      const range="replace" in suggestion.range?suggestion.range.replace:suggestion.range;
      editor.executeEdits("live-namespace-accept",[{range,text:suggestion.insertText}]);
      check(model.getValue().includes("SELECT r.net FROM")&&!model.getValue().includes("Suffix"),"Monaco accepts the complete semantic output name");
      await client.didChange(uri,model.getValue(),model.getVersionId());
      const hover=model.getPositionAt(model.getValue().lastIndexOf("net")+1);
      check(JSON.stringify(await client.getHover(uri,hover.lineNumber-1,hover.column-1)).includes("bigint"),"accepted output retains the default-schema type in hover");receipt.acceptedCompletion=true;
    });
    await step("live-namespace-real-context-reset-and-queued-restore",async()=>{
      check(acceptedConfig!==undefined,"accepted metadata is available for the replacement context");
      const empty={...acceptedConfig,schemas:[],fileSchemas:{},fileDialects:{}};
      const marked="WITH report(net) AS (SELECT l.sales_value FROM db..ledger l) SELECT r.ne<cursor>tSuffix FROM report r";
      const offset=marked.indexOf("<cursor>");model.setValue(marked.replace("<cursor>",""));
      await client.didChange(uri,model.getValue(),model.getVersionId());
      const position=model.getPositionAt(offset);
      await client.updateConfiguration(empty);
      const cleared=await client.getCompletionList(uri,position.lineNumber-1,position.column-1);
      check(!cleared.items.some(item=>item.label==="net"&&item.detail?.includes("bigint")),"reset removes the old physical projection type");
      receipt.resetRemovesPhysicalFields=true;
      // All three calls intentionally overlap at the production client entry.
      // The final schema must be the restored one, independent of RPC timing.
      await Promise.all([client.updateConfiguration(acceptedConfig),client.updateConfiguration(empty),client.updateConfiguration(acceptedConfig)]);
      const restored=await client.getCompletionList(uri,position.lineNumber-1,position.column-1);
      const candidate=restored.items.find(item=>item.label==="net");
      check(candidate!==undefined&&candidate.detail?.includes("bigint"),"queued replacement restores CTE projection type");
      check(candidate.textEdit!==undefined,"replacement still carries an actual completion edit");
      const hover=model.getPositionAt(model.getValue().indexOf("sales_value")+2);
      check(JSON.stringify(await client.getHover(uri,hover.lineNumber-1,hover.column-1)).includes("bigint"),"physical hover follows the final restored schema");
      receipt.queuedRestoreRetainsComplexTypes=true;
    });
  } finally {if(opened)await client.didClose(uri);unlisten();editor.setModel(previous);model.dispose();}
  return receipt;
}
