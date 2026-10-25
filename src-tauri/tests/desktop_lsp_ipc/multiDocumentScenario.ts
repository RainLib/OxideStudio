import type * as Monaco from "monaco-editor";
import "monaco-editor/esm/vs/editor/contrib/format/browser/formatActions.js";
import {LspClient} from "@/services/lsp/client/LspClient";
import {registerLspCoreProviders} from "@/features/query-editor/hooks/useLspCoreProviderCoordinator";

type Environment={monaco:typeof import("monaco-editor/esm/vs/editor/editor.api.js");binaryPath:string;
  check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};

/** Real Monaco actions must select the owner before invoking its provider. */
export async function runMultiDocumentFormattingAcceptance(environment:Environment){
  const {monaco,binaryPath,step}=environment,check:Environment["check"]=environment.check;
  const language="oxide-format-routing-native";
  monaco.languages.register({id:language});
  const uris=["oxide-format://first/shared/query.sql","oxide-format://second/shared/query.sql"];
  const clients=uris.map((_,index)=>new LspClient("format-routing-"+index));
  const containers=uris.map(()=>{const node=document.createElement("div");node.style.cssText="width:480px;height:120px";document.body.appendChild(node);return node;});
  const sources=["select 'first 漢😀' as source,9007199254740993 as amount","select 'second' as source,9007199254740995 as amount"];
  const models=uris.map((uri,index)=>monaco.editor.createModel(sources[index]!,language,monaco.Uri.parse(uri)));
  const editors=models.map((model,index)=>monaco.editor.create(containers[index]!,{model,automaticLayout:false,minimap:{enabled:false}}));
  const registrations:Array<{dispose:()=>void}>=[];
  const actions:Array<{uri:string;kind:string;milliseconds:number}>=[];
  const format=async(index:number,kind:"document"|"range")=>{
    const editor=editors[index]!,model=models[index]!,before=model.getValue(),other=models[1-index]!,otherText=other.getValue(),otherVersion=other.getVersionId();
    editor.focus();if(kind==="range")editor.setSelection(model.getFullModelRange());
    const action=editor.getAction(kind==="document"?"editor.action.formatDocument":"editor.action.formatSelection");
    check(Boolean(action),"real Monaco "+kind+" format action exists");
    const start=performance.now();await action!.run();actions.push({uri:uris[index]!,kind,milliseconds:performance.now()-start});
    check(model.getValue()!==before,"real Monaco "+kind+" formatting selects URI owner "+index);
    check(other.getValue()===otherText&&other.getVersionId()===otherVersion,"formatting preserves the other editor model and version");
    check(model.getValue().includes(index===0?"first 漢😀":"second"),"formatting preserves the selected source literal");
  };
  try{
    await step("same-language-multiple-document-format-routing",async()=>{
      check(models[0]!.uri.fsPath===models[1]!.uri.fsPath,"different authorities intentionally share the same path");
      check(models[0]!.uri.toString()!==models[1]!.uri.toString(),"the two models have distinct full URIs");
      for(let index=0;index<clients.length;index++){
        const client=clients[index]!,uri=uris[index]!,model=models[index]!;
        await client.initialize(binaryPath);const token=crypto.randomUUID();
        await client.updateConfiguration({oxideAnalysisToken:token,defaultDialect:"postgres",fileDialects:{[uri]:"postgres"},schemas:[],formattingPreferences:{keywordCase:"upper",functionCase:"upper",logicalOperatorNewline:"before",fromClauseLayout:"newLine"}});
        check(await client.confirmAnalysisConfiguration(token),"each actual LSP session confirms its own configuration");
        await client.didOpen(uri,model.getValue(),model.getVersionId(),"postgres");let version=model.getVersionId();
        registrations.push(registerLspCoreProviders({canUseLsp:true,documentUri:uri,editorLanguageId:language,serverDialect:"postgres",lspClient:client,monaco,
          syncDocument:async(current:Monaco.editor.ITextModel)=>{if(version===current.getVersionId())return;await client.didChange(uri,current.getValue(),current.getVersionId());version=current.getVersionId();}}));
      }
      await format(0,"document");await format(1,"document");
      for(let index=0;index<models.length;index++)models[index]!.setValue(sources[index]!);
      await format(0,"range");await format(1,"range");
      registrations[1]!.dispose();models[0]!.setValue(sources[0]!);await format(0,"document");
      check(models[0]!.getValue().includes("9007199254740993"),"shared formatting registration preserves the large integer after sibling disposal");
    });
  }finally{
    for(const registration of registrations)registration.dispose();
    for(const editor of editors)editor.dispose();for(const model of models)model.dispose();for(const node of containers)node.remove();
    for(let index=0;index<clients.length;index++){const client=clients[index]!;if(client.isInitialized()){await client.didClose(uris[index]!);await client.shutdown();}}
  }
  return {productionCoreProviders:true,realMonacoActions:true,realHostLsp:true,fullUriAuthorityIsolation:true,documentAndRange:true,siblingDisposal:true,actions};
}
