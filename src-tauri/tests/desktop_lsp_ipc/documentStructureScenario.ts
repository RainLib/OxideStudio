// @ts-expect-error Monaco does not publish declarations for its internal services.
import {StandaloneServices} from "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js";
// @ts-expect-error Monaco does not publish declarations for its internal services.
import {ICommandService} from "monaco-editor/esm/vs/platform/commands/common/commands.js";
import type * as Monaco from "monaco-editor";
import {LspClient} from "@/services/lsp/client/LspClient";
import {acquireLspDocument,type LspDocumentLease} from "@/services/lsp/documentOwnership";
import {commitLspDocumentShadow} from "@/features/query-editor/model/lspDocumentSync";
import {registerLspCoreProviders} from "@/features/query-editor/hooks/useLspCoreProviderCoordinator";
import type {CompletionContextState} from "@/services/lsp/semanticContext";

type Environment={monaco:typeof import("monaco-editor/esm/vs/editor/editor.api.js");editor:Monaco.editor.IStandaloneCodeEditor;binaryPath:string;
  check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};
export async function runDocumentStructureAcceptance(environment:Environment){
  const {monaco,editor,binaryPath,step}=environment,check:Environment["check"]=environment.check;
  const command=StandaloneServices.get(ICommandService)as{executeCommand<T=any>(id:string,...args:unknown[]):Promise<T>};
  const uri="oxide-structure://document/current.sql",language="oxide-document-structure-native",client=new LspClient("document-structure-native"),token=crypto.randomUUID();
  const source="/* 漢😀 */\ncreate view local_v as select 1 as id;\nwith q as (\n select l.* from ledger l\n)\nselect private_fn(q.id) from q;";
  monaco.languages.register({id:language});const previous=editor.getModel(),model=monaco.editor.createModel(source,language,monaco.Uri.parse(uri));editor.setModel(model);
  const versions={current:new Map<string,number>()},texts={current:new Map<string,string>()},opened=new Set<string>(),listeners=new Set<()=>void>();
  let state:CompletionContextState={connection:{},runtime:{},execution:{},projectId:"document-structure",route:uri,generation:{},metadataVersion:1,available:true,syntaxAllowed:true,lspAllowed:true,metadataAllowed:true,analysisToken:token};
  const emit=(patch:Partial<CompletionContextState>)=>{state={...state,...patch};for(const listener of listeners)listener();};
  let lease:LspDocumentLease|undefined,registration:ReturnType<typeof registerLspCoreProviders>|undefined,hold=false,held:any,release:(()=>void)|undefined;
  const calls={symbols:0,folding:0,selection:0},frames:Array<{kind:string;version:number;items:number}>=[];
  const originalSymbols=client.getDocumentSymbols,originalFolds=client.getFoldingRanges,originalSelections=client.getSelectionRanges,originalStructure=client.getDocumentStructure;
  client.getDocumentSymbols=async(...args)=>{calls.symbols++;return originalSymbols.apply(client,args);};
  client.getFoldingRanges=async(...args)=>{calls.folding++;return originalFolds.apply(client,args);};
  client.getSelectionRanges=async(...args)=>{calls.selection++;return originalSelections.apply(client,args);};
  client.getDocumentStructure=(async(request:any)=>{
    const result=await originalStructure.call(client,request);frames.push({kind:request.kind,version:request.version,items:result?.items.length??0});
    if(hold&&request.kind==="symbols"){hold=false;held=result;await new Promise<void>(resolve=>{release=resolve;});}return result;
  })as typeof client.getDocumentStructure;
  const wait=async(test:()=>boolean,message:string)=>{const end=Date.now()+10000;while(!test()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));check(test(),message);};
  const symbols=()=>command.executeCommand<any[]>("_executeDocumentSymbolProvider",model.uri);
  const names=(values:any[])=>values.map(value=>value.name);
  try{
    await client.initialize(binaryPath);await client.updateConfiguration({oxideAnalysisToken:token,defaultDialect:"postgres",fileDialects:{[uri]:"postgres"},fileSchemas:{[uri]:"00000000-0000-4000-8000-000000000001"},schemas:[{id:"00000000-0000-4000-8000-000000000001",database:"app",tables:[{name:"ledger",columns:[{name:"id",data_type:"integer",nullable:false}]}],functions:[{name:"private_fn",return_type:"integer",parameters:[{name:"secret_arg",data_type:"integer",optional:false,mode:"IN"}]}]}]});
    check(await client.confirmAnalysisConfiguration(token),"structure session confirms its real warm physical configuration");
    lease=acquireLspDocument({client,sessionKey:client.getSessionKey(),uri,priority:1,onShadow:shadow=>commitLspDocumentShadow({uri,text:shadow.text,version:shadow.version,openedDocuments:opened,documentVersions:versions.current,documentTexts:texts.current})});
    await lease.synchronize(source,"postgres");
    registration=registerLspCoreProviders({monaco,editor,canUseLsp:true,documentUri:uri,editorLanguageId:language,serverDialect:"postgres",lspClient:client,
      documentVersionsRef:versions,documentTextsRef:texts,syncDocument:async current=>{await lease!.synchronize(current.getValue(),"postgres");},getSemanticContext:()=>state,subscribeSemanticContext:listener=>{listeners.add(listener);return ()=>{listeners.delete(listener);};}});
    await step("document-structure-monaco-withdrawn-metadata-keeps-local-outline",async()=>{
      const full=await symbols();check(names(full).includes("ledger"),"owning standard outline sees the configured physical table before withdrawal");
      check(full.some(value=>value.name==="private_fn"&&value.detail.includes("secret_arg")),"owning standard outline has a real physical routine signature positive control");
      const before={...calls};emit({available:false,lspAllowed:false,metadataAllowed:false,analysisToken:undefined,generation:{}});
      const local=await symbols();check(names(local).includes("q")&&names(local).includes("local_v")&&!names(local).includes("ledger")&&!names(local).includes("private_fn"),"syntax-granted actual Monaco outline keeps local declarations and excludes physical references; details="+JSON.stringify({names:names(local),calls,before,frames,state}));
      check(calls.symbols===before.symbols,"held outline does not call the metadata-bearing standard symbols RPC");
      const raw=await client.getDocumentSymbols(uri);check(raw.some(value=>value.name==="ledger")&&raw.some(value=>value.detail?.includes("secret_arg")),"physical catalog remains present on the server, so absence is not caused by clearing it");
      const folds=await command.executeCommand<any[]>("_executeFoldingRangeProvider",model.uri);check(folds.length>0,"actual folding command works with physical availability false");
      const point=model.getPositionAt(model.getValue().indexOf("q.id")+3),selected=await command.executeCommand<any[][]>("_executeSelectionRangeProvider",model.uri,[point]);
      check(selected.length===1&&selected[0]!.length>0,"actual selection command works under the syntax-only document grant");
      check(calls.folding===before.folding&&calls.selection===before.selection,"held folding and selection use only the scoped structure RPC");
    });
    await step("document-structure-explicit-dialects-and-real-format-actions",async()=>{
      for(const dialect of ["postgres","mysql","sqlite","sqlserver","hive","clickhouse"]){
        const request={uri,version:versions.current.get(uri)!,dialect};
        const local=await client.getDocumentStructure({...request,kind:"symbols"});check(Boolean(local?.items.some(value=>value.name==="q"))&&!local?.items.some(value=>value.name==="ledger"),"schema-free symbols preserve the current CTE for explicit "+dialect);
        const point=model.getPositionAt(model.getValue().indexOf("q.id")+3),selected=await client.getDocumentStructure({...request,kind:"selection",positions:[{line:point.lineNumber-1,character:point.column-1}]});check(selected?.items.length===1,"explicit profile selection returns its bound range for "+dialect);
      }
      editor.focus();await editor.getAction("editor.action.formatDocument")!.run();check(model.getValue()!==source&&model.getValue().includes("漢😀"),"actual document format action works under a syntax-only grant and preserves Unicode");
      model.setValue(source);const at=source.lastIndexOf("select private_fn"),start=model.getPositionAt(at),end=model.getPositionAt(source.length);editor.setSelection(new monaco.Range(start.lineNumber,start.column,end.lineNumber,end.column));
      await editor.getAction("editor.action.formatSelection")!.run();check(model.getValue()!==source&&model.getValue().slice(0,at)===source.slice(0,at),"actual range format action only replaces its selected SQL under the syntax-only grant");
      const local=await symbols();check(names(local).includes("q")&&!names(local).includes("ledger"),"formatted document remains synchronized for a schema-free outline");
    });
    await step("document-structure-late-nonempty-result-cannot-cross-source-withdrawal",async()=>{
      held=undefined;hold=true;emit({generation:{}});const pending=symbols();await wait(()=>Boolean(release),"actual scoped symbols response is held before renderer publication");
      check(held?.items.some((value:any)=>value.name==="q"),"held response contains a real local symbol rather than an empty control");
      emit({syntaxAllowed:false,generation:{}});release!();const stale=await pending;check(stale.length===0,"late scoped response cannot publish after its document grant is withdrawn");
      emit({syntaxAllowed:true,generation:{}});const current=await symbols();check(names(current).includes("q")&&!names(current).includes("ledger"),"restored document grant obtains a fresh local outline without old physical metadata");
    });
    return {productionCoreProviders:true,realMonacoCommands:true,realHostLsp:true,warmPhysicalPositiveControl:true,schemaFreeSymbols:true,physicalCatalogRetained:true,syntaxOnlyAvailability:true,scopedFolding:true,scopedSelection:true,explicitProfiles:6,realDocumentAndRangeFormat:true,lateNonemptyRejected:true,frames};
  }finally{release?.();registration?.dispose();await lease?.release();if(client.isInitialized())await client.shutdown();editor.setModel(previous);model.dispose();}
}
