import {captureCompletionContext,sameCompletionContext,type CompletionContextState} from "@/services/lsp/semanticContext";

export interface LspProviderContextOptions {
  getSemanticContext?:()=>CompletionContextState;
  subscribeSemanticContext?:(listener:()=>void)=>()=>void;
}

/** Bind asynchronous provider results to both the document and the source
 * generation. An unchanged Monaco version alone does not identify metadata. */
export function captureLspProviderRequest(options:{
  read?:()=>CompletionContextState;model:any;
  token?:{isCancellationRequested?:boolean};isActive?:()=>boolean;
}){
  const {model,token}=options,version=model.getVersionId?.();
  const context=captureCompletionContext(options.read);
  return {lspAllowed:context.lspAllowed,metadataAllowed:context.metadataAllowed,
    isCurrent:()=>!token?.isCancellationRequested&&!model.isDisposed?.()&&
      (version===undefined||model.getVersionId?.()===version)&&
      (options.isActive?.()??true)&&context.isCurrent()};
}

/** Document structure has a syntax grant even while physical availability is
 * held. Its RPC must independently avoid catalog and configuration reads. */
export function captureLspDocumentRequest(options:{read?:()=>CompletionContextState;model:any;token?:{isCancellationRequested?:boolean};isActive:()=>boolean}){
  const initial=options.read?.(),version=options.model.getVersionId?.();
  const allowed=()=>!initial||Boolean(initial.syntaxAllowed??initial.available);
  // Server sources may already be committed while the renderer cache is
  // incomplete. Keep those independent grants; do not hide proven server data.
  return {lspAllowed:initial?initial.available&&initial.lspAllowed:true,metadataAllowed:initial?initial.available&&initial.metadataAllowed:true,
    isCurrent:()=>allowed()&&!options.token?.isCancellationRequested&&!options.model.isDisposed?.()&&options.isActive()&&
      (version===undefined||options.model.getVersionId?.()===version)&&(!initial||sameCompletionContext(initial,options.read!()))};
}

/** Ignore unrelated store updates; invalidate synchronously before notifying
 * renderer consumers, including when React has not rendered the new state. */
export function watchLspProviderContext(options:LspProviderContextOptions,changed:()=>void){
  const {getSemanticContext:read,subscribeSemanticContext:subscribe}=options;
  if(!read||!subscribe)return ()=>{};
  let previous=read();
  return subscribe(()=>{const next=read();if(sameCompletionContext(previous,next))return;previous=next;changed();});
}
