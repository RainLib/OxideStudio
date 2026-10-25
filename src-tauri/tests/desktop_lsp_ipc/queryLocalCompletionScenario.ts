import type * as Monaco from "monaco-editor";
import type {LspClient} from "@/services/lsp/client/LspClient";
import {DEFAULT_APP_SETTINGS} from "@/lib/appSettings";
import {defaultDatabaseCapabilities} from "@/lib/databaseDialect";
import {getSqlDocumentUri} from "@/services/lsp/document";
import {createQueryCompletionProvider} from "@/features/query-editor/model/createQueryCompletionProvider";
import {createCachedSqlCompletionRequest} from "@/features/query-editor/model/cachedSqlCompletion";
import {registerLspCompletionProvider} from "@/features/query-editor/hooks/useLspCompletionProviderCoordinator";
import {attachCompletionContextRefresh} from "@/features/query-editor/model/completionContextRefresh";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
export async function runQueryLocalCompletionAcceptance(options:{monaco:typeof import("monaco-editor/esm/vs/editor/editor.api.js");editor:Monaco.editor.IStandaloneCodeEditor;client:LspClient;check:(value:unknown,message:string)=>asserts value;step:(name:string,run:()=>Promise<void>)=>Promise<void>}) {
  const {monaco,editor,client,step}=options,check:typeof options.check=options.check,original=editor.getModel();
  const uri=getSqlDocumentUri("query-local-native","mysql"),id="cccccccc-1111-4111-8111-111111111111";
  const model=monaco.editor.createModel("","sql",monaco.Uri.parse(uri)),versions=new Map<string,number>(),texts=new Map<string,string>(),opened=new Set<string>(),generations=new Map<string,number>(),caches={fields:new Map(),joinConstraints:new Map()};
  const capabilities={...defaultDatabaseCapabilities("mysql"),lspLanguageId:"sql",lspServerDialect:"sqlserver"};
  const settings={...DEFAULT_APP_SETTINGS.editor,sqlCompletion:{...DEFAULT_APP_SETTINGS.editor.sqlCompletion,appendSpace:false,rankByUsage:false,snippets:[]}};
  const cacheOptions={connectionId:"native-query-local",activeProjectId:"native",currentSchema:"app",driver:"mysql",metadataRevision:1,schemaTables:[],sqlCompletion:settings.sqlCompletion,sqlFormatting:settings.sqlFormatting};
  let context:CompletionContextState={connection:{},runtime:{},metadataVersion:1,projectId:"native",route:"app",generation:{},available:true,syntaxAllowed:true,lspAllowed:true,metadataAllowed:true};
  const triggerOrigin:{current:"explicit"|"chained"|null}={current:"explicit"};
  const provider=createQueryCompletionProvider({getCompletionContext:()=>context,monaco,completionTriggerOriginRef:triggerOrigin,documentUri:uri,effectiveConnectionId:"native-query-local",isCurrentLspModelUri:value=>value===uri,activeTab:undefined,currentSchema:"app",activeConnection:undefined,metadataVersion:1,editorSettings:settings,usageScope:"native-query-local",completionRequestGenerationRef:{current:generations},createCachedSqlCompletionRequest:request=>createCachedSqlCompletionRequest(cacheOptions,caches,request),capabilities,rankByUsage:false,completionOwnerKey:"native-query-local",driver:"mysql",batchColumnSessionsRef:{current:new Map()},preferredElasticsearchIndex:undefined,lspReady:true,documentLanguageId:"sql",lspClient:client,openedDocumentsRef:{current:opened},documentVersionsRef:{current:versions},documentTextsRef:{current:texts},mountedEditor:editor});
  const runtime={...provider,ownerKey:"native-query-local",usageScope:"native-query-local",rankByUsage:false,recordUsage:()=>{},triggerChainedCompletion:()=>{}};
  const registration=registerLspCompletionProvider({editorLanguageId:"sql",monaco,getRuntime:()=>runtime,triggerCharacters:["."],usageCommandId:"oxide.native.query-local"});
  let notify=()=>{},refresh:ReturnType<typeof attachCompletionContextRefresh>|undefined;
  const originalFull=client.getCompletionList,originalLocal=client.getDocumentCompletions;
  let physical=0,local=0;const frames:Array<{dialect:string;version:number;labels:string[]}>=[];
  client.getCompletionList=(...args)=>{physical++;return originalFull.apply(client,args);};
  client.getDocumentCompletions=async(...args)=>{local++;const result=await originalLocal.apply(client,args);frames.push({dialect:args[0].dialect,version:args[0].version,labels:result?.items.map(item=>item.label)??[]});return result;};
  const widget=()=>editor.getDomNode()?.querySelector<HTMLElement>(".suggest-widget.visible");
  const wait=async(test:()=>boolean,message:string)=>{const end=Date.now()+15000;while(!test()&&Date.now()<end)await new Promise(done=>setTimeout(done,20));check(test(),message+"; "+JSON.stringify({sql:model.getValue(),widget:widget()?.textContent,physical,local,frames}));};
  const at=(marked:string)=>{editor.trigger("query.local","hideSuggestWidget",{});model.setValue(marked.replace("|",""));editor.setPosition(model.getPositionAt(marked.indexOf("|")));editor.focus();triggerOrigin.current="explicit";};
  try {
    editor.setModel(model);
    await client.updateConfiguration({oxideAnalysisToken:"query-local-native",defaultDialect:"sqlserver",fileDialects:{[uri]:"sqlserver"},fileSchemas:{[uri]:id},schemas:[{id,database:"app",functions:[],tables:[{name:"private_catalog",columns:[{name:"secret_value",data_type:"varchar(42)",nullable:false}]}]}]});
    check(await client.confirmAnalysisConfiguration("query-local-native"),"actual server commits the warm profile before its renderer grant is withdrawn");
    await step("main-query-local-widget-while-physical-availability-is-held",async()=>{
      at("WITH seed AS (SELECT CAST(1 AS INTEGER) AS local_id), q AS (SELECT s.* FROM seed s) SELECT q.loc|Suffix FROM q; SELECT p.secret_value FROM private_catalog p;");
      editor.trigger("query.local","editor.action.triggerSuggest",{});await wait(()=>Boolean(widget()?.textContent?.includes("local_id")),"standard production query provider displays its real local candidate");
      check(physical>0&&local===0,"initial shared query list uses a confirmed standard RPC");const before=physical;
      refresh=attachCompletionContextRefresh({editor,read:()=>context,subscribe:listener=>{notify=listener;return()=>{};},allowDocumentOnly:true,invalidate:()=>generations.clear()});
      context={...context,available:false,lspAllowed:false,metadataAllowed:false,generation:{}};notify();
      await wait(()=>frames.length>0&&Boolean(widget()?.textContent?.includes("local_id")),"the same visible query interaction recovers from document semantics while physical availability stays false");
      check(physical===before,"pending main-query recovery never reads the physical completion catalog");check(frames.every(frame=>frame.dialect==="sqlserver"&&!frame.labels.includes("secret_value")),"explicit capability profile wins over a mysql URI and keeps catalog fields out");
      check((await client.getDocumentSymbols(uri)).some(item=>item.name==="private_catalog"),"the actual warm catalog remains present on the shared server");
      editor.trigger("query.local","acceptSelectedSuggestion",{});await wait(()=>model.getValue().includes("SELECT q.local_id FROM q")&&!model.getValue().includes("Suffix"),"real main-query scoped suggestion consumes the entire suffix");
      check(caches.fields.size===0,"document-only shared provider leaves physical field caches empty");
    });
    await step("main-query-quoted-table-variable-widget-and-physical-recovery",async()=>{
      at("DECLARE @local TABLE([UNIQUE] int, unique_count nvarchar(42)); SELECT l.UNIQUE|Suffix FROM @local l;");editor.trigger("query.local","editor.action.triggerSuggest",{});
      await wait(()=>Boolean(widget()?.textContent?.includes("UNIQUE")),"actual query widget includes a quoted reserved-word table-variable column");editor.trigger("query.local","acceptSelectedSuggestion",{});
      await wait(()=>!model.getValue().includes("Suffix")&&/SELECT l\.(?:\[UNIQUE\]|"UNIQUE") FROM/u.test(model.getValue()),"actual reserved-word acceptance retains safe T-SQL identifier quoting");
      at("SELECT p.se|Suffix FROM private_catalog p;");const before=physical;context={...context,available:true,lspAllowed:true,metadataAllowed:false,generation:{}};notify();editor.trigger("query.local","editor.action.triggerSuggest",{});
      await wait(()=>physical>before&&Boolean(widget()?.textContent?.includes("secret_value")),"independent committed server grant restores physical candidates while renderer metadata remains incomplete");editor.trigger("query.local","acceptSelectedSuggestion",{});
      await wait(()=>model.getValue()==="SELECT p.secret_value FROM private_catalog p;","restored physical candidate accepts its exact field identity");
    });
    await step("main-query-bit-values-standard-and-document-only-widget-acceptance",async()=>{
      for(const documentOnly of [false,true]){
        context={...context,available:!documentOnly,lspAllowed:!documentOnly,metadataAllowed:false,generation:{}};notify();
        const before=documentOnly?local:physical;
        at("DECLARE @jobs TABLE(flags bit); SELECT * FROM @jobs WHERE flags = |;");editor.trigger("query.local","editor.action.triggerSuggest",{});
        await wait(()=>(documentOnly?local:physical)>before&&Boolean(widget()?.querySelector(".monaco-list-row .label-name")?.textContent?.includes("0")),"real main query offers numeric BIT values through "+(documentOnly?"document-only":"standard")+" RPC");
        const labels=Array.from(widget()!.querySelectorAll(".monaco-list-row .label-name")).map(node=>node.textContent?.toUpperCase());
        check(!labels.includes("TRUE")&&!labels.includes("FALSE"),"main provider does not reintroduce T-SQL truth keywords");
        for(let index=0;index<32&&widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent!=="0";index++)editor.trigger("query.local","selectNextSuggestion",{});
        check(widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent==="0","actual suggestion focus selects numeric BIT zero");
        editor.trigger("query.local","acceptSelectedSuggestion",{});
        await wait(()=>model.getValue()==="DECLARE @jobs TABLE(flags bit); SELECT * FROM @jobs WHERE flags = 0;","actual numeric BIT acceptance preserves the existing statement");
      }
    });
    await step("main-query-is-keywords-real-widget-and-utf16-acceptance",async()=>{
      for(const documentOnly of [false,true]){
        context={...context,available:!documentOnly,lspAllowed:!documentOnly,metadataAllowed:false,generation:{}};notify();
        const before=documentOnly?local:physical;
        at("/*😀*/ DECLARE @jobs TABLE(flags bit); SELECT * FROM @jobs WHERE flags IS|;");editor.trigger("query.local","editor.action.triggerSuggest",{});
        await wait(()=>(documentOnly?local:physical)>before&&Array.from(widget()?.querySelectorAll(".monaco-list-row .label-name")??[]).some(node=>node.textContent==="NULL"),"real main IS widget recovers a keyword-only list through "+(documentOnly?"document-only":"standard")+" RPC");
        const labels=Array.from(widget()!.querySelectorAll(".monaco-list-row .label-name")).map(node=>node.textContent);
        check(labels.every(label=>label==="NULL"||label==="NOT NULL"),"IS widget excludes unrelated functions, fields and syntax keywords");
        for(let index=0;index<16&&widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent!=="NULL";index++)editor.trigger("query.local","selectNextSuggestion",{});
        editor.trigger("query.local","acceptSelectedSuggestion",{});
        await wait(()=>model.getValue()==="/*😀*/ DECLARE @jobs TABLE(flags bit); SELECT * FROM @jobs WHERE flags IS NULL;","actual IS acceptance preserves the complete keyword and Unicode source");
      }
    });
    try{
      capabilities.lspServerDialect="postgres";
      await client.updateConfiguration({oxideAnalysisToken:"query-local-pg",defaultDialect:"postgres",fileDialects:{[uri]:"postgres"},fileSchemas:{[uri]:id},schemas:[{id,database:"app",functions:[],tables:[{name:"private_catalog",columns:[{name:"secret_value",data_type:"varchar(42)",nullable:false}]}]}]});
      check(await client.confirmAnalysisConfiguration("query-local-pg"),"real server confirms the explicit PostgreSQL profile over the existing mysql URI");
      const expressionSets=[
        {name:"expression-types",values:[["CAST(1 AS INTEGER)",false],["CASE WHEN TRUE THEN 1 ELSE 0 END",false],["COALESCE(1,0)",false],["LOWER('TRUE')",false],["CAST(TRUE AS BOOLEAN)",true],["'true'",true]]},
        {name:"catalog-types",values:[["CAST(1 AS pg_catalog.int4)",false],['CAST(1 AS "pg_catalog"."int4")',false],["CAST(1 AS pg_catalog.int4) + 2",false],["COALESCE(CAST(1 AS pg_catalog.int2), CAST(2 AS INTEGER))",false],["CAST(NULL AS pg_catalog._bool)",false],["CAST(TRUE AS pg_catalog.bool)",true]]},
      ] as const;
      for(const set of expressionSets)for(const documentOnly of [false,true])await step("main-query-pg-"+set.name+"-"+(documentOnly?"document-only":"standard")+"-widget",async()=>{
        context={...context,available:!documentOnly,lspAllowed:!documentOnly,metadataAllowed:false,generation:{}};notify();
        for(const [expression,truth] of set.values){
          const before=documentOnly?local:physical,choice=truth?"TRUE":"NULL";
          at("/*😀*/ SELECT "+expression+" IS|;");editor.trigger("query.local","editor.action.triggerSuggest",{});
          await wait(()=>(documentOnly?local:physical)>before&&Array.from(widget()?.querySelectorAll(".monaco-list-row .label-name")??[]).some(node=>node.textContent===choice),"real PostgreSQL expression widget offers "+choice+" for "+expression);
          const labels=Array.from(widget()!.querySelectorAll(".monaco-list-row .label-name")).map(node=>node.textContent);
          check(labels.includes("TRUE")===truth,"actual suggestion list respects the inferred subject type: "+expression);
          for(let index=0;index<20&&widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent!==choice;index++)editor.trigger("query.local","selectNextSuggestion",{});
          check(widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent===choice,"actual expression keyword receives selection focus");
          editor.trigger("query.local","acceptSelectedSuggestion",{});
          await wait(()=>model.getValue()==="/*😀*/ SELECT "+expression+" IS "+choice+";","real typed keyword acceptance preserves the whole expression and UTF-16 source");
        }
      });
      for(const profile of ["duckdb","hive","clickhouse","sqlite"]){
        capabilities.lspServerDialect=profile;
        const token="query-predicates-"+profile;await client.updateConfiguration({oxideAnalysisToken:token,defaultDialect:profile,fileDialects:{[uri]:profile},fileSchemas:{[uri]:id},schemas:[{id,database:"app",functions:[],tables:[{name:"private_catalog",columns:[{name:"secret_value",data_type:"varchar(42)",nullable:false}]}]}]});
        check(await client.confirmAnalysisConfiguration(token),"real server confirms the explicit analytic profile "+profile);
        for(const documentOnly of [false,true])await step("main-query-"+profile+"-predicate-logical-"+(documentOnly?"document-only":"standard")+"-widget",async()=>{
          context={...context,available:!documentOnly,lspAllowed:!documentOnly,metadataAllowed:false,generation:{}};notify();
          for(const expression of ["NOT EXISTS(SELECT NULL WHERE 1=0)","CASE WHEN 1=1 THEN EXISTS(SELECT NULL) ELSE EXISTS(SELECT 1) END"]){
            const before=documentOnly?local:physical,source="/*😀*/\r\nSELECT 1 WHERE "+expression+" ";at(source+"O|Suffix;");editor.trigger("query.local","editor.action.triggerSuggest",{});
            await wait(()=>(documentOnly?local:physical)>before&&Array.from(widget()?.querySelectorAll(".monaco-list-row .label-name")??[]).some(node=>node.textContent==="OR"),"actual analytic predicate widget offers a logical OR: "+profile);
            for(let index=0;index<40&&widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent!=="OR";index++)editor.trigger("query.local","selectNextSuggestion",{});
            check(widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent==="OR","actual analytic logical keyword receives focus");editor.trigger("query.local","acceptSelectedSuggestion",{});
            await wait(()=>model.getValue()===source+"OR ;","actual analytic operator consumes the full suffix while preserving multiline UTF-16 SQL");
          }
        });
      }
      for(const [profile,choice,expressions] of [
        ["duckdb","TRUE",["'oxide' ILIKE 'OX%'","regexp_matches('oxide','^ox')"]],
        ["clickhouse","0",["'oxide' ILIKE 'OX%'","match('oxide','^ox')"]],
        ["hive","TRUE",["'oxide' RLIKE '^ox'","'oxide' REGEXP '^ox'"]],
        ["mysql","0",["'oxide' REGEXP '^ox'","'oxide' RLIKE '^ox'"]],
        ["sqlite","0",["'oxide' GLOB 'ox*'","'oxide' NOT GLOB 'db*'"]],
      ] as const){
        capabilities.lspServerDialect=profile;
        const token="query-patterns-"+profile;await client.updateConfiguration({oxideAnalysisToken:token,defaultDialect:profile,fileDialects:{[uri]:profile},fileSchemas:{[uri]:id},schemas:[{id,database:"app",functions:[],tables:[]}]});
        check(await client.confirmAnalysisConfiguration(token),"actual server confirms the explicit pattern profile "+profile);
        for(const documentOnly of [false,true])await step("main-query-"+profile+"-pattern-result-"+(documentOnly?"document-only":"standard")+"-widget",async()=>{
          context={...context,available:!documentOnly,lspAllowed:!documentOnly,metadataAllowed:false,generation:{}};notify();
          for(const expression of expressions){
            const before=documentOnly?local:physical,source="/*😀*/\r\nWITH q AS (SELECT "+expression+" AS matched) SELECT 1 FROM q WHERE q.matched = ";at(source+"|Suffix;");editor.trigger("query.local","editor.action.triggerSuggest",{});
            await wait(()=>(documentOnly?local:physical)>before&&Array.from(widget()?.querySelectorAll(".monaco-list-row .label-name")??[]).some(node=>node.textContent===choice),"actual query widget offers the pattern result value for "+profile);
            const labels=Array.from(widget()!.querySelectorAll(".monaco-list-row .label-name")).map(node=>node.textContent);
            check(choice==="TRUE"?!labels.includes("0"):!labels.includes("TRUE"),"actual pattern list distinguishes Boolean and numeric dialect results");
            for(let index=0;index<40&&widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent!==choice;index++)editor.trigger("query.local","selectNextSuggestion",{});
            check(widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent===choice,"actual pattern result receives selection focus");editor.trigger("query.local","acceptSelectedSuggestion",{});
            await wait(()=>model.getValue()===source+choice+";","pattern result acceptance consumes the full suffix and preserves Unicode SQL");
          }
        });
      }
      for(const profile of ["postgres","duckdb","mysql","sqlite","sqlserver"]){
        capabilities.lspServerDialect=profile;
        const token="query-escape-"+profile;await client.updateConfiguration({oxideAnalysisToken:token,defaultDialect:profile,fileDialects:{[uri]:profile},fileSchemas:{[uri]:id},schemas:[{id,database:"app",functions:[],tables:[]}]});
        check(await client.confirmAnalysisConfiguration(token),"actual server confirms the explicit ESCAPE profile "+profile);
        for(const documentOnly of [false,true])await step("main-query-"+profile+"-escape-character-"+(documentOnly?"document-only":"standard")+"-widget",async()=>{
          context={...context,available:!documentOnly,lspAllowed:!documentOnly,metadataAllowed:false,generation:{}};notify();
          const before=documentOnly?local:physical,source="/*😀*/\r\nSELECT 1 WHERE LOWER('oxide_1') LIKE 'oxide#_1' ESCAPE ";
          at(source+"|Suffix;");editor.trigger("query.local","editor.action.triggerSuggest",{});
          await wait(()=>(documentOnly?local:physical)>before&&Array.from(widget()?.querySelectorAll(".monaco-list-row .label-name")??[]).some(node=>node.textContent==="'#'"),"actual query widget offers a one-character escape literal");
          const labels=Array.from(widget()!.querySelectorAll(".monaco-list-row .label-name")).map(node=>node.textContent);
          check(!labels.includes("TRUE")&&!labels.includes("FALSE")&&!labels.includes("0")&&!labels.includes("''"),"escape suggestions omit generic truth, numeric and empty literals");
          for(let index=0;index<40&&widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent!=="'#'";index++)editor.trigger("query.local","selectNextSuggestion",{});
          check(widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent==="'#'","actual escape character receives selection focus");editor.trigger("query.local","acceptSelectedSuggestion",{});
          await wait(()=>model.getValue()===source+"'#';","actual escape acceptance replaces the whole suffix and preserves Unicode SQL");
        });
      }
      for(const profile of ["postgres","duckdb","mysql","sqlite","sqlserver","hive","clickhouse"]){
        capabilities.lspServerDialect=profile;
        const token="query-pattern-continuation-"+profile;await client.updateConfiguration({oxideAnalysisToken:token,defaultDialect:profile,fileDialects:{[uri]:profile},fileSchemas:{[uri]:id},schemas:[{id,database:"app",server_version:profile==="clickhouse"?"26.6.1.123":undefined,functions:[],tables:[]}]});
        check(await client.confirmAnalysisConfiguration(token),"actual server confirms the pattern continuation profile "+profile);
        for(const documentOnly of [false,true])await step("main-query-"+profile+"-pattern-continuation-"+(documentOnly?"document-only":"standard")+"-widget",async()=>{
          context={...context,available:!documentOnly,lspAllowed:!documentOnly,metadataAllowed:false,generation:{}};notify();
          const source="/*😀*/\r\nSELECT 1 WHERE LOWER('oxide_1') LIKE 'oxide#_1' ";
          const shouldEscape=profile!=="hive"&&(profile!=="clickhouse"||!documentOnly);
          const choose=async(label:string,expected:string)=>{
            for(let index=0;index<50&&widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent!==label;index++)editor.trigger("query.local","selectNextSuggestion",{});
            check(widget()?.querySelector(".monaco-list-row.focused .label-name")?.textContent===label,"actual continuation receives selection focus: "+label);editor.trigger("query.local","acceptSelectedSuggestion",{});
            await wait(()=>model.getValue()===expected,"actual continuation consumes the full suffix: "+label);
          };
          if(shouldEscape){
            const before=documentOnly?local:physical;at(source+"E|Suffix;");editor.trigger("query.local","editor.action.triggerSuggest",{});
            await wait(()=>(documentOnly?local:physical)>before&&Array.from(widget()?.querySelectorAll(".monaco-list-row .label-name")??[]).some(node=>node.textContent==="ESCAPE"),"actual matching expression discovers optional ESCAPE");
            await choose("ESCAPE",source+"ESCAPE ;");
          }
          const logicalSource=source+(shouldEscape?"ESCAPE '#' ":""),before=documentOnly?local:physical;
          at(logicalSource+"A|Suffix;");editor.trigger("query.local","editor.action.triggerSuggest",{});
          await wait(()=>(documentOnly?local:physical)>before&&Array.from(widget()?.querySelectorAll(".monaco-list-row .label-name")??[]).some(node=>node.textContent==="AND"),"actual completed matching predicate offers logical continuation");
          await choose("AND",logicalSource+"AND ;");
        });
      }
    }finally{
      capabilities.lspServerDialect="sqlserver";
      await client.updateConfiguration({oxideAnalysisToken:"query-local-native",defaultDialect:"sqlserver",fileDialects:{[uri]:"sqlserver"},fileSchemas:{[uri]:id},schemas:[{id,database:"app",functions:[],tables:[{name:"private_catalog",columns:[{name:"secret_value",data_type:"varchar(42)",nullable:false}]}]}]});
    }
    return {productionQueryProvider:true,documentOnlyWhileUnavailable:true,automaticWidgetRecovery:true,quotedTableVariableAcceptance:true,physicalGrantRecovery:true,warmCatalogRetained:true,profileBitWidgetAcceptance:true,isKeywordWidgetAcceptance:true,postgresExpressionWidgetAcceptance:true,postgresCatalogTypeWidgetAcceptance:true,analyticPredicateWidgetAcceptance:true,patternResultWidgetAcceptance:true,escapeCharacterWidgetAcceptance:true,patternContinuationWidgetAcceptance:true,realSqlServer:false,realPostgres:false,frames};
  }finally{refresh?.dispose();registration.dispose();client.getCompletionList=originalFull;client.getDocumentCompletions=originalLocal;for(const openedUri of opened)await client.didClose(openedUri);editor.setModel(original);model.dispose();}
}
