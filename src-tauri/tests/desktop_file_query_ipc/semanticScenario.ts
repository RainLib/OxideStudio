// Exercise the mounted production FileQueryEditor, including a real warm
// server catalog while only its renderer acknowledgement is held.
// @ts-expect-error Monaco internal services do not publish declarations.
import {StandaloneServices} from "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js";
// @ts-expect-error Monaco internal services do not publish declarations.
import {ICommandService} from "monaco-editor/esm/vs/platform/commands/common/commands.js";
import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/goToCommands.js";
import "monaco-editor/esm/vs/editor/contrib/documentSymbols/browser/documentSymbols.js";
import type * as Monaco from "monaco-editor";
import {getLspSessionDescriptor} from "@/services/lsp/sessionRegistry";
import {useTabStore} from "@/store/useTabStore";
import {fileQueryService,type FileQuerySession} from "@/services/tauri/file-query.service";
import {prepareLocalCompletionAcceptance} from "./completionScenario";
export async function runFileSemanticAcceptance(options:{session:FileQuerySession;editor:Monaco.editor.ICodeEditor;check:(value:unknown,message:string)=>asserts value;wait:(test:()=>boolean,message:string)=>Promise<void>}){
  const {session,editor,wait}=options,check:typeof options.check=options.check,model=editor.getModel()!;
  const ready=()=>Boolean(document.querySelector('[aria-label="SQL intelligence ready"]'));
  await wait(ready,"file semantics has a confirmed physical positive control");
  const descriptor=getLspSessionDescriptor({documentSessionKey:"file-query:"+session.projectId+":"+session.id,driver:session.driverId,capabilities:session.capabilities});check(descriptor&&descriptor.client.isInitialized(),"semantic file scenario uses the mounted editor's real LSP");
  const client=descriptor.client,command=StandaloneServices.get(ICommandService)as{executeCommand<T=any>(id:string,...args:unknown[]):Promise<T>};
  const point=(needle:string)=>model.getPositionAt(model.getValue().lastIndexOf(needle)+needle.length-1);
  const originalHover=client.getHover,originalSemantic=client.getDocumentSemantics,originalConfirm=client.confirmAnalysisConfiguration,originalFormat=client.formatDocument;
  const frames:Array<{kind:string;dialect:string;version:number}>=[];let physical=0,formats=0,held=false,release!:()=>void;const gate=new Promise<void>(done=>{release=done;});
  let completion:Awaited<ReturnType<typeof prepareLocalCompletionAcceptance>>|undefined;
  client.getHover=(...args)=>{physical++;return originalHover.apply(client,args);};
  client.formatDocument=(...args)=>{formats++;return originalFormat.apply(client,args);};
  client.getDocumentSemantics=(async request=>{frames.push({kind:request.operation.kind,dialect:request.dialect,version:request.version});return originalSemantic.call(client,request);})as typeof client.getDocumentSemantics;
  try{
    model.setValue("SELECT d.label FROM data d");
    const warm=await command.executeCommand<any[]>("_executeHoverProvider",model.uri,point("d.label"));check(JSON.stringify(warm).toUpperCase().includes("VARCHAR"),"production file hover uses the actual source VARCHAR type");check(physical>0,"the warm hover actually uses the standard physical RPC");
    check(Boolean(editor.getAction("editor.action.showHover")),"actual Monaco hover UI is installed");editor.setPosition(point("d.label"));editor.focus();editor.trigger("file.semantic","editor.action.showHover",{});
    const widget=()=>Array.from(document.querySelectorAll<HTMLElement>(".monaco-hover")).find(node=>node.getClientRects().length>0);
    await wait(()=>Boolean(widget()?.textContent?.toUpperCase().includes("VARCHAR")),"mounted FileQueryEditor renders its actual physical hover widget");editor.trigger("file.semantic","editor.action.hideHover",{});
    model.setValue("WITH q AS (SELECT CAST(1 AS INTEGER) AS local_count) SELECT q.local_count, q.locSuffix FROM q; SELECT d.label FROM data d;");
    await wait(()=>useTabStore.getState().tabs.find(tab=>tab.id===useTabStore.getState().activeTabId)?.sql===model.getValue(),"complex local SQL is committed through the production file editor");
    completion=await prepareLocalCompletionAcceptance({client,editor,check,wait});
    client.confirmAnalysisConfiguration=async token=>{const result=await originalConfirm.call(client,token);held=true;await gate;return result;};
    useTabStore.setState(state=>({tabs:state.tabs.map(tab=>tab.fileQuery?.session?.id===session.id?{...tab,fileQuery:{...tab.fileQuery,schema:tab.fileQuery.schema?.map(column=>({...column}))}}:tab)}));
    await wait(()=>held&&!ready(),"actual server configuration is committed while renderer confirmation is deliberately held");await completion.pending();const beforePhysical=physical,beforeVersion=model.getVersionId();
    const hover=await command.executeCommand<any[]>("_executeHoverProvider",model.uri,point("q.local_count"));check(JSON.stringify(hover).toUpperCase().includes("INTEGER"),"file hover keeps inferred local CTE types before metadata confirmation; details="+JSON.stringify({hover,frames,profile:descriptor.profile.serverDialect}));check(physical===beforePhysical,"unconfirmed file hover does not read physical server metadata");
    const symbols=await command.executeCommand<any[]>("_executeDocumentSymbolProvider",model.uri);check(symbols.some(value=>value.name==="q"),"actual file outline keeps its local CTE during confirmation");check(!symbols.some(value=>value.name==="data"),"scoped file outline excludes physical source objects");
    const definitions=await command.executeCommand<any[]>("_executeDefinitionProvider",model.uri,point("FROM q"));check(definitions.length>0,"production file navigation resolves its CTE before physical readiness");
    const raw=await client.getDocumentSymbols(model.uri.toString());check(raw.some(value=>value.name==="data"),"warm physical file catalog is retained on the actual server");
    const actual=await fileQueryService.query(session,"WITH q AS (SELECT CAST(1 AS INTEGER) AS local_count) SELECT q.local_count FROM q");check(actual[0]?.columns[0]?.data_type.toUpperCase()==="INTEGER"&&actual[0]?.rows[0]?.[0]===1,"actual signed DuckDB agrees with the inferred local CAST type and value");
    const beforeSql=model.getValue(),beforeFormats=formats;await editor.getAction("editor.action.formatDocument")!.run();check(model.getValue()===beforeSql&&formats===beforeFormats,"unconfirmed preferences do not start a format RPC or apply old edits");
    check(frames.some(value=>value.kind==="hover")&&frames.some(value=>value.kind==="definitions"),"both file-local paths use the explicit scoped semantic RPC");check(frames.every(value=>value.dialect===descriptor.profile.serverDialect),"scoped file operations use the signed profile's concrete server dialect");check(model.getVersionId()===beforeVersion,"the configuration window and navigation preserve SQL model version");
    release();await wait(ready,"the file editor restores physical readiness after its actual acknowledgement");const completions=await completion.confirmed();model.setValue("select label from data");await editor.getAction("editor.action.formatDocument")!.run();check(model.getValue().includes("SELECT")&&formats>beforeFormats,"confirmed file preferences restore actual formatting");
    const logicalModel=model.getValue();
    for(const [index,expression]of ["CAST(1 AS INTEGER)","CAST('true' AS VARCHAR)","CAST('1' AS BIT)"].entries()){
      const actual=await fileQueryService.query(session,`SELECT (${expression}) AND TRUE AS result`);check(actual[0]?.rows[0]?.[0]===true,"actual signed DuckDB accepts the modeled scalar logical coercion");
      const probe=model.uri.toString()+"?logical="+index,sql=`SELECT 1 WHERE ${expression} `;await client.didOpen(probe,sql,1,descriptor.profile.serverDialect);
      try{const result=await client.getDocumentCompletions({uri:probe,version:1,dialect:descriptor.profile.serverDialect,position:{line:0,character:sql.length},preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}});check(result?.logicalContinuation===true&&result.items.some(item=>item.label==="AND"),"actual file LSP and signed engine agree on the scalar logical type");}finally{await client.didClose(probe);}
    }
    for(const [index,expression]of ["EXISTS(SELECT NULL)","NOT EXISTS(SELECT 1 WHERE 1=0)","CASE WHEN 1=1 THEN EXISTS(SELECT NULL) ELSE NOT EXISTS(SELECT 1 WHERE 1=0) END"].entries()){
      const actual=await fileQueryService.query(session,`SELECT (${expression}) AS result`);check(actual[0]?.rows[0]?.[0]===true&&actual[0].columns[0]?.data_type.toUpperCase()==="BOOLEAN","actual signed DuckDB verifies the predicate value and Boolean result type");
      const probe=model.uri.toString()+"?predicate="+index,sql=`SELECT 1 WHERE ${expression} `;await client.didOpen(probe,sql,1,descriptor.profile.serverDialect);
      try{const result=await client.getDocumentCompletions({uri:probe,version:1,dialect:descriptor.profile.serverDialect,position:{line:0,character:sql.length},preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}});check(result?.logicalContinuation===true&&result.items.some(item=>item.label==="AND"&&item.kind===14),"actual file LSP models the signed engine's complete predicate as a logical operand");}finally{await client.didClose(probe);}
    }
    for(const [index,[expression,expected]] of ([
      ["'oxide' ILIKE 'OX%'",true],["'oxide' NOT ILIKE 'DB%'",true],
      ["'oxide' SIMILAR TO '(ox|db).*'",true],["regexp_matches('oxide','^ox')",true],
      ["regexp_full_match('oxide','ox.*')",true],["regexp_matches('oxide','^OX','i')",true],
      ["regexp_matches(NULL,'^ox')",null],["'oxide' GLOB 'ox*'",true],
    ] as const).entries()){
      const actual=await fileQueryService.query(session,`SELECT (${expression}) AS result`);
      check(actual[0]?.rows[0]?.[0]===expected&&actual[0]?.columns[0]?.data_type.toUpperCase()==="BOOLEAN","actual signed DuckDB verifies pattern values, options and NULL propagation");
      const probe=model.uri.toString()+"?pattern="+index,sql=`WITH q AS (SELECT ${expression} AS matched) SELECT 1 FROM q WHERE q.matched = `;
      await client.didOpen(probe,sql,1,descriptor.profile.serverDialect);
      try{const result=await client.getDocumentCompletions({uri:probe,version:1,dialect:descriptor.profile.serverDialect,position:{line:0,character:sql.length},preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}});check(result?.valueType?.toLowerCase()==="boolean"&&result.items.some(item=>item.label==="TRUE")&&!result.items.some(item=>item.label==="0"),"actual file LSP matches signed DuckDB pattern result types through a CTE");}finally{await client.didClose(probe);}
    }
    for(const [index,[expression,expected]] of ([
      ["'oxide_1' LIKE 'oxide#_1' ESCAPE '#'",true],["'oxide_1' NOT LIKE 'db#_1' ESCAPE '#'",true],
      ["'OXIDE_1' ILIKE 'oxide#_1' ESCAPE '#'",true],["'oxide_1' NOT ILIKE 'DB#_1' ESCAPE '#'",true],
      ["'oxide_1' LIKE 'oxide_1' ESCAPE ''",true],["'oxide_1' LIKE 'oxide#_1' ESCAPE SUBSTR('##',1,1)",true],
      ["'oxide_1' LIKE 'oxide#_1' ESCAPE NULL",null],["NULL LIKE 'oxide#_1' ESCAPE '#'",null],
    ] as const).entries()){
      const actual=await fileQueryService.query(session,`SELECT (${expression}) AS result`);
      check(actual[0]?.rows[0]?.[0]===expected&&actual[0]?.columns[0]?.data_type.toUpperCase()==="BOOLEAN","actual signed DuckDB verifies escaped pattern values and NULL propagation");
      const logicalActual=await fileQueryService.query(session,`SELECT (${expression}) AND TRUE AS result`);
      check(logicalActual[0]?.rows[0]?.[0]===expected&&logicalActual[0]?.columns[0]?.data_type.toUpperCase()==="BOOLEAN","actual signed DuckDB verifies the escaped predicate in a logical expression");
      const logicalProbe=model.uri.toString()+"?escape-logical="+index,logicalSql=`SELECT 1 WHERE ${expression} `;await client.didOpen(logicalProbe,logicalSql,1,descriptor.profile.serverDialect);
      try{const result=await client.getDocumentCompletions({uri:logicalProbe,version:1,dialect:descriptor.profile.serverDialect,position:{line:0,character:logicalSql.length},preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}});check(result?.logicalContinuation===true&&result.items.some(item=>item.label==="AND")&&!result.items.some(item=>item.label==="ESCAPE"),"actual file LSP offers logical continuation without a second ESCAPE");}finally{await client.didClose(logicalProbe);}
      const probe=model.uri.toString()+"?escape-result="+index,sql=`WITH q AS (SELECT ${expression} AS matched) SELECT 1 FROM q WHERE q.matched = `;
      await client.didOpen(probe,sql,1,descriptor.profile.serverDialect);
      try{const result=await client.getDocumentCompletions({uri:probe,version:1,dialect:descriptor.profile.serverDialect,position:{line:0,character:sql.length},preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}});check(result?.valueType?.toLowerCase()==="boolean"&&result.items.some(item=>item.label==="TRUE")&&result.valueRole===undefined,"actual file LSP infers the escaped CTE Boolean without confusing its later comparison with an escape operand");}finally{await client.didClose(probe);}
    }
    const escapeProbe=model.uri.toString()+"?escape-character",escapeSql="/*😀*/\r\nSELECT 1 WHERE 'oxide_1' LIKE 'oxide#_1' ESCAPE ";
    await client.didOpen(escapeProbe,escapeSql+"Suffix;",1,descriptor.profile.serverDialect);
    try{const result=await client.getDocumentCompletions({uri:escapeProbe,version:1,dialect:descriptor.profile.serverDialect,position:{line:1,character:escapeSql.length-escapeSql.lastIndexOf("\n")-1},preferences:{keywordCase:"upper",functionCase:"upper",tableAlias:"none"}});check(result?.valueRole==="pattern-escape"&&result.items.some(item=>item.label==="'#'")&&!result.items.some(item=>["TRUE","0","''"].includes(item.label)),"signed file LSP exposes the same bound escape role and character choices");}finally{await client.didClose(escapeProbe);}
    check(model.getValue()===logicalModel,"independent logical and pattern probes preserve the real file editor SQL");
    return {physicalHoverAndWidget:true,scopedLocalHover:true,scopedLocalOutline:true,scopedLocalNavigation:true,warmCatalogRetained:true,controlledConfirmationHold:true,formatWaitsForPreferences:true,logicalScalarCoercion:true,analyticPredicateResults:true,patternResults:true,escapedPatternResults:true,patternLogicalContinuations:true,...completions,profile:descriptor.profile.serverDialect,frames};
  }finally{release();completion?.dispose();client.getHover=originalHover;client.getDocumentSemantics=originalSemantic;client.confirmAnalysisConfiguration=originalConfirm;client.formatDocument=originalFormat;}
}
