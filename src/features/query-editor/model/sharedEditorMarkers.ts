import type * as Monaco from "monaco-editor";
import {acquireSharedModelPublication} from "./sharedModelPublication";

/** Local syntax/query-error layers share the same model, but not each other's
 * cleanup. Reject old model revisions even before deferred tab props update. */
export function createSharedEditorMarkers(options:{
  monaco:typeof import("monaco-editor");model:Monaco.editor.ITextModel;editor:any;layer:string;contextKey?:unknown;
}){
  const {model,editor,monaco}=options;
  let disposed=false;
  const publication=acquireSharedModelPublication<{markers:Monaco.editor.IMarkerData[];version:number;contextKey:unknown}>({scope:monaco.editor,model,layer:options.layer,
    accepts:value=>!model.isDisposed()&&editor.getModel()===model&&model.getVersionId()===value.version&&value.contextKey===options.contextKey,
    isPreferred:()=>Boolean(editor?.hasTextFocus?.()),render:value=>{if(!model.isDisposed())monaco.editor.setModelMarkers(model,options.layer,value?.markers??[]);},
  });
  const refresh=()=>publication.refresh();
  const listeners=[editor?.onDidChangeModelContent?.(refresh),editor?.onDidChangeModel?.(refresh),editor?.onDidFocusEditorText?.(refresh),editor?.onDidBlurEditorText?.(refresh)];
  return {
    publish(markers:Monaco.editor.IMarkerData[]){
      if(disposed)return;const version=model.getVersionId();
      publication.publish({markers,version,contextKey:options.contextKey});
    },
    dispose(){if(disposed)return;disposed=true;for(const listener of listeners)listener?.dispose();publication.dispose();},
  };
}
