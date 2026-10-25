/** Renderer-only process incarnation. A descriptor/client can survive a
 * restart; a configuration acknowledgement cannot. */
export function createLspRuntimeObservation(){
  let snapshot={ready:false,generation:{}};
  const listeners=new Set<()=>void>();
  return {getSnapshot:()=>snapshot,subscribe:(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};},
    setReady:(ready:boolean,force=false)=>{if(snapshot.ready===ready&&!force)return;snapshot={ready,generation:{}};for(const listener of listeners)listener();}};
}
