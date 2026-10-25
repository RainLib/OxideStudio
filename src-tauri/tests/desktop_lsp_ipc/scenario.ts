import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/editor/contrib/snippet/browser/snippetController2.js";
import "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js";
import { runLiveNamespaceAcceptance } from "./liveNamespaceScenario";
import { runSemanticOperationAcceptance } from "./semanticOperationScenario";
import {runFileQueryIntelligenceAcceptance} from "./fileQueryScenario";
import {runOperationConsumerAcceptance} from "./operationConsumerScenario";
import { runCachedCompletionAcceptance } from "./cachedScenario";
import {runQueryLocalCompletionAcceptance} from "./queryLocalCompletionScenario";
import {runWhereCompletionAcceptance} from "./whereCompletionScenario";
import { runDocumentBindingsAcceptance } from "./documentBindingsScenario";
import {runMainRestartAcceptance} from "./mainRestartScenario";
import {runSharedDocumentAcceptance} from "./sharedDocumentScenario";
import {runSharedLocalMarkersAcceptance} from "./sharedLocalMarkersScenario";
import {runDocumentStructureAcceptance} from "./documentStructureScenario";
import {runDocumentSemanticsAcceptance} from "./documentSemanticsScenario";
import {runMultiDocumentSemanticsAcceptance} from "./multiDocumentSemanticsScenario";
import {runMultiDocumentFormattingAcceptance} from "./multiDocumentScenario";
import { LspClient } from "@/services/lsp/client/LspClient";
import { lspCompletionItemsToMonacoSuggestions } from "@/features/query-editor/model/lspCompletionPresentation";
import type { CompletionItem } from "@/services/lsp/types";

