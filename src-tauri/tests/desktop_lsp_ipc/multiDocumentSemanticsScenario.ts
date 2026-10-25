// Monaco internal commands are exercised only by this native acceptance host.
// @ts-expect-error Monaco does not publish declarations for its internal services.
import {StandaloneServices} from "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js";
// @ts-expect-error Monaco does not publish declarations for its internal services.
import {ICommandService} from "monaco-editor/esm/vs/platform/commands/common/commands.js";
import "monaco-editor/esm/vs/editor/contrib/semanticTokens/common/getSemanticTokens.js";
import "monaco-editor/esm/vs/editor/contrib/parameterHints/browser/provideSignatureHelp.js";
import "monaco-editor/esm/vs/editor/contrib/rename/browser/rename.js";
import "monaco-editor/esm/vs/editor/contrib/documentSymbols/browser/documentSymbols.js";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js";
import "monaco-editor/esm/vs/editor/contrib/smartSelect/browser/smartSelect.js";
import {LspClient} from "@/services/lsp/client/LspClient";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import {registerLspCoreProviders} from "@/features/query-editor/hooks/useLspCoreProviderCoordinator";

type Environment={monaco:typeof import("monaco-editor/esm/vs/editor/editor.api.js");binaryPath:string;
  check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};
type Method="getSemanticTokens"|"getSignatureHelp"|"prepareRename"|"rename"|"getDocumentSymbols"|"getFoldingRanges"|"getSelectionRanges";

