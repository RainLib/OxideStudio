// @ts-expect-error Monaco internal service declarations are not published.
import {StandaloneServices} from "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js";
// @ts-expect-error Monaco internal service declarations are not published.
import {ICommandService} from "monaco-editor/esm/vs/platform/commands/common/commands.js";
// @ts-expect-error Monaco internal service declarations are not published.
import {ILanguageFeaturesService} from "monaco-editor/esm/vs/editor/common/services/languageFeatures.js";
import "monaco-editor/esm/vs/editor/contrib/rename/browser/rename.js";
import "monaco-editor/esm/vs/editor/contrib/codeAction/browser/codeAction.js";
import type * as Monaco from "monaco-editor";
import {LspClient} from "@/services/lsp/client/LspClient";
import {acquireLspDocument,type LspDocumentLease} from "@/services/lsp/documentOwnership";
import {commitLspDocumentShadow} from "@/features/query-editor/model/lspDocumentSync";
import {registerLspCoreProviders} from "@/features/query-editor/hooks/useLspCoreProviderCoordinator";
import {registerLspHoverProvider} from "@/features/query-editor/hooks/useLspHoverProviderCoordinator";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
type Environment={monaco:typeof import("monaco-editor/esm/vs/editor/editor.api.js");editor:Monaco.editor.IStandaloneCodeEditor;binaryPath:string;check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};
export async function runDocumentSemanticsAcceptance(environment:Environment){
  const {monaco,editor,binaryPath,step}=environment,check:Environment["check"]=environment.check;
  const command=StandaloneServices.get(ICommandService)as{executeCommand<T=any>(id:string,...args:unknown[]):Promise<T>};
  const features=StandaloneServices.get(ILanguageFeaturesService)as any;
  const uri="oxide-semantic://project/current.sql",language="oxide-local-semantic-native",client=new LspClient("document-semantic-native"),analysisToken=crypto.randomUUID();
  const source="/* 漢😀 */\nWITH q AS (SELECT 1 AS local_id) SELECT COALESCE(q.local_id, 2) FROM q;\nSELECT private_fn(1), secret_value FROM ledger;\nINSERT INTO ledger VALUES(2);\nINSERT INTO ledger(explicit_value) VALUES(3);";
  monaco.languages.register({id:language});const previous=editor.getModel(),model=monaco.editor.createModel(source,language,monaco.Uri.parse(uri));editor.setModel(model);
  const versions={current:new Map<string,number>()},texts={current:new Map<string,string>()},opened={current:new Set<string>()},listeners=new Set<()=>void>();
  let state:CompletionContextState={connection:{},runtime:{},execution:{},projectId:"local-semantic",route:uri,generation:{},metadataVersion:1,available:true,syntaxAllowed:true,lspAllowed:true,metadataAllowed:true,analysisToken};
  const emit=(patch:Partial<CompletionContextState>)=>{state={...state,...patch};for(const listener of listeners)listener();};
  let lease:LspDocumentLease|undefined,core:ReturnType<typeof registerLspCoreProviders>|undefined,hover:ReturnType<typeof registerLspHoverProvider>|undefined;
  let hold=false,held:any,release:(()=>void)|undefined;const frames:Array<{kind:string;version:number;nonempty:boolean}>=[];
  const original=client.getDocumentSemantics;client.getDocumentSemantics=(async(request:any)=>{const result=await original.call(client,request);frames.push({kind:request.operation.kind,version:request.version,nonempty:result?.value!==null});if(hold&&request.operation.kind==="definitions"){hold=false;held=result;await new Promise<void>(done=>{release=done;});}return result;})as typeof client.getDocumentSemantics;
  const point=(needle:string)=>model.getPositionAt(model.getValue().lastIndexOf(needle)+needle.length-(needle.endsWith("(")?0:1));
  const sync=async()=>{await lease!.synchronize(model.getValue(),"postgres");};
  const fullRange=()=>model.getFullModelRange();
  const wait=async(test:()=>boolean,message:string)=>{const end=Date.now()+10000;while(!test()&&Date.now()<end)await new Promise(done=>setTimeout(done,20));check(test(),message);};
  try{
    await client.initialize(binaryPath);await client.updateConfiguration({oxideAnalysisToken:analysisToken,defaultDialect:"postgres",fileDialects:{[uri]:"postgres"},fileSchemas:{[uri]:"00000000-0000-4000-8000-000000000001"},schemas:[{id:"00000000-0000-4000-8000-000000000001",database:"app",tables:[{name:"ledger",columns:[{name:"secret_value",data_type:"integer",nullable:false}]}],functions:[{name:"private_fn",return_type:"integer",parameters:[{name:"secret_arg",data_type:"integer",optional:false,mode:"IN"}]}]}]});check(await client.confirmAnalysisConfiguration(analysisToken),"local semantics uses a confirmed real warm physical catalog");
    lease=acquireLspDocument({client,sessionKey:client.getSessionKey(),uri,priority:1,onShadow:shadow=>commitLspDocumentShadow({uri,text:shadow.text,version:shadow.version,openedDocuments:opened.current,documentVersions:versions.current,documentTexts:texts.current})});await sync();
    core=registerLspCoreProviders({monaco,editor,canUseLsp:true,documentUri:uri,editorLanguageId:language,serverDialect:"postgres",lspClient:client,documentVersionsRef:versions,documentTextsRef:texts,syncDocument:sync,getSemanticContext:()=>state,subscribeSemanticContext:listener=>{listeners.add(listener);return ()=>{listeners.delete(listener);};}});
    hover=registerLspHoverProvider({monaco,lspClient:client,editorLanguageId:language,getRuntime:()=>({canUseLsp:true,documentUri:uri,documentLanguageId:"postgres",serverDialect:"postgres",driver:"postgres",openedDocumentsRef:opened,documentVersionsRef:versions,documentTextsRef:texts,schemaTables:[],showTableDdlHoverPreview:false,supportsTableBrowsing:false,getSemanticContext:()=>state})});
    await step("document-semantics-actual-hints-with-incomplete-physical-metadata",async()=>{
      const full=await command.executeCommand<any>("_executeSignatureHelpProvider",model.uri,point("private_fn("));check(full?.signatures.some((value:any)=>value.label.includes("secret_arg")),"real Monaco signature has a physical positive control");
      const provider=features.inlayHintsProvider.ordered(model)[0],physical=await provider.provideInlayHints(model,fullRange(),{});check(JSON.stringify(physical.hints).includes("secret_value:"),"production inlay provider sees a physical implicit INSERT column before withdrawal");physical.dispose();
      emit({metadataAllowed:false,generation:{}});
      const progressive=await command.executeCommand<any>("_executeSignatureHelpProvider",model.uri,point("private_fn("));check(progressive?.signatures.some((value:any)=>value.label.includes("secret_arg")),"confirmed server signatures remain available while only renderer cache completeness is withheld");
      const progressiveHints=await provider.provideInlayHints(model,fullRange(),{});check(JSON.stringify(progressiveHints.hints).includes("secret_value:"),"confirmed server inlays are retained during progressive catalog loading");progressiveHints.dispose();
      emit({lspAllowed:false,analysisToken:undefined,generation:{}});
      const hidden=await command.executeCommand<any>("_executeSignatureHelpProvider",model.uri,point("private_fn("));check(!hidden,"physical routine signature is absent after its server source grant is withdrawn");
      const builtin=await command.executeCommand<any>("_executeSignatureHelpProvider",model.uri,point("COALESCE("));check(builtin?.signatures.length>0,"actual Monaco builtin signature stays available");
      const local=await command.executeCommand<any[]>("_executeHoverProvider",model.uri,point("q.local_id"));check(JSON.stringify(local).includes("integer")&&!JSON.stringify(local).includes("secret_value"),"actual Monaco local CTE hover retains inferred type without physical columns");
      const hints=await provider.provideInlayHints(model,fullRange(),{});check(JSON.stringify(hints.hints).includes("explicit_value:")&&!JSON.stringify(hints.hints).includes("secret_value:"),"production inlays keep explicit INSERT labels and exclude physical implicit labels");hints.dispose();
      const tokens=await features.documentSemanticTokensProvider.ordered(model)[0].provideDocumentSemanticTokens(model,null,{});check(tokens.data.length>0,"production semantic tokens retain local CTE binding");
      const privatePoint=point("private_fn("),raw=await client.getSignatureHelp(uri,privatePoint.lineNumber-1,privatePoint.column-1);check(raw?.signatures.some(value=>value.label.includes("secret_arg")),"physical catalog remains on the server after every local-only hint");
      check(model.getValue()===source,"hint authority changes do not edit SQL");
    });
    await step("document-semantics-real-navigation-rename-and-cte-star-action",async()=>{
      emit({available:false,lspAllowed:false,metadataAllowed:false,syntaxAllowed:true,generation:{}});
      const definitions=await command.executeCommand<any[]>("_executeDefinitionProvider",model.uri,point("q.local_id"));check(definitions.length>0,"actual local definition works with physical availability false");
      const references=await command.executeCommand<any[]>("_executeReferenceProvider",model.uri,point("FROM q"));check(references.length===3,"actual CTE references contain declaration, qualifier and relation");
      const prepared=await command.executeCommand<any>("_executePrepareRename",model.uri,point("FROM q"));check(prepared.text==="q","actual prepare-rename identifies only the local CTE");
      const renamed=await command.executeCommand<any>("_executeDocumentRenameProvider",model.uri,point("FROM q"),"fresh_q");check(renamed.edits.length===3,"actual rename returns the three bound local edits");
      editor.executeEdits("local-semantic-rename",renamed.edits.map((value:any)=>value.textEdit));await sync();check(model.getValue().includes("WITH fresh_q AS")&&model.getValue().includes("fresh_q.local_id")&&model.getValue().includes("FROM fresh_q;"),"actual editor applies local CTE rename edits");
      const nested="WITH q AS (SELECT 1 AS local_id) SELECT * FROM q;";model.setValue(nested);await sync();const star=point("SELECT *"),range=new monaco.Range(star.lineNumber,star.column,star.lineNumber,star.column);
      const actions=await command.executeCommand<any[]>("_executeCodeActionProvider",model.uri,range,"refactor.rewrite");const expansion=actions.find(action=>JSON.stringify(action.edit).includes("local_id"));check(expansion?.edit?.edits.length>0,"actual code-action command expands a CTE projection from its local row source");
      editor.executeEdits("local-semantic-star",expansion.edit.edits.map((value:any)=>value.textEdit));await sync();check(model.getValue().includes("SELECT local_id FROM q")&&!model.getValue().includes("SELECT *"),"actual editor applies the scoped star expansion");
    });
    await step("document-semantics-six-profiles-and-late-nonempty-navigation",async()=>{
      for(const dialect of ["postgres","mysql","sqlite","sqlserver","hive","clickhouse"]){
        const p=point("FROM q"),request={uri,version:versions.current.get(uri)!,dialect};
        const refs=await client.getDocumentSemantics({...request,operation:{kind:"references",position:{line:p.lineNumber-1,character:p.column-1},includeDeclaration:true}});check((refs?.value.length??0)>=2,"scoped CTE reference binding supports explicit "+dialect);
        const rename=await client.getDocumentSemantics({...request,operation:{kind:"rename",position:{line:p.lineNumber-1,character:p.column-1},newName:"profile_q"}});check(Boolean(rename?.value?.changes?.[uri]?.length),"scoped CTE rename supports explicit "+dialect);
      }
      hold=true;const pending=command.executeCommand<any[]>("_executeDefinitionProvider",model.uri,point("FROM q"));await wait(()=>Boolean(release),"real nonempty definition response is held before publication");check(held?.value.length>0,"held response contains a genuine local definition");emit({syntaxAllowed:false,generation:{}});release!();check((await pending).length===0,"late local definition is discarded after syntax withdrawal");
      emit({syntaxAllowed:true,generation:{}});check((await command.executeCommand<any[]>("_executeDefinitionProvider",model.uri,point("FROM q"))).length>0,"a restored syntax grant reads a fresh local definition");
      const nested="WITH q AS (SELECT 1 AS id) SELECT q.id FROM q WHERE EXISTS (WITH q AS (SELECT 2 AS id) SELECT q.id FROM q); SELECT q.id FROM ledger q;";
      model.setValue(nested);await sync();emit({available:true,lspAllowed:true,metadataAllowed:true,syntaxAllowed:true,analysisToken,generation:{}});
      const standard=await command.executeCommand<any>("_executeDocumentRenameProvider",model.uri,model.getPositionAt(nested.indexOf("FROM q")+5),"outer_q");check(standard.edits.length===3,"full-metadata standard rename also preserves nested CTEs and unrelated aliases");
    });
    return {productionCoreAndHover:true,realHostLsp:true,warmPhysicalPositiveControl:true,physicalCatalogRetained:true,independentServerAndCacheGrants:true,serverWithdrawalLocalOnly:true,localBuiltinAndHover:true,localExplicitInlaysAndTokens:true,actualNavigation:true,actualRenameApplied:true,actualStarExpansionApplied:true,explicitProfiles:6,lateNonemptyRejected:true,frames};
  }finally{release?.();hover?.dispose();core?.dispose();await lease?.release();if(client.isInitialized())await client.shutdown();editor.setModel(previous);model.dispose();}
}
