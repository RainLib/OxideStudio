import {sameCompletionContext,type CompletionContextState} from "@/services/lsp/semanticContext";
import {watchLspProviderContext,type LspProviderContextOptions} from "./lspProviderContext";

/** Pure document work remains available without physical metadata. Results
 * still belong to the exact source generation that started the request. */
export function captureInlineProviderRequest(options:{
  read?:()=>CompletionContextState;model:any;token?:{isCancellationRequested?:boolean};isActive:()=>boolean;
}){
  const initial=options.read?.(),version=options.model.getVersionId();
  const allowed=initial?Boolean(initial.syntaxAllowed??initial.available):true;
  return {allowed,metadataAllowed:initial?initial.available&&initial.lspAllowed&&initial.metadataAllowed:true,
    isCurrent:()=>allowed&&options.isActive()&&!options.token?.isCancellationRequested&&!options.model.isDisposed?.()&&
      options.model.getVersionId()===version&&(!initial||Boolean(options.read&&sameCompletionContext(initial,options.read())))};
}

/** Invalidate synchronously, including before React commits a new render. */
export function watchInlineProviderContext(options:LspProviderContextOptions&{
  invalidate:()=>void;editor?:{trigger:(source:string,command:string,args:object)=>void};
}){
  return watchLspProviderContext(options,()=>{
    options.invalidate();
    options.editor?.trigger("oxide.inlineContext","editor.action.inlineSuggest.hide",{});
  });
}
