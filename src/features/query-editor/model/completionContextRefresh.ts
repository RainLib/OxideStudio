import {captureCompletionContext,sameCompletionContext,type CompletionContextState} from "@/services/lsp/semanticContext";
import {captureLspDocumentRequest} from "./lspProviderContext";

type Position={lineNumber:number;column:number};
type Editor={
  getModel:()=>any;getPosition:()=>Position|null;hasTextFocus:()=>boolean;
  getDomNode?:()=>{querySelector:(selector:string)=>unknown}|null;
  trigger:(source:string,command:string,args:object)=>void;
  onDidBlurEditorText?:(listener:()=>void)=>{dispose:()=>void};
  onDidChangeCursorPosition?:(listener:()=>void)=>{dispose:()=>void};
  onDidChangeModelContent?:(listener:()=>void)=>{dispose:()=>void};
  onDidChangeModel?:(listener:()=>void)=>{dispose:()=>void};
  onKeyDown?:(listener:(event:{key?:string;keyCode?:number;browserEvent?:{key?:string}})=>void)=>{dispose:()=>void};
};
const incompleteInteractions=new WeakMap<Editor,Set<(model:any,position:Position)=>void>>();
/** An invoked provider may return an empty list before any widget is visible. */
export function rememberIncompleteCompletionInteraction(editor:Editor|undefined,model:any,position:Position){
  if(!editor)return;
  for(const remember of incompleteInteractions.get(editor)??[])remember(model,position);
}

/** Withdraw only this editor's visible list. Reopen its original interaction
 * after a safe source publication, never after focus/cursor/text/Escape changes. */
export function attachCompletionContextRefresh(options:{
  editor:Editor;read:()=>CompletionContextState;subscribe:(listener:()=>void)=>()=>void;
  invalidate:()=>void;markChained?:()=>void;clearChained?:()=>void;
  allowDocumentOnly?:boolean;
}) {
  const {editor,read}=options;
  let previous=read(),disposed=false;
  let pending:{model:any;version:number;position:Position}|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const cancel=()=>{pending=undefined;if(timer!==undefined){clearTimeout(timer);timer=undefined;}};
  const sameInteraction=()=>{
    const position=editor.getPosition();
    return pending&&editor.hasTextFocus()&&editor.getModel()===pending.model&&
      pending.model.getVersionId()===pending.version&&position?.lineNumber===pending.position.lineNumber&&position.column===pending.position.column;
  };
  const refresh=()=>{
    if(disposed)return;
    const next=read();if(sameCompletionContext(previous,next))return;previous=next;
    options.invalidate();
    const visible=Boolean(editor.getDomNode?.()?.querySelector(".suggest-widget.visible"));
    if(visible){
      const model=editor.getModel(),position=editor.getPosition();
      pending=model&&position&&editor.hasTextFocus()?{model,version:model.getVersionId(),position:{...position}}:undefined;
      editor.trigger("oxide.completionContext","hideSuggestWidget",{});
    }
    if(!sameInteraction()){cancel();return;}
    const physicalReady=next.available&&(next.lspAllowed||next.metadataAllowed);
    if(!physicalReady&&!(options.allowDocumentOnly&&next.syntaxAllowed))return;
    if(timer!==undefined)clearTimeout(timer);
    const context=options.allowDocumentOnly?captureLspDocumentRequest({read,model:pending!.model,isActive:()=>Boolean(sameInteraction())}):captureCompletionContext(read);
    timer=setTimeout(()=>{
      timer=undefined;if(disposed||!sameInteraction()||!context.isCurrent())return;
      // An empty result can keep Monaco's suggest model active before its
      // widget becomes visible. Cancel that cached session before retriggering.
      if(options.allowDocumentOnly)editor.trigger("oxide.completionContext","hideSuggestWidget",{});
      if(!sameInteraction()||!context.isCurrent())return;
      // An empty local result can close Monaco's widget. Retain the original
      // interaction until physical sources recover; user actions still cancel.
      if(physicalReady&&(!options.allowDocumentOnly||next.metadataAllowed))pending=undefined;options.markChained?.();
      editor.trigger("oxide.completionContext","editor.action.triggerSuggest",{});
      timer=setTimeout(()=>{timer=undefined;options.clearChained?.();},0);
    },0);
  };
  const unsubscribe=options.subscribe(refresh);
  const remember=(model:any,position:Position)=>{
    const state=read();
    if(disposed||state.metadataAllowed||!(state.syntaxAllowed??state.available)||!editor.hasTextFocus()||editor.getModel()!==model)return;
    pending={model,version:model.getVersionId(),position:{...position}};
  };
  if(options.allowDocumentOnly){const listeners=incompleteInteractions.get(editor)??new Set();listeners.add(remember);incompleteInteractions.set(editor,listeners);}
  const disposables=[editor.onDidBlurEditorText?.(cancel),editor.onDidChangeCursorPosition?.(cancel),
    editor.onDidChangeModelContent?.(cancel),editor.onDidChangeModel?.(cancel),
    editor.onKeyDown?.(event=>{if(event.key==="Escape"||event.browserEvent?.key==="Escape"||event.keyCode===9)cancel();})];
  return {dispose:()=>{disposed=true;cancel();unsubscribe();const listeners=incompleteInteractions.get(editor);listeners?.delete(remember);if(!listeners?.size)incompleteInteractions.delete(editor);for(const item of disposables)item?.dispose();}};
}