async function run() {
  const clients = [new LspClient("desktop-acceptance-pg"), new LspClient("desktop-acceptance-my")] as const;
  const [pg, my] = clients;
  let pgDialect: "postgres" | "clickhouse" | "hive" = "postgres";
  let myDialect: "mysql" | "sqlserver" = "mysql";
  const uri = "oxide://desktop/acceptance.mysql.sql";
  const id = "aaaaaaaa-1111-4111-8111-111111111111";
  let assertions = 0;
  const check: (value: unknown, message: string) => asserts value = (value,message) => { assertions++; if (!value) throw new Error(message); };
  let liveNamespace:Awaited<ReturnType<typeof runLiveNamespaceAcceptance>>|undefined;
  let semanticOperations:Awaited<ReturnType<typeof runSemanticOperationAcceptance>>|undefined;
  let semanticConsumer:Awaited<ReturnType<typeof runOperationConsumerAcceptance>>|undefined;
  let fileQueryIntelligence:Awaited<ReturnType<typeof runFileQueryIntelligenceAcceptance>>|undefined;
  let configurationReceipt:{realHostTransport:boolean;withoutDocuments:boolean;overwriteRevoked:boolean;restartRevoked:boolean}|undefined;
  let multiDocumentFormatting:Awaited<ReturnType<typeof runMultiDocumentFormattingAcceptance>>|undefined;
  let multiDocumentSemantics:Awaited<ReturnType<typeof runMultiDocumentSemanticsAcceptance>>|undefined;
  let mainRestart:Awaited<ReturnType<typeof runMainRestartAcceptance>>|undefined;
  let sharedDocument:Awaited<ReturnType<typeof runSharedDocumentAcceptance>>|undefined;
  let sharedLocalMarkers:Awaited<ReturnType<typeof runSharedLocalMarkersAcceptance>>|undefined;
  let documentStructure:Awaited<ReturnType<typeof runDocumentStructureAcceptance>>|undefined;
  let documentSemantics:Awaited<ReturnType<typeof runDocumentSemanticsAcceptance>>|undefined;
  const receipts: Array<{name:string; milliseconds:number}> = [];
  const step = async (name:string, action:()=>Promise<void>) => { await invoke("acceptance_progress", {name,phase:"start"}); const start=performance.now(); await action(); receipts.push({name,milliseconds:performance.now()-start}); await invoke("acceptance_progress", {name,phase:"end"}); };
  type ObservedDiagnostic={severity?:number;message:string;code?:string|number;range:{start:{line:number;character:number};end:{line:number;character:number}}};
  const diagnostics = new Map<string, {version:number; diagnostics:ObservedDiagnostic[]}>();
  const unlisten = await listen<{sessionKey?:string;method:string;params:any}>("lsp-notification",event=>{
    const value=event.payload;if(value.method==="textDocument/publishDiagnostics") diagnostics.set(`${value.sessionKey}:${value.params.uri}`,value.params);
  });
  monaco.languages.register({id:"sql"});
  const model=monaco.editor.createModel("","sql");
  const editor=monaco.editor.create(document.getElementById("editor")!,{model,dimension:{width:800,height:400},automaticLayout:false,wordBasedSuggestions:"off",minimap:{enabled:false},autoClosingBrackets:"never",autoClosingQuotes:"never",unicodeHighlight:{nonBasicASCII:false,invisibleCharacters:false,ambiguousCharacters:false}});
  const opened=new Set<LspClient>();
  const diagnosticCheck=async(client:LspClient,version:number,expectError=false)=>{
    const end=Date.now()+10000;let value: {version:number;diagnostics:ObservedDiagnostic[]}|undefined;
    while(Date.now()<end){value=diagnostics.get(`${client.getSessionKey()}:${uri}`);if(value?.version===version)break;await new Promise(resolve=>setTimeout(resolve,20));}
    check(value?.version===version,`diagnostic event deadline: ${client.getSessionKey()} v${version}`);
    check(expectError?value.diagnostics.some(item=>item.severity===1):value.diagnostics.every(item=>item.severity!==1),`SQL diagnostics (expectError=${expectError}): ${JSON.stringify(value.diagnostics)}`);
  };
  const synchronize=async(client:LspClient,expectError=false)=>{
    const version=model.getVersionId();
    if(opened.has(client)) await client.didChange(uri,model.getValue(),version);
    else {await client.didOpen(uri,model.getValue(),version,"mysql");opened.add(client);}
    await diagnosticCheck(client,version,expectError);
  };
  const documentAt=async(client:LspClient,marked:string,expectError=false)=>{
    const offset=marked.indexOf("<cursor>");check(offset>=0,"cursor fixture");model.setValue(marked.replace("<cursor>",""));editor.setPosition(model.getPositionAt(offset));await synchronize(client,expectError);return offset;
  };
  const candidates=async(client:LspClient,offset:number)=>{
    const position=model.getPositionAt(offset);const list=await client.getCompletionList(uri,position.lineNumber-1,position.column-1);check(list.items.length>0,"real completion response");return list.items;
  };
  const apply=async(client:LspClient,item:CompletionItem,offset:number,expectError=false)=>{
    const resolved=await client.resolveCompletionItem(item);const position=model.getPositionAt(offset);
    const [suggestion]=lspCompletionItemsToMonacoSuggestions({monaco,ownerKey:"desktop-acceptance",items:[resolved],typedWord:model.getWordUntilPosition(position).word,completedContextKeyword:false,defaultRange:new monaco.Range(position.lineNumber,position.column,position.lineNumber,position.column),rankByUsage:false,usageScope:"desktop-acceptance",recordUsageCommand:"unused.acceptance",driver:client===pg?pgDialect:myDialect,nextCharacter:model.getValue()[offset]});
    check(suggestion,"Monaco suggestion conversion");
    const range="replace" in suggestion.range?suggestion.range.replace:suggestion.range;
    check(range.containsPosition(position),"Monaco replacement contains UTF-16 caret");editor.setSelection(range);
    if((suggestion.insertTextRules??0)&monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet){
      const snippet=editor.getContribution("snippetController2") as unknown as {insert(text:string):void};check(snippet,"real Monaco snippet controller");snippet.insert(suggestion.insertText);
    } else {editor.executeEdits("desktop-acceptance",[{range,text:suggestion.insertText}]);}
    await synchronize(client,expectError);return suggestion;
  };
  const param=(name:string,mode="IN")=>({name,data_type:"integer",optional:false,mode});
  const functions=(result="bigint")=>[
    {name:"calc",routine_type:"function",parameters:[param("value")],return_type:result},
    {name:"calc",routine_type:"function",parameters:[{...param("value"),data_type:"text"}],return_type:"uuid"},
    {name:"compose",routine_type:"function",parameters:[param("first"),param("second")],return_type:"integer"},
    {name:"calculate",routine_type:"procedure",parameters:[param("value"),param("result","OUT")],return_type:"void"},
  ];
  const config=(dialect:string,result="bigint")=>({schemas:[{id,database:"app",catalog:"db",tables:[{name:"users",columns:[{name:"name",data_type:"text",nullable:false},{name:dialect==="mysql"?"price":"id",data_type:dialect==="mysql"?"decimal(18,2)":"bigint",nullable:false}]}],functions:dialect==="mysql"?[]:functions(result)}],fileSchemas:{[uri]:id},fileDialects:{[uri]:dialect}});
  let binary:any;let failure:unknown;let cachedCompletion:unknown;let documentBindings:unknown;let queryDocumentCompletion:unknown;let whereCompletion:unknown;
  const defaultSchemaPerformanceSamples:Array<{otherCatalogs:number;columnsPerCatalog:number;rounds:number;warmup:number;fields:number;milliseconds:number[];p50Milliseconds:number;p95Milliseconds:number}>=[];
  try {
    binary=await invoke("check_lsp_binary");check(binary.exists&&binary.integrity_verified===true,"actual bundled path and digest");
    await step("initialize-two-production-sessions",async()=>{await pg.initialize(binary.path);await my.initialize(binary.path);check(await pg.isRunning()&&await my.isRunning(),"live session processes");await pg.updateConfiguration(config("postgres"));await my.updateConfiguration(config("mysql"));});
    await step("udf-cte-types-lazy-resolve-and-monaco-range",async()=>{
      const offset=await documentAt(pg,"/* 😀 */\r\n/* 😀 */ WITH p AS (SELECT app.calc(1) AS value) SELECT p.va<cursor>lue FROM p;");
      const item=(await candidates(pg,offset)).find(item=>item.label==="value");check(item?.detail==="Column: value (bigint)","UDF return in real client column");
      const suggestion=await apply(pg,item,offset);check(suggestion.range.startLineNumber===2,"one-based Monaco line after CRLF");
      const position=model.getPositionAt(offset);check(JSON.stringify(await pg.getHover(uri,position.lineNumber-1,position.column-1)).includes("bigint"),"real hover type");
    });
    await step("named-parameter-edit-signature-and-labels",async()=>{
      const offset=await documentAt(pg,"/* 😀 */\r\nSELECT compose(first=>1,se<cursor>cond /* keep */ => 2);");
      const item=(await candidates(pg,offset)).find(item=>item.label==="second"&&item.detail?.startsWith("Parameter:"));check(item,"named parameter across Tauri decoding");await apply(pg,item,offset);
      check(model.getValue().includes('"second" /* keep */ => 2'),"operator/comment/value preserved");
      const position=model.getPositionAt(model.getValue().lastIndexOf("2"));const help=await pg.getSignatureHelp(uri,position.lineNumber-1,position.column-1);check(help?.activeParameter===1,"named active declaration");
      const hints=await pg.getInlayHints(uri,{start:{line:0,character:0},end:{line:position.lineNumber,character:0}});check(hints.length===0,"no duplicate named labels");
    });
    await step("call-existing-arguments-and-output-mode",async()=>{
      const offset=await documentAt(pg,"/* 😀 */\r\nCALL app.ca<cursor>lculate /* keep */ (1,NULL);");
      const items=await candidates(pg,offset);check(items.every(item=>item.detail?.startsWith("Procedure:")),"CALL kind filtering");const item=items.find(item=>item.label==="calculate");check(item,"procedure target");await apply(pg,item,offset);
      check(model.getValue().includes('"calculate" /* keep */ (1,NULL)'),"existing invocation remains");const position=model.getPositionAt(model.getValue().indexOf("NULL"));const help=await pg.getSignatureHelp(uri,position.lineNumber-1,position.column-1);check(help?.activeParameter===1&&help.signatures[0]?.label.includes("OUT result"),"OUT mode survives actual app");
      const end=model.getPositionAt(model.getValueLength());const hints=await pg.getInlayHints(uri,{start:{line:0,character:0},end:{line:end.lineNumber-1,character:end.column-1}});check(hints.length===2,"actual parameter labels");
    });
    await step("new-call-snippet-real-monaco-caret",async()=>{
      const offset=await documentAt(pg,"CALL ca<cursor>;",true);const item=(await candidates(pg,offset)).find(item=>item.label==="calculate");check(item,"snippet target");await apply(pg,item,offset);
      check(model.getValue()==='CALL "calculate"();',"Monaco expands $0 without literal placeholders");check(model.getOffsetAt(editor.getPosition()!)===model.getValue().indexOf(")"),"caret inside call arguments");
      editor.trigger("desktop-acceptance","type",{text:"1,NULL"});await synchronize(pg);check(model.getValue()==='CALL "calculate"(1,NULL);',"typed arguments at snippet caret");
    });
    await step("postgres-fulltext-computed-result",async()=>{
      const offset=await documentAt(pg,"WITH p AS (SELECT to_tsvector('simple','chat') @@ plainto_tsquery('simple','chat') AS matched) SELECT p.ma<cursor>tched FROM p;");const item=(await candidates(pg,offset)).find(item=>item.label==="matched");check(item?.detail==="Column: matched (boolean)","advanced search type");await apply(pg,item,offset);
    });
    let mysqlOffset=0;
    await step("same-uri-second-session-mysql",async()=>{
      mysqlOffset=await documentAt(my,"SELECT u.pr<cursor>ice FROM users u;");const item=(await candidates(my,mysqlOffset)).find(item=>item.label==="price");check(item?.detail==="Column: price (decimal(18,2))","second-session catalog");await apply(my,item,mysqlOffset);
    });
    await step("metadata-refresh-without-document-change",async()=>{
      const offset=await documentAt(pg,"WITH p AS (SELECT app.calc(1) AS value) SELECT p.va<cursor>lue FROM p;");const version=model.getVersionId();await pg.updateConfiguration(config("postgres","uuid"));const item=(await candidates(pg,offset)).find(item=>item.label==="value");check(item?.detail==="Column: value (uuid)","new return type replaces old type");check(model.getVersionId()===version,"SQL/model unchanged during metadata update");
      const list=await my.getCompletions(uri,0,mysqlOffset);check(list.some(item=>item.label==="price"&&item.detail?.includes("decimal")),"other session unaffected by same-uri config update");
    });
    await step("sqlserver-execute-target-and-output-signature",async()=>{
      myDialect="sqlserver";
      await my.updateConfiguration({schemas:[{id,database:"app",catalog:"db",tables:[],functions:[{name:"calculate",routine_type:"procedure",return_type:"void",parameters:[{name:"@first",data_type:"int",optional:false,mode:"IN"},{name:"@second",data_type:"nvarchar",optional:true,mode:"OUT"}]}]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:"sqlserver"}});
      const offset=await documentAt(my,"/*😀*/ EXECUTE @s = [app].[ca<cursor>lculate] 1, @v OUTPUT;");
      const item=(await candidates(my,offset)).find(item=>item.label==="calculate");check(item,"EXEC procedure target");await apply(my,item,offset);
      check(model.getValue()==="/*😀*/ EXECUTE @s = [app].[calculate] 1, @v OUTPUT;","EXEC preserves unparenthesized actual arguments");
      const position=model.getPositionAt(model.getValue().indexOf("@v"));const help=await my.getSignatureHelp(uri,position.lineNumber-1,position.column-1);check(help?.activeParameter===1&&help.signatures[0]?.label.includes("OUT @second"),"EXEC OUT signature");
      const end=model.getPositionAt(model.getValueLength());const hints=await my.getInlayHints(uri,{start:{line:0,character:0},end:{line:end.lineNumber-1,character:end.column-1}});check(hints.length===2,"EXEC positional hints");
      const unknown=await documentAt(my,"EXEC SUM <cursor>1;");const at=model.getPositionAt(unknown);check(await my.getSignatureHelp(uri,at.lineNumber-1,at.column-1)===null,"unknown EXEC must not borrow builtin SUM signature");
    });
    await step("sqlserver-execute-named-parameter-monaco-edit",async()=>{
      const offset=await documentAt(my,"EXEC app.calculate 1, @se<cursor>cond /*keep*/ = @v OUTPUT;");const item=(await candidates(my,offset)).find(item=>item.label==="@second");check(item,"EXEC named parameter");await apply(my,item,offset);
      check(model.getValue()==="EXEC app.calculate 1, @second /*keep*/ = @v OUTPUT;","EXEC accepts name and keeps value/output");
      const position=model.getPositionAt(model.getValue().indexOf("@v"));const help=await my.getSignatureHelp(uri,position.lineNumber-1,position.column-1);check(help?.activeParameter===1,"EXEC bound active declaration slot");
      const unknown=await documentAt(pg,"CALL sum(<cursor>1);");const at=model.getPositionAt(unknown);check(await pg.getSignatureHelp(uri,at.lineNumber-1,at.column-1)===null,"unknown CALL must not borrow builtin SUM signature");
    });
    await step("sqlserver-execute-local-variable-value-edit",async()=>{
      const offset=await documentAt(my,"/*😀*/ DECLARE @value int=COALESCE(1,2);\r\n/*😀*/ EXEC app.calculate @first=@va<cursor>;");const list=await candidates(my,offset);
      const item=list[0];check(item&&list.length===1&&item.kind===6,"EXEC value list excludes generic SQL/functions/tables");check(item.detail?.includes("int"),"declared variable type");await apply(my,item,offset);
      check(model.getValue().endsWith("EXEC app.calculate @first=@value;"),"actual Monaco variable edit preserves @ and SQL");
    });
    await step("sqlserver-execute-default-and-output-value-edits",async()=>{
      let offset=await documentAt(my,"EXEC app.calculate 1, @second=DE<cursor>FAULT;");let item=(await candidates(my,offset)).find(item=>item.label==="DEFAULT");check(item,"optional parameter DEFAULT");await apply(my,item,offset);check(model.getValue()==="EXEC app.calculate 1, @second=DEFAULT;","DEFAULT complete leaf edit");
      offset=await documentAt(my,"DECLARE @sink nvarchar(max); EXEC app.calculate 1, @second=@sink O<cursor>;",true);item=(await candidates(my,offset)).find(item=>item.label==="OUTPUT");check(item,"OUT variable OUTPUT");await apply(my,item,offset);check(model.getValue().endsWith("@second=@sink OUTPUT;"),"OUTPUT accepted with no syntax errors");
    });
    await step("sqlserver-execute-capped-values-requery-after-typing",async()=>{
      const declarations=Array.from({length:1002},(_,n)=>`DECLARE @pick${String(n).padStart(4,"0")} int; `).join("");
      const offset=await documentAt(my,`${declarations}DECLARE @pick nvarchar(max); EXEC app.calculate @first=@pick<cursor>`);let position=model.getPositionAt(offset);let list=await my.getCompletionList(uri,position.lineNumber-1,position.column-1);
      check(list.isIncomplete&&list.items.length===100,"bounded list retains LSP incomplete marker");check(list.items[0]?.label==="@pick","late exact variable precedes compatible longer names");
      editor.trigger("desktop-acceptance","type",{text:"1001"});await synchronize(my);position=editor.getPosition()!;list=await my.getCompletionList(uri,position.lineNumber-1,position.column-1);
      const item=list.items[0];check(item&&!list.isIncomplete&&list.items.length===1&&item.label==="@pick1001","typed prefix requery recovers formerly omitted candidate");await apply(my,item,model.getOffsetAt(position));
    });
    await step("sqlserver-unicode-and-long-variable-monaco-edits",async()=>{
      for(const name of ["@金额$#",`@${"值".repeat(127)}`]){
        const prefix=name.slice(0,2);
        const offset=await documentAt(my,`/*😀*/ DECLARE ${name} int=1;\r\n/*😀*/ EXEC app.calculate @first=${prefix}<cursor>;`);
        const list=await candidates(my,offset);const item=list[0];
        check(item&&list.length===1&&item.label===name&&item.kind===6,"whole Unicode variable and declared type candidate");
        check(item.detail?.includes("int"),"Unicode variable retains type");await apply(my,item,offset);
        check(model.getValue().endsWith(`@first=${name};`),"Unicode variable whole-name Monaco edit");
      }
    });
    await step("sqlserver-unicode-parameter-real-snippet-and-typing",async()=>{
      await my.updateConfiguration({schemas:[{id,database:"app",catalog:"db",tables:[],functions:[{name:"calculate",routine_type:"procedure",return_type:"void",parameters:[{name:"@入参$#",data_type:"int",optional:false,mode:"IN"}]}]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:"sqlserver"}});
      const offset=await documentAt(my,"/*😀*/\r\nEXEC app.calculate @入<cursor>;");const item=(await candidates(my,offset)).find(item=>item.label==="@入参$#");check(item,"Unicode named parameter snippet");
      await apply(my,item,offset,true);
      check(model.getValue().replace(/\r\n/g,"\n")==="/*😀*/\nEXEC app.calculate @入参$# = ;","snippet preserves literal dollar and hash");
      editor.trigger("desktop-acceptance","type",{text:"1"});await synchronize(my);
      check(model.getValue().endsWith("EXEC app.calculate @入参$# = 1;"),"snippet caret accepts typed value with no diagnostics");
      const position=editor.getPosition()!;const help=await my.getSignatureHelp(uri,position.lineNumber-1,position.column-1);
      check(help?.activeParameter===0&&help.signatures[0]?.label.includes("@入参$#"),"Unicode metadata signature slot");
    });
    await step("sqlserver-module-procedure-parameter-exec-and-query-edits",async()=>{
      await my.updateConfiguration({schemas:[{id,database:"app",catalog:"db",tables:[],functions:[{name:"calculate",routine_type:"procedure",return_type:"void",parameters:[{name:"@first",data_type:"int",optional:false,mode:"IN"}]}]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:"sqlserver"}});
      for(const statement of ["EXEC app.calculate @first=@in<cursor>","SELECT CASE WHEN 1=1 THEN @in<cursor> ELSE 0 END;"]){
        const offset=await documentAt(my,`/*😀*/ CREATE OR ALTER PROC app.p @input int AS BEGIN\r\n/*😀*/ ${statement}\r\nEND;`);
        const list=await candidates(my,offset);const item=list.find(item=>item.label==="@input");
        check(item&&item.kind===6&&item.detail?.includes("int"),"module parameter typed candidate");
        await apply(my,item,offset);check(!model.getValue().includes("@in;"),"module parameter replaces whole prefix");
        check(model.getValue().includes(statement.replace("@in<cursor>","@input")),"real procedure parameter edit");
      }
    });
    await step("sqlserver-module-function-return-and-inline-table-edits",async()=>{
      for(const marked of ["CREATE FUNCTION app.f(@input int) RETURNS int AS BEGIN RETURN COALESCE(@in<cursor>,0); END;","CREATE OR ALTER FUNCTION app.f(@input int) RETURNS TABLE AS RETURN (WITH c AS (SELECT @in<cursor> AS id) SELECT c.id FROM c);"]){
        const offset=await documentAt(my,marked);const item=(await candidates(my,offset)).find(item=>item.label==="@input");
        check(item,"function parameter expression candidate");await apply(my,item,offset);
        check(model.getValue()===marked.replace("@in<cursor>","@input"),"scalar/inline function complete-name edit");
      }
    });
    await step("sqlserver-module-parameter-requery-and-go-isolation",async()=>{
      const parameters=Array.from({length:2100},(_,n)=>`@arg${String(n).padStart(4,"0")} int`).join(",");
      let offset=await documentAt(my,`CREATE PROC app.p ${parameters} AS BEGIN SELECT @arg<cursor>; END;`);
      let position=model.getPositionAt(offset);let list=await my.getCompletionList(uri,position.lineNumber-1,position.column-1);
      check(list.isIncomplete&&list.items.length===100,"2100 parameter menu is bounded and incomplete");
      editor.trigger("desktop-acceptance","type",{text:"2099"});await synchronize(my);position=editor.getPosition()!;
      list=await my.getCompletionList(uri,position.lineNumber-1,position.column-1);let item=list.items[0];
      check(item&&!list.isIncomplete&&list.items.length===1&&item.label==="@arg2099","typed requery reaches last legal parameter");await apply(my,item,model.getOffsetAt(position));
      offset=await documentAt(my,"CREATE PROC app.p @sharedSecret int AS BEGIN SELECT @sharedSecret; END\r\nGO 2 -- batch\r\nCREATE PROC app.q @sharedVisible int AS BEGIN SELECT @sh<cursor>; END;");
      const visible=await candidates(my,offset);item=visible[0];
      check(item&&visible.length===1&&item.label==="@sharedVisible","GO hides earlier module parameter with same prefix");await apply(my,item,offset);
      check(model.getValue().endsWith("SELECT @sharedVisible; END;"),"new module parameter accepted after GO");
    });
    const typedConfig=(result="bigint")=>({schemas:[{id,database:"app",catalog:"db",tables:[],functions:[
      {name:"pick",routine_type:"function",return_type:"nvarchar(max)",parameters:[{name:"wrong",data_type:"int",optional:false,mode:"IN"}]},
      {name:"pick",routine_type:"function",return_type:result,parameters:[{name:"wanted",data_type:"bigint",optional:false,mode:"IN"}]},
    ]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:"sqlserver"}});
    const typedValue=async(offset:number,type:string)=>{
      const item=(await candidates(my,offset)).find(item=>item.label==="value");
      check(item?.detail===`Column: value (${type})`,"declaration type reaches real column list");
      const resolved=await my.resolveCompletionItem(item);
      check(resolved.detail===item.detail,"resolved type matches the original candidate");
      check(JSON.stringify(resolved.documentation)?.includes("Nullable: yes"),"declaration nullability stays conservative");
      const position=model.getPositionAt(offset);
      check(JSON.stringify(await my.getHover(uri,position.lineNumber-1,position.column-1)).includes(type),"declaration type reaches hover");
      return resolved;
    };
    await step("sqlserver-declaration-types-complex-projections-and-monaco-edits",async()=>{
      await my.updateConfiguration(typedConfig());
      for(const [marked,type] of [
        ["/*😀*/ DECLARE @金额$ bigint;\r\nWITH p AS(SELECT @金额$ AS value),q AS(SELECT value FROM p) SELECT q.va<cursor>lue FROM q;","bigint"],
        ["DECLARE @input datetime2(3); SELECT d.va<cursor>lue FROM (SELECT (SELECT @input) AS value) d;","datetime2(3)"],
        ["CREATE PROC app.p @input nvarchar(max) AS BEGIN WITH p AS(SELECT COALESCE(@input,@input) AS value) SELECT p.va<cursor>lue FROM p; END;","nvarchar(max)"],
      ] as const){
        const offset=await documentAt(my,marked);const item=await typedValue(offset,type);await apply(my,item,offset);
        check(model.getValue().replace(/\r\n/g,"\n")===marked.replace("va<cursor>lue","value").replace(/\r\n/g,"\n"),"typed column accepts whole original token");
      }
    });
    await step("sqlserver-variable-signature-and-udf-metadata-refresh",async()=>{
      let offset=await documentAt(my,"DECLARE @input bigint; SELECT app.pick(@input<cursor>);");let position=model.getPositionAt(offset);
      const help=await my.getSignatureHelp(uri,position.lineNumber-1,position.column-1);
      check(help?.signatures.length===2&&help.signatures[0]?.label.includes("wanted"),"known variable selects matching signature");
      offset=await documentAt(my,"DECLARE @input bigint; WITH p AS(SELECT app.pick(@input) AS value) SELECT p.va<cursor>lue FROM p;");
      await typedValue(offset,"bigint");const version=model.getVersionId();
      await my.updateConfiguration(typedConfig("uniqueidentifier"));const item=await typedValue(offset,"uniqueidentifier");
      check(model.getVersionId()===version,"return metadata refresh requires no SQL edit");await apply(my,item,offset);
    });
    await step("sqlserver-variable-types-edit-refresh-go-and-large-module",async()=>{
      let offset=await documentAt(my,"DECLARE @input int; WITH p AS(SELECT @input AS value) SELECT p.va<cursor>lue FROM p;");await typedValue(offset,"int");
      const start=model.getValue().indexOf(" int;");editor.executeEdits("desktop-acceptance",[{range:new monaco.Range(1,start+2,1,start+5),text:"bigint"}]);await synchronize(my);
      offset=model.getValue().lastIndexOf("value FROM")+2;await typedValue(offset,"bigint");
      offset=await documentAt(my,"DECLARE @input bigint;\nGO\nWITH p AS(SELECT @input AS value) SELECT p.va<cursor>lue FROM p;");await typedValue(offset,"unknown");
      const parameters=Array.from({length:2100},(_,n)=>`@arg${String(n).padStart(4,"0")} bigint`).join(",");
      offset=await documentAt(my,`CREATE PROC app.p ${parameters} AS BEGIN WITH p AS(SELECT @arg2099 AS value) SELECT p.va<cursor>lue FROM p; END;`);
      const item=await typedValue(offset,"bigint");await apply(my,item,offset);
    });
    await step("sqlserver-function-end-hides-names-and-keeps-invalid-batch-diagnostics",async()=>{
      for(const definition of [
        "CREATE FUNCTION app.f(@secret bigint) RETURNS bigint AS BEGIN DECLARE @inside bigint; RETURN @secret; END;",
        "CREATE FUNCTION app.f(@secret bigint) RETURNS TABLE AS RETURN(WITH p AS(SELECT @secret AS id) SELECT id FROM p);",
        "CREATE FUNCTION app.f(@secret bigint) RETURNS TABLE AS RETURN SELECT @secret AS id;",
      ]){
        const offset=await documentAt(my,`${definition} SELECT @se<cursor>;`,true);const position=model.getPositionAt(offset);
        const list=await my.getCompletionList(uri,position.lineNumber-1,position.column-1);
        check(!list.items.some(item=>item.label==="@secret"||item.label==="@inside"),"expired function declarations are absent in actual client");
      }
      let offset=await documentAt(my,"CREATE FUNCTION app.f(@secret bigint) RETURNS bigint AS BEGIN RETURN @secret; END; DECLARE @safe int; SELECT @sa<cursor>;",true);
      const item=(await candidates(my,offset)).find(item=>item.label==="@safe");check(item,"tail declaration keeps its own editor scope");await apply(my,item,offset,true);
      check(model.getValue().endsWith("SELECT @safe;"),"tail edit accepted while invalid-batch diagnostics remain");
      offset=await documentAt(my,"CREATE FUNCTION app.f(@secret bigint) RETURNS bigint AS BEGIN RETURN @secret; END; WITH p AS(SELECT @secret AS value) SELECT p.va<cursor>lue FROM p;",true);
      await typedValue(offset,"unknown");
    });
    await step("sqlserver-function-and-procedure-nested-block-scopes",async()=>{
      let offset=await documentAt(my,"CREATE FUNCTION app.f(@input bigint) RETURNS bigint AS BEGIN BEGIN DECLARE @local bigint=CASE WHEN 1=1 THEN @input ELSE 0 END; END; RETURN @in<cursor>; END;");
      let item=(await candidates(my,offset)).find(item=>item.label==="@input");check(item,"nested END and CASE END do not close outer function");await apply(my,item,offset);
      check(model.getValue().endsWith("RETURN @input; END;"),"nested function parameter real edit");
      offset=await documentAt(my,"CREATE PROC app.p @input bigint AS BEGIN IF 0=1 BEGIN DECLARE @local bigint; END; WITH p AS(SELECT @local AS value) SELECT p.va<cursor>lue FROM p; END;");
      item=await typedValue(offset,"bigint");await apply(my,item,offset);
    });
    await step("sqlserver-function-end-edit-rebinds-the-existing-model",async()=>{
      const closed="CREATE FUNCTION app.f(@secret bigint) RETURNS bigint AS BEGIN RETURN 1; END; SELECT @se<cursor>;";
      let offset=await documentAt(my,closed,true);let position=model.getPositionAt(offset);
      let list=await my.getCompletionList(uri,position.lineNumber-1,position.column-1);check(!list.items.some(item=>item.label==="@secret"),"closed function starts with no leaked candidate");
      const end=model.getValue().indexOf("END; ");editor.executeEdits("desktop-acceptance",[{range:new monaco.Range(1,end+1,1,end+6),text:""}]);await synchronize(my,true);
      offset=model.getValue().lastIndexOf("@se")+3;const item=(await candidates(my,offset)).find(item=>item.label==="@secret");check(item,"removing function END restores in-body parameter");await apply(my,item,offset,true);
      editor.executeEdits("desktop-acceptance",[{range:new monaco.Range(1,end+1,1,end+1),text:"END; "}]);await synchronize(my,true);
      offset=model.getValue().lastIndexOf("@secret")+7;position=model.getPositionAt(offset);list=await my.getCompletionList(uri,position.lineNumber-1,position.column-1);
      check(!list.items.some(item=>item.label==="@secret"),"reinserting END removes the candidate without stale scope");
      offset=await documentAt(my,"CREATE FUNCTION app.f(@secret bigint) RETURNS bigint AS BEGIN RETURN @secret; END;\r\nGO 2 -- batch\r\nDECLARE @input int; SELECT @in<cursor>;");
      const local=(await candidates(my,offset)).find(item=>item.label==="@input");check(local,"new GO batch owns a new declaration");await apply(my,local,offset);
    });
    const inspectionItems=(client:LspClient,code:string)=>diagnostics.get(`${client.getSessionKey()}:${uri}`)?.diagnostics.filter(item=>item.code===code)??[];
    await step("inspection-literal-semicolons-directives-and-real-warning-ranges",async()=>{
      await pg.updateConfiguration(config("postgres"));
      for(const sql of ["SELECT '; UPDATE users SET id=1; DELETE FROM users;';","SELECT $q$; UPDATE users SET id=1;$q$;","UPDATE users SET name='a;b' WHERE id=1;"]){
        await documentAt(pg,`${sql}<cursor>`);check(inspectionItems(pg,"OXIDE001").length===0,"opaque semicolons keep real statement boundaries");
      }
      await documentAt(pg,"/*😀*/\r\nUPDATE users SET name='NOINSPECTION OXIDE001';<cursor>");
      let warnings=inspectionItems(pg,"OXIDE001");check(warnings.length===1,"literal directive does not suppress an actual mutation");
      const end=model.getPositionAt(model.getValueLength());check(warnings[0]?.range.end.line===end.lineNumber-1&&warnings[0].range.end.character===end.column-1,"whole mutation UTF-16 warning range");
      await documentAt(pg,"/* noinspection\tOXIDE001; reason */ UPDATE users SET id=1; DELETE FROM users;<cursor>");
      warnings=inspectionItems(pg,"OXIDE001");check(warnings.length===1,"comment directive applies only to its statement");
      check(warnings[0]?.range.start.character===model.getValue().indexOf("DELETE"),"the remaining warning belongs to DELETE");
    });
    await step("inspection-join-action-preserves-literal-and-accepts-monaco-edit",async()=>{
      await pg.updateConfiguration({schemas:[{id,database:"app",catalog:"db",tables:[
        {name:"orders",columns:[{name:"id",data_type:"bigint",nullable:false},{name:"customer_id",data_type:"bigint",nullable:false}],constraints:[{name:"orders_customer_fk",constraint_type:"FOREIGN KEY",columns:["customer_id"],referenced_schema:"app",referenced_table:"customers",referenced_columns:["id"]}]},
        {name:"customers",columns:[{name:"id",data_type:"bigint",nullable:false}]},
      ],functions:[]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:"postgres"}});
      await documentAt(pg,"/*😀*/ SELECT 'a;b',o.id FROM app.orders o JOIN app.customers c WHERE c.id>0;<cursor>",true);
      const warning=inspectionItems(pg,"OXIDE002")[0];check(warning,"actual JOIN warning survives a literal semicolon");
      const actions=await pg.getCodeActions(uri,warning.range,[warning],["quickfix"]);
      const action=actions.find(item=>item.title==="Add JOIN condition via orders_customer_fk");check(action?.isPreferred,"unique FK action comes through production client");
      const edits=action.edit?.changes?.[uri];check(edits?.length===1,"one real LSP action edit");const edit=edits[0];check(edit,"JOIN edit");
      const range=new monaco.Range(edit.range.start.line+1,edit.range.start.character+1,edit.range.end.line+1,edit.range.end.character+1);
      check(model.getOffsetAt(range.getStartPosition())===model.getValue().indexOf(" WHERE"),"action edit stays after the right relation");
      editor.executeEdits("desktop-acceptance",[{range,text:edit.newText}]);await synchronize(pg);
      check(model.getValue().includes("'a;b'")&&model.getValue().includes(" ON o.customer_id = c.id WHERE"),"literal and exact FK predicate preserved");
      check(inspectionItems(pg,"OXIDE002").length===0,"accepted action removes JOIN warning");
    });
    await step("inspection-dialect-profile-and-document-edits-recompute-warnings",async()=>{
      await pg.updateConfiguration(config("clickhouse"));
      await documentAt(pg,"SELECT name ILIKE '%oxide%', '42'::Int32 FROM users;<cursor>");check(inspectionItems(pg,"OXIDE005").length===0,"ClickHouse native operators are not PostgreSQL-only warnings");
      myDialect="mysql";await my.updateConfiguration(config("mysql"));
      await documentAt(my,"SELECT ilike_count FROM users; UPDATE users SET name='a;b' WHERE price=1;<cursor>");
      check(inspectionItems(my,"OXIDE005").length===0&&inspectionItems(my,"OXIDE001").length===0,"identifier substring and real WHERE do not warn");
      await documentAt(my,"UPDATE users SET name='NOINSPECTION OXIDE001';<cursor>");check(inspectionItems(my,"OXIDE001").length===1,"edited model recomputes a real warning");
      await documentAt(my,"/* noinspection OXIDE001 */ UPDATE users SET name='a;b';<cursor>");check(inspectionItems(my,"OXIDE001").length===0,"real directive replaces earlier literal state");
    });
    await step("inspection-query-owned-mutations-keep-semantic-completion",async()=>{
      await pg.updateConfiguration(config("postgres"));
      const offset=await documentAt(pg,"/*😀*/ UPDATE users SET id=(SELECT u.i<cursor>d FROM users u WHERE u.id=1);");
      check(inspectionItems(pg,"OXIDE001").length===1,"inner WHERE cannot protect the outer UPDATE");
      const item=(await candidates(pg,offset)).find(item=>item.label==="id");check(item?.detail==="Column: id (bigint)","nested query keeps semantic candidate type");await apply(pg,item,offset);
      check(inspectionItems(pg,"OXIDE001").length===1,"accepting an actual recommendation preserves the risk warning");
      const end=model.getPositionAt(model.getValueLength()-1);editor.executeEdits("desktop-acceptance",[{range:new monaco.Range(end.lineNumber,end.column,end.lineNumber,end.column),text:" WHERE id=2"}]);await synchronize(pg);
      check(inspectionItems(pg,"OXIDE001").length===0,"adding the actual outer filter clears the warning");
      await documentAt(pg,"WITH changed AS(DELETE FROM users RETURNING id) SELECT id FROM changed;<cursor>");
      const warning=inspectionItems(pg,"OXIDE001")[0];check(warning,"CTE mutation has its own warning");check(warning.range.start.character===model.getValue().indexOf("DELETE"),"CTE mutation warning stays local");
      await documentAt(pg,"WITH q AS(SELECT id FROM users /* noinspection OXIDE001 */) UPDATE users SET id=1;<cursor>");
      check(inspectionItems(pg,"OXIDE001").length===1,"nested directive cannot suppress an enclosing mutation");
    });
    await step("inspection-multiple-quoted-joins-accept-independent-actions",async()=>{
      await documentAt(pg,"/*😀*/ SELECT a.id FROM users a JOIN \"Order Table\" b JOIN \"Next Table\" c\nWHERE a.id>0;<cursor>",true);
      for(let remaining=2;remaining>0;remaining--){
        const warnings=inspectionItems(pg,"OXIDE002");check(warnings.length===remaining,"each missing JOIN owns one diagnostic");const warning=warnings[0];check(warning,"current JOIN diagnostic");
        const actions=await pg.getCodeActions(uri,warning.range,[warning],["quickfix"]);const action=actions.find(item=>item.title==="Add non-matching JOIN safety guard");check(action,"unproven metadata produces explicit safety guard");
        const edits=action.edit?.changes?.[uri];check(edits?.length===1,"one action per selected JOIN");const edit=edits[0];check(edit,"real JOIN edit");
        const range=new monaco.Range(edit.range.start.line+1,edit.range.start.character+1,edit.range.end.line+1,edit.range.end.character+1);check(model.getOffsetAt(range.getStartPosition())<model.getValue().indexOf("WHERE"),"guard inserted before newline WHERE");
        editor.executeEdits("desktop-acceptance",[{range,text:edit.newText}]);await synchronize(pg,remaining>1);check(inspectionItems(pg,"OXIDE002").length===remaining-1,"only the selected missing condition is resolved");
      }
      check(model.getValue().includes('"Order Table" b ON')&&model.getValue().includes('"Next Table" c ON'),"quoted relations and aliases survive both actual edits");
    });
    await step("scoped-column-ambiguity-and-qualified-quickfix",async()=>{
      await pg.updateConfiguration({schemas:[{id,database:"app",catalog:"db",tables:[
        {name:"orders",columns:[{name:"id",data_type:"bigint",nullable:false},{name:"customer_id",data_type:"bigint",nullable:false}]},
        {name:"customers",columns:[{name:"id",data_type:"bigint",nullable:false},{name:"name",data_type:"text",nullable:false}]},
      ],functions:[]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:"postgres"}});
      await documentAt(pg,"SELECT id,(SELECT id FROM customers) AS value FROM orders;<cursor>");check(inspectionItems(pg,"OXIDE004").length===0,"sibling query rows do not create false ambiguity");
      await documentAt(pg,"/*😀*/ WITH q AS(SELECT id FROM orders) SELECT id FROM q JOIN customers c ON q.id=c.id;<cursor>");
      const warning=inspectionItems(pg,"OXIDE004")[0];check(warning,"actual local CTE ambiguity diagnostic");
      const actions=await pg.getCodeActions(uri,warning.range,[warning],["quickfix"]);const choices=actions.filter(a=>a.title.startsWith("Qualify column as "));check(choices.length===2&&choices.every(a=>a.isPreferred===false),"two explicit choices with no guessed source");
      const action=choices.find(a=>a.title==="Qualify column as q.id");check(action,"local CTE choice");const edits=action.edit?.changes?.[uri];check(edits?.length===1,"one real ambiguity edit");const edit=edits[0];check(edit,"qualification edit");
      editor.executeEdits("desktop-acceptance",[{range:new monaco.Range(edit.range.start.line+1,edit.range.start.character+1,edit.range.end.line+1,edit.range.end.character+1),text:edit.newText}]);await synchronize(pg);
      check(model.getValue().includes("SELECT q.id FROM q"),"Monaco accepts the actual qualifier");check(inspectionItems(pg,"OXIDE004").length===0,"selected qualifier clears ambiguity");
      const offset=model.getValue().indexOf("SELECT q.id")+"SELECT q.i".length;const item=(await candidates(pg,offset)).find(i=>i.label==="id");check(item?.detail==="Column: id (bigint)","same local binding supplies semantic recommendation");const pos=model.getPositionAt(offset);check(JSON.stringify(await pg.getHover(uri,pos.lineNumber-1,pos.column-1)).includes("bigint"),"same local binding supplies hover type");
      await documentAt(pg,"SELECT id FROM orders JOIN customers USING(id);<cursor>");check(inspectionItems(pg,"OXIDE004").length===0,"USING merged column is not ambiguous");
      await documentAt(pg,`SELECT (SELECT '${"😀".repeat(64)}') AS label, id FROM orders o JOIN customers c ON o.customer_id=c.id;<cursor>`);
      const unicodeWarning=inspectionItems(pg,"OXIDE004")[0];check(unicodeWarning,"outer ambiguity after nested emoji projection");const unicodeActions=await pg.getCodeActions(uri,unicodeWarning.range,[unicodeWarning],["quickfix"]);const unicodeChoice=unicodeActions.find(a=>a.title==="Qualify column as o.id");check(unicodeChoice,"byte-position scope keeps the actual alias");
      const unicodeEdit=unicodeChoice.edit?.changes?.[uri]?.[0];check(unicodeEdit,"actual Unicode qualification edit");editor.executeEdits("desktop-acceptance",[{range:new monaco.Range(unicodeEdit.range.start.line+1,unicodeEdit.range.start.character+1,unicodeEdit.range.end.line+1,unicodeEdit.range.end.character+1),text:unicodeEdit.newText}]);await synchronize(pg);check(model.getValue().includes(", o.id FROM"),"the outer aliased relation is selected");check(inspectionItems(pg,"OXIDE004").length===0,"Unicode qualification clears the correct warning");
    });
    await step("join-on-operands-share-recommendation-hover-and-accepted-fix",async()=>{
      await pg.updateConfiguration({schemas:[{id,database:"app",catalog:"db",tables:[
        {name:"orders",columns:[{name:"id",data_type:"bigint",nullable:false},{name:"total",data_type:"decimal",nullable:false}]},
        {name:"users",columns:[{name:"id",data_type:"int",nullable:false},{name:"name",data_type:"text",nullable:false}]},
        {name:"audit_events",columns:[{name:"audit_secret",data_type:"text",nullable:false}]},
      ],functions:[]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:"postgres"}});
      let at=await documentAt(pg,"SELECT o.id FROM orders o JOIN users u ON audit_<cursor>='x' JOIN audit_events later ON true;");
      check(!(await pg.getCompletionList(uri,model.getPositionAt(at).lineNumber-1,model.getPositionAt(at).column-1)).items.some(i=>i.kind===5&&i.label.includes("audit_secret")),"later table field is outside current ON");
      at=await documentAt(pg,"SELECT o.id FROM audit_events a, orders o JOIN users u ON audit_<cursor>='x';");
      check(!(await pg.getCompletionList(uri,model.getPositionAt(at).lineNumber-1,model.getPositionAt(at).column-1)).items.some(i=>i.kind===5&&i.label.includes("audit_secret")),"comma sibling is outside joined item");
      at=await documentAt(pg,"SELECT o.id FROM orders o JOIN users u ON la<cursor>=1 JOIN audit_events later ON true;");
      check(!(await candidates(pg,at)).some(i=>i.label==="later"),"later table alias is absent from actual list");
      at=await documentAt(pg,"SELECT o.id FROM orders o JOIN users u ON tot<cursor>=1 JOIN orders later ON later.id=u.id;");
      const total=(await candidates(pg,at)).find(i=>i.kind===5&&i.label==="total");check(total&&total.detail?.includes("decimal"),"current ON source retains decimal type");await apply(pg,total,at);
      check(model.getValue().includes("ON total=1 JOIN orders later"),"Monaco accepts the field in its real ON predicate");check(inspectionItems(pg,"OXIDE004").length===0,"later self join cannot create false ambiguity");
      at=await documentAt(pg,`/*${"😀".repeat(64)}*/\r\nSELECT p.id FROM orders JOIN orders p ON i<cursor>d=p.id JOIN orders later ON later.id=p.id;`);
      const fields=(await candidates(pg,at)).filter(i=>i.kind===5);check(fields.some(i=>i.label==="orders.id")&&fields.some(i=>i.label==="p.id")&&!fields.some(i=>i.label==="id"||i.label==="later.id"),"mixed self join preserves both current occurrences");
      const warning=inspectionItems(pg,"OXIDE004")[0];check(warning,"one real ON ambiguity");const actions=await pg.getCodeActions(uri,warning.range,[warning],["quickfix"]);const choices=actions.filter(a=>a.title.startsWith("Qualify column as "));check(choices.length===2&&choices.every(a=>a.isPreferred===false&&!a.title.includes("later")),"only current rows are offered as explicit choices");
      const action=choices.find(a=>a.title==="Qualify column as orders.id");const edit=action?.edit?.changes?.[uri]?.[0];check(edit,"actual unaliased row qualification edit");editor.executeEdits("desktop-acceptance",[{range:new monaco.Range(edit.range.start.line+1,edit.range.start.character+1,edit.range.end.line+1,edit.range.end.character+1),text:edit.newText}]);await synchronize(pg);
      check(model.getValue().includes("ON orders.id=p.id JOIN orders later"),"Unicode coordinates keep the selected ON input");check(inspectionItems(pg,"OXIDE004").length===0,"accepted current-row edit clears ambiguity");
      const position=model.getPositionAt(model.getValue().indexOf("ON orders.id")+"ON orders.i".length);check(JSON.stringify(await pg.getHover(uri,position.lineNumber-1,position.column-1)).includes("bigint"),"accepted column hover uses the same binding");
      at=await documentAt(pg,"SELECT o.id FROM orders o LEFT JOIN users u ON EXISTS(SELECT o.tot<cursor>) JOIN orders later ON true;");
      const correlated=(await candidates(pg,at)).find(i=>i.label==="total");check(correlated?.detail?.includes("decimal"),"qualified scalar member keeps legal outer ON source");check(correlated,"actual correlated candidate");await apply(pg,correlated,at);check(model.getValue().includes("EXISTS(SELECT o.total) JOIN"),"Monaco accepts correlated member without losing qualifier");
      at=await documentAt(pg,"SELECT o.id FROM orders o LEFT JOIN users u ON EXISTS(SELECT later.tot<cursor>) JOIN orders later ON true;");
      check(!(await pg.getCompletionList(uri,model.getPositionAt(at).lineNumber-1,model.getPositionAt(at).column-1)).items.some(i=>i.kind===5),"correlation cannot reintroduce later ON source");

      await pg.updateConfiguration({schemas:[{id,database:"app",catalog:"db",tables:[
        {name:"orders",columns:[{name:"id",data_type:"bigint",nullable:false},{name:"total",data_type:"decimal",nullable:false}]},
        {name:"users",columns:[{name:"id",data_type:"int",nullable:false}]},
        {name:"audit_events",columns:[{name:"audit_secret",data_type:"text",nullable:false}]},
      ],functions:[]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:"sqlite"}});
      at=await documentAt(pg,"SELECT o.id FROM orders o JOIN users u ON audit_<cursor>='x' JOIN audit_events later ON true;");
      check((await candidates(pg,at)).some(i=>i.label==="audit_secret"),"SQLite inner ON retains its legal later input");
      at=await documentAt(pg,"SELECT o.id FROM audit_events a, orders o LEFT JOIN users u ON audit_<cursor>='x';");
      check((await candidates(pg,at)).some(i=>i.label==="audit_secret"),"SQLite comma input belongs to accumulated left operand");
      at=await documentAt(pg,"SELECT o.id FROM orders o LEFT JOIN users u ON audit_<cursor>='x' JOIN audit_events later ON true;");
      check(!(await pg.getCompletionList(uri,model.getPositionAt(at).lineNumber-1,model.getPositionAt(at).column-1)).items.some(i=>i.kind===5&&i.label.includes("audit_secret")),"SQLite outer ON excludes later input");

    });
    await step("large-mutation-payload-and-monaco-edit-rebuild-single-pass-model",async()=>{
      await pg.updateConfiguration({schemas:[{id,database:"app",catalog:"db",tables:[{name:"users",columns:[{name:"id",data_type:"bigint",nullable:false}]}],functions:[]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:"postgres"}});
      await documentAt(pg,`/*😀*/\r\n${"UPDATE users SET id=1; ".repeat(4097)}<cursor>`);
      let items=inspectionItems(pg,"OXIDE001");check(items.length===4097&&items.every(d=>d.severity===2),"all 4097 real warnings cross desktop IPC without truncation");
      const verifyEnd=()=>{const all=inspectionItems(pg,"OXIDE001");const last=all[all.length-1];check(last,"last mutation warning");const expected=model.getPositionAt(model.getValue().lastIndexOf(";")+1);check(last.range.end.line===expected.lineNumber-1&&last.range.end.character===expected.column-1,"last UTF-16 range matches the complete Monaco document");};verifyEnd();
      const at=model.getPositionAt(model.getValue().indexOf(";"));editor.executeEdits("desktop-acceptance",[{range:new monaco.Range(at.lineNumber,at.column,at.lineNumber,at.column),text:" WHERE id=1"}]);await synchronize(pg);check(inspectionItems(pg,"OXIDE001").length===4096,"editing one mutation removes exactly its warning");verifyEnd();
      editor.executeEdits("desktop-acceptance",[{range:new monaco.Range(at.lineNumber,at.column,at.lineNumber,at.column+" WHERE id=1".length),text:""}]);await synchronize(pg);items=inspectionItems(pg,"OXIDE001");check(items.length===4097,"removing WHERE rebuilds all independent query scopes");verifyEnd();
    });
    await step("joined-table-output-inference-and-unfinished-member-acceptance",async()=>{
      const joinedConfig=(total="decimal")=>({schemas:[{id,database:"app",tables:[
        {name:"users",columns:[{name:"id",data_type:"bigint",nullable:false},{name:"name",data_type:"text",nullable:false}]},
        {name:"orders",columns:[{name:"id",data_type:"bigint",nullable:false},{name:"total",data_type:total,nullable:false}]},
      ],functions:[]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:"postgres"}});
      await pg.updateConfiguration(joinedConfig());
      let at=await documentAt(pg,`/*${"😀".repeat(64)}*/\r\nSELECT g.to<cursor>tal FROM (users u NATURAL LEFT JOIN orders o) g;`);
      let item=(await candidates(pg,at)).find(i=>i.label==="total");check(item?.detail?.includes("decimal"),"joined group exposes typed decimal field");check(item,"actual grouped candidate");await apply(pg,item,at);
      check(model.getValue().includes("SELECT g.total FROM"),"Monaco accepts grouped member without duplicate qualifier");check(inspectionItems(pg,"OXIDE004").length===0,"legal natural output remains unambiguous");
      let pos=model.getPositionAt(at);check(JSON.stringify(await pg.getHover(uri,pos.lineNumber-1,pos.column-1)).includes("decimal"),"grouped hover shares output type");
      at=await documentAt(pg,`/*${"😀".repeat(64)}*/\r\nSELECT g.<cursor> FROM (users u NATURAL LEFT JOIN orders o) g;`,true);
      item=(await candidates(pg,at)).find(i=>i.label==="total");check(item?.detail?.includes("decimal"),"unfinished member recovers the real joined layout");check(item,"unfinished group candidate");await apply(pg,item,at);
      check(model.getValue().includes("SELECT g.total FROM"),"accepted unfinished candidate repairs actual SQL");
      const version=model.getVersionId();await pg.updateConfiguration(joinedConfig("numeric"));item=(await candidates(pg,at)).find(i=>i.label==="total");check(item?.detail?.includes("numeric"),"same SQL uses refreshed grouped column metadata");check(model.getVersionId()===version,"metadata refresh does not edit the model");
      pos=model.getPositionAt(at);check(JSON.stringify(await pg.getHover(uri,pos.lineNumber-1,pos.column-1)).includes("numeric"),"same SQL hover refreshes with recommendation");
      at=await documentAt(pg,"SELECT i<cursor>d FROM users u NATURAL LEFT JOIN orders o;");
      const keys=(await candidates(pg,at)).filter(i=>i.kind===5&&i.filterText==="id");check(keys.length===1&&keys[0]?.label==="id","NATURAL key has one unqualified suggestion");check(keys[0]?.detail?.includes("bigint"),"merged key retains bigint type");check(keys[0],"actual merged candidate");await apply(pg,keys[0],at);check(inspectionItems(pg,"OXIDE004").length===0,"accepted merged key has no false ambiguity");
      at=await documentAt(pg,"SELECT u.na<cursor>me FROM (users u JOIN orders o ON u.id=o.id) g;");
      pos=model.getPositionAt(at);check(!(await pg.getCompletionList(uri,pos.lineNumber-1,pos.column-1)).items.some(i=>i.kind===5),"PostgreSQL group alias hides internal qualifiers");
      at=await documentAt(pg,"WITH q AS(SELECT g.* FROM (users u JOIN orders o USING(id)) g) SELECT q.to<cursor>tal FROM q;");item=(await candidates(pg,at)).find(i=>i.label==="total");check(item?.detail?.includes("numeric"),"joined star feeds real CTE output inference");check(item,"actual CTE member");await apply(pg,item,at);
    });
    await step("grouped-lateral-apply-members-output-keys-and-nullability",async()=>{
      const groupedConfig=(dialect="postgres",total="decimal")=>({schemas:[{id,database:"app",tables:[
        {name:"users",columns:[{name:"id",data_type:"bigint",nullable:false},{name:"name",data_type:"text",nullable:false}]},
        {name:"orders",columns:[{name:"id",data_type:"bigint",nullable:false},{name:"total",data_type:total,nullable:false}]},
      ],functions:[]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:dialect}});
      await pg.updateConfiguration(groupedConfig());
      let at=await documentAt(pg,`/*${"😀".repeat(64)}*/\r\nSELECT * FROM (users u JOIN orders o USING(id)) g CROSS JOIN LATERAL(SELECT g.to<cursor>tal) d;`);
      let item=(await candidates(pg,at)).find(i=>i.label==="total");check(item?.detail?.includes("decimal"),"closed group supplies typed outer member inside LATERAL");check(item,"actual outer group member");await apply(pg,item,at);check(model.getValue().includes("LATERAL(SELECT g.total)"),"Monaco accepts real correlated member at UTF-16 coordinates");
      let pos=model.getPositionAt(at);check(JSON.stringify(await pg.getHover(uri,pos.lineNumber-1,pos.column-1)).includes("decimal"),"outer member hover follows the same model");
      at=await documentAt(pg,"WITH q AS(SELECT d.* FROM (users u JOIN orders o USING(id)) g CROSS JOIN LATERAL(SELECT g.total AS amount) d) SELECT q.am<cursor>ount FROM q;");
      item=(await candidates(pg,at)).find(i=>i.label==="amount");check(item?.detail?.includes("decimal"),"correlated group result passes through star and CTE");check(item,"actual inferred CTE output");await apply(pg,item,at);
      at=await documentAt(pg,"SELECT * FROM (users u JOIN orders o USING(id)) CROSS JOIN LATERAL(SELECT i<cursor>d) d;");
      const keys=(await candidates(pg,at)).filter(i=>i.kind===5&&i.filterText==="id");check(keys.length===1&&keys[0]?.label==="id","outer merged key has one common typed recommendation");check(keys[0]?.detail?.includes("bigint"),"outer merged key type");check(keys[0],"real outer key candidate");await apply(pg,keys[0],at);check(model.getValue().includes("LATERAL(SELECT id)"),"merged key accepted without selecting a physical side");
      at=await documentAt(pg,"SELECT * FROM (users u JOIN orders o USING(id)) g CROSS JOIN LATERAL(SELECT o.to<cursor>tal) d;");pos=model.getPositionAt(at);check(!(await pg.getCompletionList(uri,pos.lineNumber-1,pos.column-1)).items.some(i=>i.kind===5),"closed group keeps internal alias invisible to lateral sibling");
      myDialect="sqlserver";await my.updateConfiguration(groupedConfig("sqlserver"));
      for(const [join,nullable] of [["CROSS APPLY","Nullable: no"],["OUTER APPLY","Nullable: yes"]] as const){
        at=await documentAt(my,`SELECT d.va<cursor>lue FROM (orders o ${join}(SELECT 1 AS value) d);`);pos=model.getPositionAt(at);check(JSON.stringify(await my.getHover(uri,pos.lineNumber-1,pos.column-1)).includes(nullable),`${join} null extension crosses real IPC`);
      }
      at=await documentAt(pg,"SELECT * FROM (users u JOIN orders o USING(id)) g CROSS JOIN LATERAL(SELECT g.to<cursor>tal) d;");const version=model.getVersionId();await pg.updateConfiguration(groupedConfig("postgres","numeric"));item=(await candidates(pg,at)).find(i=>i.label==="total");check(item?.detail?.includes("numeric"),"unchanged correlated SQL uses refreshed metadata");check(model.getVersionId()===version,"metadata refresh preserves actual model version");
    });
    const qualifyConfig=(profile:string,total="decimal")=>({schemas:[{id,database:"app",tables:[{name:"orders",columns:[{name:"id",data_type:"bigint",nullable:false},{name:"total",data_type:total,nullable:false}]}],functions:[]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:profile}});
    await step("clickhouse-qualify-output-types-unicode-and-metadata-refresh",async()=>{
      pgDialect="clickhouse";await pg.updateConfiguration(qualifyConfig("clickhouse"));
      for(const [marked,name] of [
        ["/* 😀 中文 */\r\nSELECT row_number() OVER(ORDER BY total) AS rn FROM orders QUALIFY r<cursor>n=1;","rn"],
        ["SELECT denseRank() OVER(ORDER BY total) AS ranking FROM orders QUALIFY rank<cursor>ing=1;","ranking"],
        ["SELECT count() OVER(PARTITION BY id) AS partition_count FROM orders QUALIFY partition_<cursor>count=1;","partition_count"],
        ["SELECT row_number() OVER() AS `排名` FROM orders QUALIFY `排<cursor>名`=1;","排名"],
      ] as const){
        const at=await documentAt(pg,marked);const before=model.getValue();
        const item=(await candidates(pg,at)).find(i=>i.label===name&&i.kind===5);
        check(item?.detail?.includes("(UInt64)"),"QUALIFY uses ClickHouse window type");check(item,"actual QUALIFY output candidate");
        await apply(pg,item,at);check(model.getValue()===before,"Monaco replaces the complete alias including Unicode/quoted suffix");
      }
      let at=await documentAt(pg,"WITH ranked AS(SELECT row_number() OVER() AS rn FROM orders QUALIFY rn=1) SELECT r.r<cursor>n FROM ranked r;");
      let item=(await candidates(pg,at)).find(i=>i.label==="rn");check(item?.detail?.includes("(UInt64)"),"QUALIFY output passes through CTE");check(item,"real CTE window result");await apply(pg,item,at);
      const pos=model.getPositionAt(at);check(JSON.stringify(await pg.getHover(uri,pos.lineNumber-1,pos.column-1)).includes("UInt64"),"CTE hover agrees with window result type");
      at=await documentAt(pg,"SELECT total AS amount,row_number() OVER() AS rn FROM orders QUALIFY amo<cursor>unt>0 AND rn=1;");
      const version=model.getVersionId();
      for(const ty of ["decimal","UInt32","String"]){
        diagnostics.delete(`${pg.getSessionKey()}:${uri}`);await pg.updateConfiguration(qualifyConfig("clickhouse",ty));await diagnosticCheck(pg,version);
        item=(await candidates(pg,at)).find(i=>i.label==="amount");check(item?.detail?.includes(`(${ty})`),"QUALIFY alias follows refreshed physical type");check(model.getVersionId()===version,"metadata refresh preserves actual SQL/model version");
      }
      at=await documentAt(pg,"SELECT row_number() OVER() AS outer_rank FROM orders QUALIFY EXISTS(SELECT row_number() OVER() AS inner_rank FROM orders QUALIFY inner_<cursor>rank=1);");
      const items=await candidates(pg,at);check(items.some(i=>i.label==="inner_rank"),"inner QUALIFY owns its output");check(!items.some(i=>i.label==="outer_rank"),"outer SELECT output stays outside independent inner query");
    });
    await step("qualify-profile-refresh-rejects-and-restores-unchanged-sql",async()=>{
      const at=await documentAt(pg,"SELECT row_number() OVER() AS rn FROM orders QUALIFY r<cursor>n=1;");const version=model.getVersionId();
      check((await candidates(pg,at)).some(i=>i.label==="rn"&&i.detail?.includes("UInt64")),"ClickHouse output before profile change");
      diagnostics.delete(`${pg.getSessionKey()}:${uri}`);await pg.updateConfiguration(qualifyConfig("postgres"));await diagnosticCheck(pg,version,true);
      const pos=model.getPositionAt(at);const list=await pg.getCompletionList(uri,pos.lineNumber-1,pos.column-1);
      check(!list.items.some(i=>i.kind===5&&i.label==="rn"),"PostgreSQL does not retain ClickHouse output bindings");check(model.getVersionId()===version,"profile change preserves actual model version");
      diagnostics.delete(`${pg.getSessionKey()}:${uri}`);await pg.updateConfiguration(qualifyConfig("clickhouse"));await diagnosticCheck(pg,version);
      check((await candidates(pg,at)).some(i=>i.label==="rn"&&i.detail?.includes("UInt64")),"ClickHouse binding restored without editing SQL");check(model.getVersionId()===version,"restoration preserves model version");
    });
    const hiveConfig=(profile:string,tags="array<string>")=>({schemas:[{id,database:"app",tables:[{name:"orders",columns:[{name:"id",data_type:"bigint",nullable:false},{name:"tags",data_type:tags,nullable:false},{name:"grid",data_type:"array<array<decimal(18,2)>>",nullable:false},{name:"props",data_type:"map<string,array<bigint>>",nullable:false},{name:"records",data_type:"array<struct<code:string,amount:decimal(18,2)>>",nullable:false},{name:"payload",data_type:"string",nullable:false}]}],functions:[]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:profile}});
    await step("hive-lateral-view-udtf-types-monaco-acceptance-and-cte-hover",async()=>{
      pgDialect="hive";await pg.updateConfiguration(hiveConfig("hive"));
      for(const [marked,name,ty]of[
        ["/* 😀 中文 */\r\nSELECT e.it<cursor>em FROM orders o LATERAL VIEW explode(o.tags) e AS item;","item","string"],
        ["SELECT e.po<cursor>s FROM orders o LATERAL VIEW posexplode(o.tags) e;","pos","int"],
        ["SELECT e.va<cursor>lue FROM orders o LATERAL VIEW explode(o.props) e;","value","array<bigint>"],
        ["SELECT e.am<cursor>ount FROM orders o LATERAL VIEW inline(o.records) e;","amount","decimal(18,2)"],
        ["SELECT e.na<cursor>me FROM orders o LATERAL VIEW json_tuple(o.payload,'name') e AS name;","name","string"],
        ["SELECT e.co<cursor>l1 FROM orders LATERAL VIEW stack(2,'A',1,'B',2) e;","col1","int"],
        ["SELECT b.it<cursor>em FROM orders o LATERAL VIEW explode(o.grid) a AS nested_col LATERAL VIEW explode(a.nested_col) b AS item;","item","decimal(18,2)"],
        ["WITH r AS(SELECT e.* FROM orders o LATERAL VIEW explode(o.tags) e) SELECT r.co<cursor>l FROM r;","col","string"],
        ["SELECT `e.x`.`项<cursor>目` FROM orders o LATERAL VIEW explode(o.tags) `e.x` AS `项目`;","项目","string"],
      ]as const){
        const at=await documentAt(pg,marked);const before=model.getValue();const item=(await candidates(pg,at)).find(i=>i.kind===5&&i.label===name);
        check(item?.detail?.includes(`(${ty})`),"Hive UDTF inferred output type");check(item,"actual Hive UDTF candidate");await apply(pg,item,at);check(model.getValue()===before,"Monaco accepts complete Hive alias leaf with quoting/UTF-16 suffix");
        const pos=model.getPositionAt(at);check(JSON.stringify(await pg.getHover(uri,pos.lineNumber-1,pos.column-1)).includes(ty),"Hive hover follows the same row shape");
      }
    });
    await step("hive-lateral-view-outer-scope-and-unchanged-document-refresh",async()=>{
      let at=await documentAt(pg,"SELECT e.po<cursor>s FROM orders o LATERAL VIEW OUTER posexplode(o.tags) e;");let pos=model.getPositionAt(at);
      check(JSON.stringify(await pg.getHover(uri,pos.lineNumber-1,pos.column-1)).includes("Nullable: yes"),"OUTER null-extends position output");
      pos=model.getPositionAt(model.getValue().indexOf("o.tags")+3);check(JSON.stringify(await pg.getHover(uri,pos.lineNumber-1,pos.column-1)).includes("Nullable: no"),"OUTER preserves base column nullability");
      at=await documentAt(pg,"SELECT e.<cursor> FROM orders o LATERAL VIEW explode(o.tags) e AS item;",true);const item=(await candidates(pg,at)).find(i=>i.label==="item");check(item?.detail?.includes("(string)"),"unfinished Hive member uses request-local syntax recovery");check(item,"recovered view output");await apply(pg,item,at);check(model.getValue().includes("SELECT e.item FROM"),"actual acceptance repairs incomplete member");
      at=await documentAt(pg,"SELECT * FROM orders o LATERAL VIEW explode(b.it<cursor>em) a AS value LATERAL VIEW explode(o.tags) b AS item;");pos=model.getPositionAt(at);check(!(await pg.getCompletionList(uri,pos.lineNumber-1,pos.column-1)).items.some(i=>i.kind===5),"later view output is unavailable inside earlier arguments");
      at=await documentAt(pg,"SELECT e.it<cursor>em FROM orders o LATERAL VIEW explode(o.tags) e AS item;");const version=model.getVersionId();
      for(const [ty,element]of[["array<string>","string"],["array<bigint>","bigint"],["array<decimal(18,2)>","decimal(18,2)"]]as const){
        diagnostics.delete(`${pg.getSessionKey()}:${uri}`);await pg.updateConfiguration(hiveConfig("hive",ty));await diagnosticCheck(pg,version);
        check((await candidates(pg,at)).some(i=>i.label==="item"&&i.detail?.includes(`(${element})`)),"same SQL refreshes Hive collection element type");check(model.getVersionId()===version,"Hive metadata refresh keeps model version");
      }
      diagnostics.delete(`${pg.getSessionKey()}:${uri}`);await pg.updateConfiguration(hiveConfig("postgres"));await diagnosticCheck(pg,version,true);pos=model.getPositionAt(at);check(!(await pg.getCompletionList(uri,pos.lineNumber-1,pos.column-1)).items.some(i=>i.label==="item"&&i.kind===5),"other dialect does not retain Hive row binding");
      diagnostics.delete(`${pg.getSessionKey()}:${uri}`);await pg.updateConfiguration(hiveConfig("hive"));await diagnosticCheck(pg,version);check((await candidates(pg,at)).some(i=>i.label==="item"&&i.detail?.includes("(string)")),"Hive row restored without SQL edits");check(model.getVersionId()===version,"restored Hive model unchanged");
    });
    const searchConfig=(dialect:string,comment="营业收入 Revenue amount",ty="decimal")=>({schemas:[{id,database:"app",tables:[{name:"ledger",columns:[{name:"租金总额",data_type:"decimal",nullable:false},{name:"amount",data_type:ty,nullable:false,comment}]},{name:"archive",columns:[{name:"secret",data_type:"text",nullable:false,comment:"Revenue 租金"}]}],functions:[]}],fileSchemas:{[uri]:id},fileDialects:{[uri]:dialect}});
    await step("metadata-pinyin-comment-real-monaco-identifier-acceptance",async()=>{
      pgDialect="postgres";myDialect="mysql";await pg.updateConfiguration(searchConfig("postgres"));await my.updateConfiguration(searchConfig("mysql"));
      for(const client of [pg,my])for(const [query,name]of[["zj","租金总额"],["rev","amount"]]as const){
        const at=await documentAt(client,`/* 😀 中文 */\r\nSELECT l.${query}<cursor>suffix FROM ledger l;`);
        const items=await candidates(client,at);const item=items.find(i=>i.label===name&&i.kind===5);
        check(item,"bound search candidate");check(item.detail?.includes("(decimal)"),"search match retains bound field type");const resolved=await client.resolveCompletionItem(item);check((resolved.data as any)?.oxide?.column===name,"canonical identity survives lazy resolve and remains independent of search text");
        check(!items.some(i=>i.label==="secret"),"matching archive comment cannot escape FROM binding");
        const suggestion=await apply(client,item,at);check(suggestion.filterText?.toLowerCase().includes(query),"actual Monaco suggestion retains auxiliary match");
        check(model.getValue().includes(name)&&!model.getValue().includes("suffix")&&!model.getValue().includes("Revenue"),"acceptance inserts only the actual field and replaces full suffix");
        const pos=model.getPositionAt(model.getValue().indexOf(name)+1);check(JSON.stringify(await client.getHover(uri,pos.lineNumber-1,pos.column-1)).includes("decimal"),"accepted field hover keeps type");
      }
      for(const marked of["WITH q AS(SELECT amount AS net FROM ledger) SELECT q.rev<cursor> FROM q;","WITH q(net) AS(SELECT amount FROM ledger) SELECT q.rev<cursor> FROM q;"]){
        const at=await documentAt(my,marked);const item=(await candidates(my,at)).find(i=>i.label==="net");check(item,"CTE comment candidate");check(item.detail?.includes("(decimal)"),"direct CTE rename inherits comment search");await apply(my,item,at);check(model.getValue().includes("SELECT q.net FROM"),"accept CTE output name, not source/comment");
      }
    });
    await step("metadata-search-refresh-session-isolation-and-capped-requery",async()=>{
      let at=await documentAt(my,"SELECT l.rev<cursor> FROM ledger l;");const version=model.getVersionId();
      for(const [comment,ty,present]of[["Revenue","decimal",true],["other","bigint",false],["Revenue","bigint",true]]as const){
        diagnostics.delete(`${my.getSessionKey()}:${uri}`);await my.updateConfiguration(searchConfig("mysql",comment,ty));await diagnosticCheck(my,version);
        const pos=model.getPositionAt(at),list=await my.getCompletionList(uri,pos.lineNumber-1,pos.column-1);const item=list.items.find(i=>i.label==="amount");check(!!item===present,"same document refresh removes/restores comment match");if(item)check(item.detail?.includes(`(${ty})`),"same document refresh replaces type");check(model.getVersionId()===version,"metadata refresh keeps SQL model revision");
      }
      await synchronize(pg);let pos=model.getPositionAt(at);check((await pg.getCompletionList(uri,pos.lineNumber-1,pos.column-1)).items.some(i=>i.label==="amount"&&i.detail?.includes("(decimal)")),"second production session retains its independent schema snapshot");
      const cfg=searchConfig("mysql");const columns=Array.from({length:300},(_,i)=>({name:`v${String(i).padStart(3,"0")}`,data_type:"int",nullable:false,comment:"Revenue"}));columns.push({name:"rev",data_type:"bigint",nullable:false,comment:""});
      const crowded={...cfg,schemas:[{...cfg.schemas[0],tables:[{name:"ledger",columns}]}]};await my.updateConfiguration(crowded);
      at=await documentAt(my,"SELECT l.rev<cursor> FROM ledger l;");pos=model.getPositionAt(at);const list=await my.getCompletionList(uri,pos.lineNumber-1,pos.column-1);check(list.isIncomplete,"bounded metadata list requests requery");check(list.items.filter(i=>i.kind===5).length===256,"bound metadata response size");check(list.items.some(i=>i.label==="rev"),"late exact field survives auxiliary matches");
      at=await documentAt(my,"SELECT l.v299<cursor> FROM ledger l;");const item=(await candidates(my,at)).find(i=>i.label==="v299");check(item,"longer prefix retrieves late field");await apply(my,item,at);check(model.getValue()==="SELECT l.v299 FROM ledger l;","requery acceptance preserves SQL");
    });
    await step("native-server-namespace-cte-types-and-monaco-acceptance",async()=>{
      myDialect="sqlserver";
      const namespaceConfig=(remote:string)=>({schemas:[
        {id,catalog:"db",database:"app",tables:[{name:"ledger",columns:[{name:"amount",data_type:"decimal",nullable:false,comment:"Revenue local"}]}],functions:[]},
        {id:"bbbbbbbb-2222-4222-8222-222222222222",server:remote,catalog:"db",database:"app",tables:[{name:"ledger",columns:[{name:"amount",data_type:"nvarchar",nullable:false,comment:"Revenue remote"}]}],functions:[]},
      ],fileSchemas:{[uri]:id},fileDialects:{[uri]:"sqlserver"}});
      await my.updateConfiguration(namespaceConfig("remote"));
      const sync=async()=>{
        const version=model.getVersionId();await my.didChange(uri,model.getValue(),version);
        const deadline=Date.now()+10000;while(diagnostics.get(`${my.getSessionKey()}:${uri}`)?.version!==version&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
        const result=diagnostics.get(`${my.getSessionKey()}:${uri}`);check(result?.version===version,"namespace document diagnostics version");
        check(!result.diagnostics.some(d=>d.code==="PARSE_ERROR"),"namespace query is syntactically accepted");
      };
      for(const [marked,ty] of [
        ["SELECT r.rev<cursor>suffix FROM remote.db.app.ledger r","nvarchar"],
        ["SELECT r.rev<cursor>suffix FROM db.app.ledger r","decimal"],
        ["WITH q AS (SELECT amount FROM remote.db.app.ledger) SELECT q.amount<cursor>suffix FROM q","nvarchar"],
        ["WITH q AS (SELECT l.amount FROM db.app.ledger l JOIN remote.db.app.ledger r ON 1=1) SELECT q.amount<cursor>suffix FROM q","decimal"],
      ] as const){
        const at=marked.indexOf("<cursor>");model.setValue(marked.replace("<cursor>",""));editor.setPosition(model.getPositionAt(at));await sync();
        const position=model.getPositionAt(at);const list=await my.getCompletionList(uri,position.lineNumber-1,position.column-1);
        const item=list.items.find(i=>i.label==="amount");check(item,"native namespace-bound field exists");check(item.detail?.includes(ty),"native namespace-bound candidate retains actual source type");
        const resolved=await my.resolveCompletionItem(item);check(resolved.detail?.includes(ty),"lazy resolve preserves namespace type");
        const [suggestion]=lspCompletionItemsToMonacoSuggestions({monaco,ownerKey:"desktop-namespace",items:[resolved],typedWord:model.getWordUntilPosition(position).word,completedContextKeyword:false,defaultRange:new monaco.Range(position.lineNumber,position.column,position.lineNumber,position.column),rankByUsage:false,usageScope:"desktop-namespace",recordUsageCommand:"unused.acceptance",driver:"sqlserver",nextCharacter:model.getValue()[at]});
        check(suggestion,"namespace real Monaco suggestion");const range="replace" in suggestion.range?suggestion.range.replace:suggestion.range;
        editor.executeEdits("namespace.acceptance",[{range,text:suggestion.insertText}]);await sync();
        check(!model.getValue().includes("suffix")&&model.getValue().includes(".amount"),"namespace candidate accepts canonical identifier across full suffix");
      }
      const unknown="SELECT r.rev FROM unknown.db.app.ledger r";model.setValue(unknown);await sync();
      const pos=model.getPositionAt(unknown.indexOf("rev")+3);let list=await my.getCompletionList(uri,pos.lineNumber-1,pos.column-1);
      check(!list.items.some(i=>i.kind===5),"unknown server cannot borrow either local or remote registered fields");
      const refresh="SELECT r.rev FROM remote.db.app.ledger r";model.setValue(refresh);await sync();const rp=model.getPositionAt(refresh.indexOf("rev")+3);
      for(const [server,expected] of [["remote",true],["other",false],["remote",true]] as const){
        await my.updateConfiguration(namespaceConfig(server));list=await my.getCompletionList(uri,rp.lineNumber-1,rp.column-1);
        check(list.items.some(i=>i.label==="amount"&&i.detail?.includes("nvarchar"))===expected,"server-only refresh changes same-document native candidates");
      }
      myDialect="mysql";await my.updateConfiguration(searchConfig("mysql"));
    });
    await step("native-default-schema-precedence-proven-fallback-and-refresh",async()=>{
      myDialect="sqlserver";
      const defaultConfig=(effective:string|null,primary:boolean,complete:boolean,otherCatalogs=0)=>{
        const namespace=effective?{default_schema:effective,tables_complete:complete}:null;
        const table=(ty:string)=>({name:"ledger",columns:[{name:"amount",data_type:ty,nullable:false,comment:`Revenue ${ty}`}]});
        return {schemas:[
          {id,catalog:"db",database:"dbo",namespace,tables:[table("decimal")],functions:[]},
          {id:"bbbbbbbb-2222-4222-8222-222222222222",catalog:"db",database:"sales",namespace,tables:primary?[table("uuid")]:[],functions:[]},
          ...Array.from({length:otherCatalogs},(_,i)=>({id:`cccccccc-3333-4333-8333-${i.toString(16).padStart(12,"0")}`,catalog:`shadow${i}`,database:"sales",namespace:{default_schema:"sales",tables_complete:true},tables:[{name:"ledger",columns:Array.from({length:100},(_,j)=>({name:j===0?"amount":`c${j}`,data_type:"text",nullable:false}))}],functions:[]})),
        ],fileSchemas:{[uri]:id},fileDialects:{[uri]:"sqlserver"}};
      };
      const sync=async()=>{
        const version=model.getVersionId();await my.didChange(uri,model.getValue(),version);
        const deadline=Date.now()+10000;while(diagnostics.get(`${my.getSessionKey()}:${uri}`)?.version!==version&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
        const report=diagnostics.get(`${my.getSessionKey()}:${uri}`);check(report?.version===version,"default schema diagnostics version");check(!report.diagnostics.some(d=>d.code==="PARSE_ERROR"),"omitted schema query parses");
      };
      const sql="SELECT r.rev FROM db..ledger r";model.setValue(sql);await sync();const position=model.getPositionAt(sql.indexOf("rev")+3);
      for(const [effective,primary,complete,ty] of [[null,false,true,null],["sales",false,false,null],["sales",false,true,"decimal"],["sales",true,false,"uuid"],["dbo",true,false,"decimal"],[null,true,true,null]] as const){
        await my.updateConfiguration(defaultConfig(effective,primary,complete));const list=await my.getCompletionList(uri,position.lineNumber-1,position.column-1);
        if(ty)check(list.items.some(i=>i.label==="amount"&&i.detail?.includes(ty)),"same SQL uses the effective schema and coverage proof");
        else check(!list.items.some(i=>i.kind===5),"unknown or partial namespace cannot invent dbo fields");
        check(model.getValue()===sql,"namespace refresh requires no SQL edit");
      }
      for(const [primary,ty] of [[true,"uuid"],[false,"decimal"]] as const){
        await my.updateConfiguration(defaultConfig("sales",primary,true));
        const marked="WITH q AS (SELECT amount AS net FROM db..ledger) SELECT q.net<cursor>suffix FROM q";
        const at=marked.indexOf("<cursor>");model.setValue(marked.replace("<cursor>",""));await sync();const point=model.getPositionAt(at);
        const list=await my.getCompletionList(uri,point.lineNumber-1,point.column-1);const item=list.items.find(i=>i.label==="net");check(item,"default schema CTE field exists");check(item.detail?.includes(ty),"CTE inherits the proven schema type");
        const resolved=await my.resolveCompletionItem(item);const [suggestion]=lspCompletionItemsToMonacoSuggestions({monaco,ownerKey:"desktop-default-schema",items:[resolved],typedWord:model.getWordUntilPosition(point).word,completedContextKeyword:false,defaultRange:new monaco.Range(point.lineNumber,point.column,point.lineNumber,point.column),rankByUsage:false,usageScope:"desktop-default-schema",recordUsageCommand:"unused.acceptance",driver:"sqlserver",nextCharacter:model.getValue()[at]});
        check(suggestion,"default schema Monaco suggestion");const range="replace" in suggestion.range?suggestion.range.replace:suggestion.range;editor.executeEdits("default-schema.acceptance",[{range,text:suggestion.insertText}]);await sync();
        check(!model.getValue().includes("suffix")&&model.getValue().includes("SELECT q.net FROM"),"default schema accepts the actual output name");
        const hover=model.getPositionAt(model.getValue().lastIndexOf("net")+1);check(JSON.stringify(await my.getHover(uri,hover.lineNumber-1,hover.column-1)).includes(ty),"accepted CTE hover preserves selected schema type");
      }
      for(const otherCatalogs of [0,64,256]){
        await my.updateConfiguration(defaultConfig("sales",true,true,otherCatalogs));model.setValue(sql);await sync();const point=model.getPositionAt(sql.indexOf("rev")+3);
        const rounds=20,warmup=3,milliseconds:number[]=[];let fields=0;
        for(let i=0;i<rounds+warmup;i++){const start=performance.now();const list=await my.getCompletionList(uri,point.lineNumber-1,point.column-1);if(i>=warmup)milliseconds.push(performance.now()-start);fields=list.items.filter(i=>i.kind===5).length;check(list.items.some(i=>i.label==="amount"&&i.detail?.includes("uuid")),"other catalogs cannot replace the proven default source");}
        check(fields===1,"default schema benchmark keeps exact candidate set");const sorted=[...milliseconds].sort((a,b)=>a-b);
        defaultSchemaPerformanceSamples.push({otherCatalogs,columnsPerCatalog:100,rounds,warmup,fields,milliseconds,p50Milliseconds:sorted[Math.ceil(rounds*.5)-1]!,p95Milliseconds:sorted[Math.ceil(rounds*.95)-1]!});
      }
      myDialect="mysql";await my.updateConfiguration(searchConfig("mysql"));
    });
    myDialect="sqlserver";
    documentBindings=await runDocumentBindingsAcceptance({monaco,editor,client:my,check,step,restoreConfiguration:()=>my.updateConfiguration(searchConfig("mysql"))});
    myDialect="mysql";
    cachedCompletion=await runCachedCompletionAcceptance({monaco,editor,client:my,check,step});
    queryDocumentCompletion=await runQueryLocalCompletionAcceptance({monaco,editor,client:my,check,step});
    liveNamespace=await runLiveNamespaceAcceptance({monaco,editor,client:my,check,step});
    semanticOperations=await runSemanticOperationAcceptance({check,step});
    semanticConsumer=await runOperationConsumerAcceptance({monaco,editor,client:my,check,step});
    whereCompletion=await runWhereCompletionAcceptance({client:my,check,step});
    fileQueryIntelligence=await runFileQueryIntelligenceAcceptance({monaco,editor,check,step});
    await step("configuration-receipt-without-documents-and-after-restart",async()=>{
      const client=new LspClient("configuration-receipt-native");
      try {
        await client.initialize(binary.path);
        check(!await client.confirmAnalysisConfiguration("first-context"),"fresh process rejects an unknown configuration");
        await client.updateConfiguration({oxideAnalysisToken:"first-context",defaultDialect:"postgres",schemas:[]});
        check(await client.confirmAnalysisConfiguration("first-context"),"Host returns the committed token without opening SQL");
        await client.updateConfiguration({oxideAnalysisToken:"second-context",defaultDialect:"mysql",schemas:[]});
        check(!await client.confirmAnalysisConfiguration("first-context"),"configuration overwrite revokes the old token");
        check(await client.confirmAnalysisConfiguration("second-context"),"replacement token is committed");
        await client.shutdown();check(!await client.confirmAnalysisConfiguration("second-context"),"stopped client cannot grant a receipt");
        await client.initialize(binary.path);check(!await client.confirmAnalysisConfiguration("second-context"),"process restart revokes old receipts");
        configurationReceipt={realHostTransport:true,withoutDocuments:true,overwriteRevoked:true,restartRevoked:true};
      } finally {if(client.isInitialized())await client.shutdown();}
      check(!await client.isRunning(),"receipt-only process stopped");
    });
    multiDocumentFormatting=await runMultiDocumentFormattingAcceptance({monaco,binaryPath:binary.path,check,step});
    multiDocumentSemantics=await runMultiDocumentSemanticsAcceptance({monaco,binaryPath:binary.path,check,step});
    mainRestart=await runMainRestartAcceptance({monaco,editor,check,step});
    sharedDocument=await runSharedDocumentAcceptance({monaco,editor,binaryPath:binary.path,check,step});
    sharedLocalMarkers=await runSharedLocalMarkersAcceptance({monaco,editor,check,step});
    documentStructure=await runDocumentStructureAcceptance({monaco,editor,binaryPath:binary.path,check,step});
    documentSemantics=await runDocumentSemanticsAcceptance({monaco,editor,binaryPath:binary.path,check,step});
    check(monaco.editor.getModels().includes(model),"real Monaco model, no adapter mock");
  } catch(error){failure=error;}
  finally {
    for(const client of clients){if(client.isInitialized()){try{await client.didClose(uri);await client.shutdown();check(!await client.isRunning(),"session stopped");}catch(error){failure??=error;}}}
    unlisten();editor.dispose();model.dispose();
    await invoke("acceptance_finish",{report:{success:failure===undefined,error:failure instanceof Error?failure.stack:String(failure??""),binary,assertions,receipts,realMonaco:true,productionFrontendClient:true,installedPackageTested:false,visibleSuggestionWidgetTested:false,cachedCompletion,queryDocumentCompletion,whereCompletion,defaultSchemaPerformanceSamples,configurationReceipt,multiDocumentFormatting,multiDocumentSemantics,mainRestart,sharedDocument,sharedLocalMarkers,documentStructure,documentSemantics,documentBindings,liveNamespace,semanticOperations,semanticConsumer,fileQueryIntelligence}});
  }
}
void run().catch(async(error)=>{try{await invoke("acceptance_finish",{report:{success:false,error:String(error)}});}catch{console.error(error);}});
