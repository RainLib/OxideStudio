import {getConnectionSemanticState,listenConnectionSemanticState,type ConnectionSemanticState} from "@/services/tauri/semantic-context.service";
import {useConnectionSemanticStore,isSemanticObservationIdle,sameConnectionSemanticState,type ConnectionSemanticObservation} from "./connectionSemanticState";

type Store=typeof useConnectionSemanticStore;
type Ports={get:(id:string)=>Promise<ConnectionSemanticState|null>;listen:(listener:(value:ConnectionSemanticState)=>void)=>Promise<()=>void>};
const ports:Ports={get:getConnectionSemanticState,listen:listenConnectionSemanticState};

/** Attach first, then read snapshots. An old owner or old snapshot can never
 * replace a newer event, including during source switches and disposal. */
export function createConnectionSemanticObserver(store:Store=useConnectionSemanticStore,io:Ports=ports){
  const owner={};let active=true,release:(()=>void)|undefined;
  const pending=new Map<string,Promise<void>>();store.getState().claim(owner);
  const attached=io.listen(value=>{if(active)store.getState().accept(owner,value);}).then(unlisten=>{
    if(!active){unlisten();return false;}release=unlisten;store.getState().listening(owner);return true;
  },()=>{if(active)store.getState().stop(owner);return false;});
  const hydrate=(id:string):Promise<void>=>{
    const existing=pending.get(id);if(existing)return existing;
    const work=(async()=>{
      if(!await attached||!active||store.getState().owner!==owner)return;
      const expected=store.getState().beginRead(owner,id);if(!expected)return;
      try{const value=await io.get(id);if(!active)return;
        if(value&&value.connectionId===id)store.getState().accept(owner,value,"snapshot");
        else store.getState().readFailure(owner,id,expected,value===null?"ready":"error");
      }catch{if(active)store.getState().readFailure(owner,id,expected,"error");}
    })();
    pending.set(id,work);void work.then(()=>{if(pending.get(id)===work)pending.delete(id);});return work;
  };
  return {hydrate,dispose:()=>{if(!active)return;active=false;release?.();store.getState().stop(owner);}};
}

/** A publication must still describe the same idle host revision after I/O.
 * Equal readbacks retain object identity and do not restart their own sync. */
export async function verifyConnectionSemanticObservation(id:string,expected:ConnectionSemanticObservation,
  store:Store=useConnectionSemanticStore,get:Ports["get"]=ports.get):Promise<boolean>{
  const current=()=>{const state=store.getState();return state.transport==="ready"&&state.byConnectionId[id]===expected&&isSemanticObservationIdle(expected);};
  if(!current())return false;
  const owner=store.getState().owner;if(!owner)return false;
  try{
    const value=await get(id);
    if(value?.connectionId===id)store.getState().accept(owner,value,"snapshot");
    else store.getState().readFailure(owner,id,expected,value===null?"ready":"error");
    return Boolean(value&&expected.state&&sameConnectionSemanticState(expected.state,value)&&current());
  }catch{store.getState().readFailure(owner,id,expected,"error");return false;}
}
