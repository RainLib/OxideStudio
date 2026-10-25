import {useEffect,useRef} from "react";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import {subscribeCompletionContext} from "../model/completionContextState";
import {attachCompletionContextRefresh} from "../model/completionContextRefresh";

export function useCompletionContextRefresh(options:{
  editor:any;enabled:boolean;read:(()=>CompletionContextState)|undefined;
  invalidate:()=>void;triggerOriginRef:React.RefObject<"explicit"|"chained"|null>;
  subscribe?:(listener:()=>void)=>()=>void;
  allowDocumentOnly?:boolean;
}) {
  const runtime=useRef(options);runtime.current=options;
  useEffect(()=>{
    if(!options.enabled||!options.editor||!options.read)return;
    const initialRead=options.read;
    return attachCompletionContextRefresh({editor:options.editor,
      read:()=> (runtime.current.read||initialRead)(),subscribe:options.subscribe??subscribeCompletionContext,
      allowDocumentOnly:options.allowDocumentOnly,
      invalidate:()=>runtime.current.invalidate(),
      markChained:()=>{runtime.current.triggerOriginRef.current="chained";},
      clearChained:()=>{if(runtime.current.triggerOriginRef.current==="chained")runtime.current.triggerOriginRef.current=null;},
    }).dispose;
  },[options.enabled,options.editor,Boolean(options.read),options.subscribe,options.allowDocumentOnly]);
}
