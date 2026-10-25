import {listen} from "@tauri-apps/api/event";
import {invokeWithInterceptors} from "./client";

export interface ConnectionSemanticState {
  connectionId:string; session:string; revision:number; activeOperations:number;
  openTransactions:number; connected:boolean; uncertain:boolean;
}
const integer=(value:unknown,max:number):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0&&value<=max;
export function parseConnectionSemanticState(value:unknown):ConnectionSemanticState {
  const state=value as Partial<ConnectionSemanticState>|null;
  if(!state||typeof state.connectionId!=="string"||!state.connectionId||state.connectionId.length>512||
    typeof state.session!=="string"||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(state.session)||
    !integer(state.revision,Number.MAX_SAFE_INTEGER)||state.revision===0||
    !integer(state.activeOperations,0xffffffff)||!integer(state.openTransactions,1024)||
    typeof state.connected!=="boolean"||typeof state.uncertain!=="boolean")throw new Error("Invalid connection semantic state");
  // Copy only the sanctioned fields, including when a future producer adds
  // properties. Neither driver output nor SQL belongs in this transport.
  return {connectionId:state.connectionId,session:state.session,revision:state.revision,
    activeOperations:state.activeOperations,openTransactions:state.openTransactions,connected:state.connected,uncertain:state.uncertain};
}
export async function getConnectionSemanticState(connectionId:string):Promise<ConnectionSemanticState|null> {
  const value=await invokeWithInterceptors<unknown>("get_connection_semantic_state",{connectionId});
  if(value===null)return null;
  const state=parseConnectionSemanticState(value);
  if(state.connectionId!==connectionId)throw new Error("Connection semantic state scope mismatch");
  return state;
}
export function listenConnectionSemanticState(listener:(state:ConnectionSemanticState)=>void) {
  return listen<unknown>("connection-semantic-state",event=>{
    let state:ConnectionSemanticState;
    try{state=parseConnectionSemanticState(event.payload);}catch{return;}
    listener(state);
  });
}
