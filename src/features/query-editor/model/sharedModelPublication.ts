/** One model/layer can have several independent, disposable publishers. */
type Candidate = {value:unknown;order:number};
type Observer={group:object;key:string;notify:(value:unknown|undefined)=>void};
type Owner = {candidate?:Candidate;preferred:()=>boolean;accepts:(value:unknown)=>boolean;render:(value:unknown|undefined)=>void;observer?:Observer};
type Slot = {owners:Set<Owner>;sequence:number;latest?:Candidate;rendered?:{owner:Owner;candidate:Candidate|undefined};observed:Map<Owner,Candidate|undefined>};
const scopes=new WeakMap<object,WeakMap<object,Map<string,Slot>>>();
const safely=(check:()=>boolean)=>{try{return check();}catch(error){console.error("[LSP] Shared publication guard failed",error);return false;}};
function select(slot:Slot,owner:Owner){
  let selected=slot.latest&&safely(()=>owner.accepts(slot.latest!.value))?slot.latest:undefined;
  for(const peer of slot.owners){const value=peer.candidate;if(value&&(!selected||value.order>selected.order)&&safely(()=>owner.accepts(value.value)))selected=value;}
  return selected;
}
function refresh(slot:Slot,force=false){
  let leader:Owner|undefined,preferred=false;
  for(const owner of slot.owners){const next=safely(owner.preferred);if(!leader||next||!preferred){leader=owner;preferred=next;}}
  if(!leader)return;
  const selected=select(slot,leader);
  if(force||slot.rendered?.owner!==leader||slot.rendered.candidate!==selected){
    try{leader.render(selected?.value);slot.rendered={owner:leader,candidate:selected};}
    catch(error){console.error("[LSP] Shared publication renderer failed",error);}
  }
  // Problems belongs to a tab; several panes may use that same sink, while
  // different tabs sharing a model still need their own valid diagnostics.
  const groups=new Map<object,Map<string,Owner>>();
  for(const owner of slot.owners)if(owner.observer){const {group,key}=owner.observer;let sinks=groups.get(group);if(!sinks)groups.set(group,sinks=new Map());const previous=sinks.get(key);
    if(!previous||safely(owner.preferred)||!safely(previous.preferred))sinks.set(key,owner);
  }
  const previous=slot.observed,next=new Map<Owner,Candidate|undefined>();
  for(const sinks of groups.values())for(const owner of sinks.values())next.set(owner,select(slot,owner));
  slot.observed=next;
  for(const [owner,candidate]of next){
    if(previous.has(owner)&&previous.get(owner)===candidate)continue;
    if(!slot.observed.has(owner)||slot.observed.get(owner)!==candidate)continue;
    try{owner.observer!.notify(candidate?.value);}catch(error){slot.observed.delete(owner);console.error("[LSP] Shared publication observer failed",error);}
  }
}
export function acquireSharedModelPublication<T>(options:{
  scope:object;model:object;layer:string;render:(value:T|undefined)=>void;
  accepts?:(value:T)=>boolean;isPreferred?:()=>boolean;
  observer?:{group:object;key:string;notify:(value:T|undefined)=>void};
}){
  let models=scopes.get(options.scope);if(!models)scopes.set(options.scope,models=new WeakMap());
  let layers=models.get(options.model);if(!layers)models.set(options.model,layers=new Map());
  let slot=layers.get(options.layer);if(!slot)layers.set(options.layer,slot={owners:new Set(),sequence:0,observed:new Map()});
  const shared=slot,owner:Owner={render:value=>options.render(value as T|undefined),accepts:value=>options.accepts?.(value as T)??true,preferred:options.isPreferred??(()=>false),
    observer:options.observer?{...options.observer,notify:value=>options.observer!.notify(value as T|undefined)}:undefined};
  shared.owners.add(owner);let disposed=false;refresh(shared);
  return {
    publish(value:T){if(disposed)return;owner.candidate={value,order:++shared.sequence};shared.latest=owner.candidate;refresh(shared);},
    clear(){if(disposed)return;if(shared.latest===owner.candidate)shared.latest=undefined;owner.candidate=undefined;refresh(shared);},
    refresh(){if(!disposed)refresh(shared);},
    dispose(){
      if(disposed)return;disposed=true;shared.owners.delete(owner);owner.candidate=undefined;
      if(owner.observer&&![...shared.owners].some(peer=>peer.observer?.group===owner.observer!.group&&peer.observer?.key===owner.observer!.key)){
        try{owner.observer.notify(undefined);}catch(error){console.error("[LSP] Shared publication observer cleanup failed",error);}
      }
      // The latest compatible result (including an empty diagnostics list)
      // remains useful to a surviving owner. Its own live guard decides
      // validity; retiring a pane must not resurrect an older error list.
      if(shared.owners.size)refresh(shared);
      else{layers!.delete(options.layer);shared.observed.clear();try{owner.render(undefined);}catch(error){console.error("[LSP] Shared publication cleanup failed",error);}}
    },
  };
}
/** Lifecycle cleanup must respect a remaining diagnostic publisher's grant. */
export function refreshSharedModelPublication(scope:object,model:object,layer:string){
  const slot=scopes.get(scope)?.get(model)?.get(layer);if(!slot?.owners.size)return false;
  refresh(slot,true);return true;
}
