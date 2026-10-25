import type {PublishDiagnosticsParams} from "@/services/lsp/types";
import type {DiagnosticSnapshot,DiagnosticSnapshotRequest} from "@/services/lsp/client/diagnostics";

/** Subscribe before a coherent readback. Pushes normally satisfy demand;
 * recover gaps on acknowledgements, with one coalesced request in flight. */
export function createDiagnosticRecovery(options:{
  controller:{accept:(value:PublishDiagnosticsParams)=>void;acceptSnapshot:(value:DiagnosticSnapshot)=>void;
    refresh:()=>void;dispose:()=>void;readonly snapshotMode:"syntax"|"metadata"|undefined};
  listen:(accept:(value:PublishDiagnosticsParams)=>void)=>Promise<()=>void>;
  request:(request:DiagnosticSnapshotRequest)=>Promise<DiagnosticSnapshot|null>;
  capture:(mode:"syntax"|"metadata")=>{request:DiagnosticSnapshotRequest;isCurrent:()=>boolean}|undefined;
  debounceMs?:number;
}){
  let disposed=false,attached=false,inFlight=false,dirty=false,retries=0;
  let unlisten:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined,retryTimer:ReturnType<typeof setTimeout>|undefined;
  const retryDelays=[250,1000,4000];
  const schedule=()=>{
    if(disposed||!attached)return;
    const mode=options.controller.snapshotMode;
    if(inFlight){dirty=Boolean(mode);return;}
    if(timer!==undefined){clearTimeout(timer);timer=undefined;}
    if(!mode)return;
    timer=setTimeout(()=>{timer=undefined;void pull();},options.debounceMs??120);
  };
  const pull=async()=>{
    const mode=options.controller.snapshotMode;if(disposed||!mode)return;
    const captured=options.capture(mode);if(!captured||!captured.isCurrent())return;
    inFlight=true;dirty=false;
    try{const result=await options.request(captured.request);if(!disposed&&result&&captured.isCurrent())options.controller.acceptSnapshot(result);}
    catch{/* A failed or obsolete read cannot grant diagnostic authority. */}
    finally{inFlight=false;if(!disposed&&(dirty||options.controller.snapshotMode&&options.controller.snapshotMode!==mode))schedule();}
  };
  const refresh=()=>{if(disposed)return;options.controller.refresh();schedule();};
  const attach=()=>{
    void Promise.resolve().then(()=>options.listen(value=>{if(!disposed){options.controller.accept(value);refresh();}})).then(release=>{
      if(disposed){release();return;}unlisten=release;attached=true;refresh();
    },()=>{
      if(disposed)return;attached=true;refresh();
      if(retries<retryDelays.length)retryTimer=setTimeout(()=>{retryTimer=undefined;attach();},retryDelays[retries++]);
    });
  };
  attach();
  return {refresh,dispose:()=>{if(disposed)return;disposed=true;if(timer!==undefined)clearTimeout(timer);if(retryTimer!==undefined)clearTimeout(retryTimer);unlisten?.();options.controller.dispose();}};
}
