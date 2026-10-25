import {useEffect,useRef} from "react";
import {createConnectionSemanticObserver} from "@/services/lsp/connectionSemanticObserver";
import {useConnectionSemanticStore} from "@/services/lsp/connectionSemanticState";

export function useConnectionSemanticEvents(connectionId:string|null,runtime:unknown){
  const observer=useRef<ReturnType<typeof createConnectionSemanticObserver>|null>(null);
  useEffect(()=>{
    // Web-only previews have no native event authority. Desktop attaches the
    // observer even before its first connection is selected.
    if(typeof window==="undefined"||!("__TAURI_INTERNALS__" in window))return;
    const current=createConnectionSemanticObserver();observer.current=current;
    return ()=>{current.dispose();if(observer.current===current)observer.current=null;};
  },[]);
  useEffect(()=>{if(connectionId)void observer.current?.hydrate(connectionId);},[connectionId,runtime]);
  return useConnectionSemanticStore(state=>connectionId?state.byConnectionId[connectionId]:undefined);
}
