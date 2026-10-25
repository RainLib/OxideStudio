import type * as Monaco from "monaco-editor";
import type {Diagnostic} from "@/services/lsp/types";
import {sameCompletionContext,type CompletionContextState} from "@/services/lsp/semanticContext";
import {lspDiagnosticToMonacoMarker} from "./lspMonacoAdapter";
import {acquireSharedModelPublication} from "./sharedModelPublication";

type Payload={diagnostics:Diagnostic[];context:CompletionContextState;session:string;dialect?:string;modelVersion:number;version:number|undefined;text:string|undefined};
export function createSharedDiagnosticMarkers(options:{
  monaco:typeof import("monaco-editor");model:()=>Monaco.editor.ITextModel|null;
  read:()=>CompletionContextState;shadow:()=>{version:number|undefined;text:string|undefined};
  session:string;dialect?:string;editor:any;tabId?:string;setDiagnostics:(id:string,values:Diagnostic[])=>void;
}){
  let model:Monaco.editor.ITextModel|null=null,publication:ReturnType<typeof acquireSharedModelPublication<Payload>>|undefined,disposed=false;
  const attach=()=>{
    const next=options.model();if(next===model)return publication;
    publication?.dispose();model=next;publication=undefined;
    if(!next||next.isDisposed())return;
    publication=acquireSharedModelPublication<Payload>({scope:options.monaco.editor,model:next,layer:"sql-lsp",isPreferred:()=>Boolean(options.editor?.hasTextFocus?.()),
      accepts:value=>{const shadow=options.shadow();return !next.isDisposed()&&options.model()===next&&value.modelVersion===next.getVersionId()&&value.session===options.session&&value.dialect===options.dialect&&sameCompletionContext(value.context,options.read())&&value.version!==undefined&&value.version===shadow.version&&value.text===shadow.text&&value.text===next.getValue();},
      render:value=>{
        if(next.isDisposed()||options.model()!==next)return;
        const diagnostics=value?.diagnostics??[];
        options.monaco.editor.setModelMarkers(next,"sql-lsp",diagnostics.map(item=>lspDiagnosticToMonacoMarker(options.monaco,item)));
      },
      observer:options.tabId?{group:options.setDiagnostics,key:options.tabId,notify:value=>{if(!next.isDisposed()&&options.model()===next)options.setDiagnostics(options.tabId!,value?.diagnostics??[]);}}:undefined,
    });return publication;
  };
  attach();
  return {
    publish(current:Monaco.editor.ITextModel,diagnostics:Diagnostic[]){
      if(disposed||options.model()!==current)return;const target=attach();if(!target)return;
      const payload:Payload={diagnostics,context:options.read(),session:options.session,dialect:options.dialect,modelVersion:current.getVersionId(),...options.shadow()};
      target.publish(payload);
    },
    clear(){if(!disposed)attach()?.clear();},
    refresh(){if(!disposed)attach()?.refresh();},
    dispose(){if(disposed)return;disposed=true;publication?.dispose();publication=undefined;model=null;},
  };
}