export async function runMultiDocumentSemanticsAcceptance(environment:Environment){
  const {monaco,binaryPath,step}=environment,check:Environment["check"]=environment.check;
  const command=StandaloneServices.get(ICommandService) as {executeCommand<T=any>(id:string,...args:unknown[]):Promise<T>};
  const language="oxide-core-routing-native";monaco.languages.register({id:language});
  const names=["first","second"],uris=names.map(name=>"oxide-core://"+name+"/shared/query.sql");
  const sources=names.map(name=>"/* "+name+" 漢😀 */\nWITH "+name+"_cte AS (\n SELECT a."+name+"_id\n FROM "+name+"_table AS a\n)\nSELECT fn_"+name+"(q."+name+"_id) FROM "+name+"_cte AS q;");
  const models=sources.map((source,index)=>monaco.editor.createModel(source,language,monaco.Uri.parse(uris[index]!)));
  const unowned=monaco.editor.createModel(sources[0]!,language,monaco.Uri.parse("oxide-core://unowned/shared/query.sql"));
  const clients=names.map(name=>new LspClient("core-routing-"+name)),schemaIds=names.map(()=>crypto.randomUUID());
  const states:CompletionContextState[]=uris.map(uri=>({connection:{},runtime:{},execution:{},metadataVersion:0,projectId:"native-core-routing",route:uri,generation:{},available:true,lspAllowed:true,metadataAllowed:true,analysisToken:crypto.randomUUID()}));
  const listeners=names.map(()=>new Set<()=>void>()),registrations:Array<{dispose:()=>void}>=[];
  const methods:Method[]=["getSemanticTokens","getSignatureHelp","prepareRename","rename","getDocumentSymbols","getFoldingRanges","getSelectionRanges"];
  const calls=names.map(()=>Object.fromEntries(methods.map(method=>[method,0])) as Record<Method,number>);
  for(let index=0;index<clients.length;index++)for(const method of methods){const client=clients[index]!,original=client[method];
    (client as any)[method]=(...args:any[])=>{calls[index]![method]++;return (original as any).apply(client,args);};}
  const configuration=(index:number,token:string,changed=false)=>{const name=names[index]!;return {oxideAnalysisToken:token,defaultDialect:"postgres",fileSchemas:{[uris[index]!]:schemaIds[index]},fileDialects:{[uris[index]!]:"postgres"},schemas:[{
    id:schemaIds[index],database:"app",driver:"postgres",source_uri:null,
    tables:[{name:name+"_table",object_type:"table",comment:null,source_location:null,indexes:[],constraints:[],columns:[{name:changed?"changed_id":name+"_id",data_type:"bigint",nullable:false,primary_key:false,unique:false,indexed:false,comment:null,source_location:null}]}],
    functions:[{name:"fn_"+name,routine_type:"function",return_type:"bigint",description:null,parameters:[{name:name+"_argument",data_type:"bigint",optional:false,mode:"IN"}]}],
  }]};};
  const decode=(value:any)=>{
    const bytes=value?.buffer instanceof Uint8Array?value.buffer:value;
    check(bytes instanceof Uint8Array,"actual Monaco semantic command returns its encoded token buffer");
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    check(view.getUint32(4,true)===1,"semantic command returns full token data");const length=view.getUint32(8,true);
    check(bytes.byteLength===(length+3)*4&&length%5===0,"Monaco token DTO length is coherent");
    return Array.from({length},(_,index)=>view.getUint32((index+3)*4,true));
  };
  const semantic=(index:number)=>command.executeCommand("_provideDocumentSemanticTokens",models[index]!.uri).then(decode);
  const invokeOwned=async<T>(index:number,method:Method,action:()=>Promise<T>)=>{
    const before=calls.map(value=>value[method]),result=await action();
    check(calls[index]![method]>before[index]!,"real Monaco command reaches the owning "+method+" RPC");
    check(calls[1-index]![method]===before[1-index],"real Monaco command does not invoke the other document's "+method+" RPC");return result;
  };
  const emit=(index:number,patch:Partial<CompletionContextState>)=>{states[index]={...states[index]!,...patch};for(const listener of listeners[index]!)listener();};
  const tokenCounts:number[]=[];
  const samples:Array<{index:number;tokens:number;signature:string;renameEdits:number;symbols:number;folds:number;selectionRanges:number}>=[];
  try{
    for(let index=0;index<clients.length;index++){
      const client=clients[index]!,uri=uris[index]!,model=models[index]!,token=states[index]!.analysisToken!;
      await client.initialize(binaryPath);await client.updateConfiguration(configuration(index,token));check(await client.confirmAnalysisConfiguration(token),"each core session confirms its own metadata configuration");
      await client.didOpen(uri,model.getValue(),model.getVersionId(),"postgres");
      let version=model.getVersionId();registrations.push(registerLspCoreProviders({canUseLsp:true,documentUri:uri,editorLanguageId:language,serverDialect:"postgres",lspClient:client,monaco,
        getSemanticContext:()=>states[index]!,subscribeSemanticContext:notify=>{listeners[index]!.add(notify);return ()=>listeners[index]!.delete(notify);},
        syncDocument:async current=>{if(current.getVersionId()===version)return;await client.didChange(uri,current.getValue(),current.getVersionId());version=current.getVersionId();}}));
    }
    await step("same-language-semantic-tokens-through-monaco-command",async()=>{
      check(models[0]!.uri.fsPath===models[1]!.uri.fsPath,"core models share a path while authorities differ");
      for(let index=0;index<models.length;index++){
        const expected=(await clients[index]!.getSemanticTokens(uris[index]!))!.data;check(expected.length>0,"actual LSP supplies nonempty semantic tokens for each model");
        const result=await invokeOwned(index,"getSemanticTokens",()=>semantic(index));
        check(JSON.stringify(result)===JSON.stringify(expected),"Monaco semantic command preserves the owning token data for model "+index);tokenCounts[index]=result.length/5;
      }
      check(await command.executeCommand("_provideDocumentSemanticTokens",unowned.uri)===undefined,"unowned same-language model cannot borrow another document's semantic tokens");
    });
    await step("same-language-signature-rename-symbol-fold-selection-commands",async()=>{
      for(let index=0;index<models.length;index++){
        const model=models[index]!,name=names[index]!,uri=model.uri;
        const point=model.getPositionAt(model.getValue().indexOf("fn_"+name+"(")+("fn_"+name+"(").length+2);
        const help=await invokeOwned(index,"getSignatureHelp",()=>command.executeCommand("_executeSignatureHelpProvider",uri,point));
        check(help?.signatures?.[0]?.label.includes(name+"_argument"),"signature command resolves the owning function metadata");
        check(!JSON.stringify(help).includes(names[1-index]+"_argument"),"signature result excludes the sibling function signature");
        const renamePoint=model.getPositionAt(model.getValue().lastIndexOf(name+"_cte")+2);
        const prepared=await invokeOwned(index,"prepareRename",()=>command.executeCommand("_executePrepareRename",uri,renamePoint));
        check(prepared.text===name+"_cte","prepare rename selects the owning CTE under the UTF-16 caret");
        const renamed=await invokeOwned(index,"rename",()=>command.executeCommand("_executeDocumentRenameProvider",uri,renamePoint,"renamed_"+name));
        check(renamed.edits.length===2&&renamed.edits.every((item:any)=>item.resource.toString()===uris[index]&&item.textEdit.text==="renamed_"+name),"rename plan contains exactly the owning CTE declaration and reference");
        const symbols=await invokeOwned(index,"getDocumentSymbols",()=>command.executeCommand<any[]>("_executeDocumentSymbolProvider",uri));
        check(symbols.some(item=>item.name===name+"_cte")&&!symbols.some(item=>item.name===names[1-index]+"_cte"),"symbol command merges only the owning document symbols");
        const folds=await invokeOwned(index,"getFoldingRanges",()=>command.executeCommand<any[]>("_executeFoldingRangeProvider",uri));
        check(folds.some(item=>item.end>item.start),"folding command uses the actual multiline CTE provider");
        const selections=await invokeOwned(index,"getSelectionRanges",()=>command.executeCommand<any[][]>("_executeSelectionRangeProvider",uri,[renamePoint]));
        check(selections[0]!.length>1&&selections[0]!.every(range=>range.containsPosition(renamePoint)),"selection command merges nested ranges containing the real caret");
        samples.push({index,tokens:tokenCounts[index]!,signature:help.signatures[0].label,renameEdits:renamed.edits.length,symbols:symbols.length,folds:folds.length,selectionRanges:selections[0]!.length});
      }
    });
    await step("semantic-token-context-clear-and-metadata-refresh-without-sql-edit",async()=>{
      const model=models[0]!,text=model.getValue(),version=model.getVersionId(),before=await clients[0]!.getSemanticTokens(uris[0]!);
      emit(0,{generation:{},lspAllowed:false,metadataAllowed:false});const beforeCalls=calls[0]!.getSemanticTokens;
      check((await semantic(0)).length===0,"owning invalid metadata context explicitly clears old semantic tokens");
      check(calls[0]!.getSemanticTokens===beforeCalls,"invalid context does not dispatch physical token inference");
      const token=crypto.randomUUID();await clients[0]!.updateConfiguration(configuration(0,token,true));check(await clients[0]!.confirmAnalysisConfiguration(token),"replacement metadata is committed before token access resumes");
      emit(0,{generation:{},metadataVersion:1,lspAllowed:true,metadataAllowed:true,analysisToken:token});
      const expected=(await clients[0]!.getSemanticTokens(uris[0]!))!.data,result=await semantic(0);
      check(JSON.stringify(expected)!==JSON.stringify(before!.data),"real metadata replacement changes tokens with unchanged SQL");
      check(JSON.stringify(result)===JSON.stringify(expected),"Monaco refresh uses new owning metadata and clears its old token cache");
      check(model.getValue()===text&&model.getVersionId()===version,"semantic context replacement preserves SQL and its model version");
      registrations[1]!.dispose();check(JSON.stringify(await semantic(0))===JSON.stringify(expected),"sibling provider disposal preserves the remaining model's semantic tokens");
    });
  }finally{
    for(const registration of registrations)registration.dispose();for(const model of models)model.dispose();unowned.dispose();
    for(let index=0;index<clients.length;index++){const client=clients[index]!;if(client.isInitialized()){await client.didClose(uris[index]!);await client.shutdown();}}
  }
  return {productionCoreProviders:true,realMonacoCommands:true,realHostLsp:true,exactUriTokens:true,signature:true,renamePlan:true,symbols:true,folding:true,selection:true,contextClear:true,unchangedSqlMetadataRefresh:true,siblingDisposal:true,samples};
}
