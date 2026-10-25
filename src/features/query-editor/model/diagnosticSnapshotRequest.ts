import {sameCompletionContext,type CompletionContextState} from "@/services/lsp/semanticContext";
import type {DiagnosticSnapshotRequest} from "@/services/lsp/client/diagnostics";

export function captureDiagnosticSnapshot(options:{
  uri:string;dialect:string|undefined;mode:"syntax"|"metadata";
  read:()=>CompletionContextState;model:()=>any;
  shadow:()=>{version:number|undefined;text:string|undefined};isActive:()=>boolean;
}){
  const {mode}=options,initial=options.read(),model=options.model(),shadow=options.shadow();
  if(!options.dialect||!model||model.isDisposed?.()||shadow.version===undefined||shadow.text!==model.getValue())return;
  if(mode==="metadata"&&(!initial.available||!initial.lspAllowed||!initial.metadataAllowed||!initial.analysisToken))return;
  if(mode==="syntax"&&!(initial.syntaxAllowed??initial.available))return;
  const version=model.getVersionId();
  const request:DiagnosticSnapshotRequest={uri:options.uri,version:shadow.version,dialect:options.dialect,mode,
    ...(mode==="metadata"?{oxideAnalysisToken:initial.analysisToken}:{})};
  const isCurrent=()=>{
    const current=options.read(),latest=options.shadow();
    if(!options.isActive()||options.model()!==model||model.isDisposed?.()||model.getVersionId()!==version||latest.version!==shadow.version||latest.text!==shadow.text)return false;
    return mode==="metadata"?current.available&&sameCompletionContext(initial,current):
      Boolean((current.syntaxAllowed??current.available)&&current.connection===initial.connection&&current.projectId===initial.projectId&&current.route===initial.route);
  };
  return {request,isCurrent};
}
