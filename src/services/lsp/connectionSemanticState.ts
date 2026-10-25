import {create} from "zustand";
import type {ConnectionSemanticState} from "@/services/tauri/semantic-context.service";

export interface ConnectionSemanticObservation {
  status:"loading"|"ready"|"error";
  state:ConnectionSemanticState|null;
  localOperations:number;
}
export const isSemanticObservationIdle=(value:ConnectionSemanticObservation|undefined)=>Boolean(
  value?.status==="ready"&&value.localOperations===0&&value.state?.connected&&
  value.state.activeOperations===0&&value.state.openTransactions===0&&!value.state.uncertain,
);
export const sameConnectionSemanticState=(a:ConnectionSemanticState,b:ConnectionSemanticState)=>
  a.connectionId===b.connectionId&&a.session===b.session&&a.revision===b.revision&&
  a.activeOperations===b.activeOperations&&a.openTransactions===b.openTransactions&&
  a.connected===b.connected&&a.uncertain===b.uncertain;

interface SemanticStore {
  enabled:boolean; transport:"loading"|"ready"|"error"; owner:object|null;
  byConnectionId:Record<string,ConnectionSemanticObservation>;
  claim:(owner:object)=>void;
  listening:(owner:object)=>void;
  stop:(owner:object)=>void;
  beginRead:(owner:object,id:string)=>ConnectionSemanticObservation|undefined;
  accept:(owner:object,value:ConnectionSemanticState,source?:"event"|"snapshot")=>void;
  readFailure:(owner:object,id:string,expected:ConnectionSemanticObservation,status:"ready"|"error")=>void;
  beginLocal:(id:string)=>()=>void;
}

export function createConnectionSemanticStore(){
  const local=new Map<string,Set<object>>();
  return create<SemanticStore>((set,get)=>{
    const update=(id:string,value:ConnectionSemanticObservation)=>set(state=>{
      const byConnectionId={...state.byConnectionId,[id]:value};
      const closed=Object.entries(byConnectionId).filter(([,entry])=>entry.state?.connected===false&&entry.localOperations===0)
        .sort((a,b)=>(a[1].state?.revision||0)-(b[1].state?.revision||0));
      for(const [key] of closed.slice(0,Math.max(0,closed.length-128)))delete byConnectionId[key];
      return {byConnectionId};
    });
    const owned=(owner:object)=>get().owner===owner;
    return {
      enabled:false,transport:"loading",owner:null,byConnectionId:{},
      claim:owner=>set(state=>({enabled:true,owner,transport:"loading",byConnectionId:Object.fromEntries(
        Object.entries(state.byConnectionId).map(([id,value])=>[id,{...value,status:"loading" as const}]))})),
      listening:owner=>{if(owned(owner))set({transport:"ready"});},
      stop:owner=>{if(owned(owner))set(state=>({owner:null,transport:"error",byConnectionId:Object.fromEntries(
        Object.entries(state.byConnectionId).map(([id,value])=>[id,{...value,status:"error" as const}]))}));},
      beginRead:(owner,id)=>{
        if(!owned(owner))return;
        const previous=get().byConnectionId[id];
        if(previous?.status==="ready")return previous;
        const value:ConnectionSemanticObservation={status:"loading",state:previous?.state||null,localOperations:local.get(id)?.size||0};
        update(id,value);return value;
      },
      accept:(owner,value,source="event")=>{
        if(!owned(owner))return;
        const current=get().byConnectionId[value.connectionId],previous=current?.state;
        if(previous&&previous.revision>value.revision)return;
        if(previous&&previous.revision===value.revision){
          const same=sameConnectionSemanticState(previous,value);
          if(same&&current.status==="ready")return;
          if(source==="event"&&!same){update(value.connectionId,{...current,status:"error"});return;}
          if(source==="event"&&current.status==="error")return;
        }
        update(value.connectionId,{status:"ready",state:value,localOperations:local.get(value.connectionId)?.size||0});
      },
      readFailure:(owner,id,expected,status)=>{
        if(owned(owner)&&get().byConnectionId[id]===expected)update(id,{...expected,status,state:status==="ready"?null:expected.state});
      },
      beginLocal:id=>{
        if(!get().enabled)return ()=>{};
        const token={};const pending=local.get(id)||new Set<object>();pending.add(token);local.set(id,pending);
        const current=get().byConnectionId[id]||{status:"loading" as const,state:null,localOperations:0};
        update(id,{...current,localOperations:pending.size});
        let finished=false;
        return ()=>{
          if(finished)return;finished=true;pending.delete(token);if(!pending.size)local.delete(id);
          const latest=get().byConnectionId[id];if(latest)update(id,{...latest,localOperations:pending.size});
        };
      },
    };
  });
}
export const useConnectionSemanticStore=createConnectionSemanticStore();
