import type {ConnectionConfig} from "@/features/connections/model/types";
import {semanticConnectionToken, semanticTabRoute, type CompletionContextState} from "@/services/lsp/semanticContext";
import {useConnectionStore} from "@/store/useConnectionStore";
import {useSchemaStore} from "@/store/useSchemaStore";
import {useTabStore} from "@/store/useTabStore";
import {useProjectStore} from "@/store/useProjectStore";
import {useLspSemanticStatusStore} from "@/store/useLspSemanticStatusStore";
import {useConnectionSemanticStore,isSemanticObservationIdle} from "@/services/lsp/connectionSemanticState";
import type {LspClient} from "@/services/lsp/client/LspClient";

/** Read authoritative stores on both sides of async work, including before
 * React has committed a render for a same-id replacement connection. */
export function createCompletionContextReader(options:{
  connectionId:string|null; tabId?:string; connection:ConnectionConfig|undefined;
  lspClient:Pick<LspClient,"getRuntimeSnapshot">;
  metadataVersion:number; projectId:string; currentSchema:string|null; route:string;
}):()=>CompletionContextState {
  let connections=useConnectionStore.getState().connections;
  let connection=connections.find(c=>c.id===options.connectionId);
  let tabs=useTabStore.getState().tabs;
  let tab=tabs.find(t=>t.id===options.tabId);
  const documentIdentity={};
  return ()=>{
    const connectionState=useConnectionStore.getState(),schema=useSchemaStore.getState();
    if (connectionState.connections!==connections){connections=connectionState.connections;connection=connections.find(c=>c.id===options.connectionId);}
    const nextTabs=useTabStore.getState().tabs;
    if(nextTabs!==tabs){tabs=nextTabs;tab=tabs.find(t=>t.id===options.tabId);}
    const projectId=useProjectStore.getState().activeProjectId;
    const route=semanticTabRoute(tab);
    const effectiveConnectionId=tab?.connectionId||connectionState.activeConnectionId||null;
    const sourceCurrent=projectId===options.projectId&&route===options.route&&effectiveConnectionId===options.connectionId&&(!options.tabId||tab?.id===options.tabId);
    if(!options.connectionId)return {connection:documentIdentity,runtime:undefined,execution:undefined,metadataVersion:0,projectId,route,generation:documentIdentity,
      syntaxAllowed:sourceCurrent,available:sourceCurrent,lspAllowed:false,metadataAllowed:false};
    const runtime=connectionState.connectionRuntimeStates[options.connectionId];
    const process=options.lspClient.getRuntimeSnapshot();
    const status=useLspSemanticStatusStore.getState().byConnectionId[options.connectionId];
    const identity=status?.context?.identity;
    const authority=useConnectionSemanticStore.getState(),execution=authority.byConnectionId[options.connectionId];
    const executionReady=!authority.enabled||authority.transport==="ready"&&isSemanticObservationIdle(execution);
    const connectionToken=semanticConnectionToken(connection);
    const matching=Boolean(identity&&process.ready&&identity.lspRuntime===process.generation&&identity.connection===connectionToken&&identity.runtime===runtime&&identity.execution===execution&&
      identity.metadataVersion===schema.metadataVersion&&identity.projectId===projectId&&
      identity.currentSchema===schema.currentSchema&&(!options.tabId||identity.routes[options.tabId]===route));
    const confirmed=matching&&typeof status?.context?.analysisToken==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(status.context.analysisToken);
    const available=sourceCurrent&&Boolean(connection)&&(!authority.enabled||execution?.state?.connected!==false)&&(!runtime||runtime.status==="connected")&&connection===options.connection&&
      schema.metadataVersion===options.metadataVersion&&projectId===options.projectId&&
      schema.currentSchema===options.currentSchema&&route===options.route;
    return {connection:connectionToken,runtime,lspRuntime:process.generation,execution,metadataVersion:schema.metadataVersion,projectId,route,generation:identity,
      syntaxAllowed:sourceCurrent&&connection===options.connection,
      analysisToken:confirmed?status?.context?.analysisToken:undefined,
      available,lspAllowed:available&&executionReady&&confirmed&&status?.context?.sourcesReady===true,
      metadataAllowed:available&&executionReady&&confirmed&&status?.context?.metadataReady===true};
  };
}

export function subscribeCompletionContext(listener:()=>void,client?:Pick<LspClient,"subscribeRuntime">):()=>void {
  const releases=[useConnectionStore.subscribe(listener),useSchemaStore.subscribe(listener),
    useTabStore.subscribe(listener),useProjectStore.subscribe(listener),useLspSemanticStatusStore.subscribe(listener),useConnectionSemanticStore.subscribe(listener)];
  if(client)releases.push(client.subscribeRuntime(listener));
  return ()=>{for(const release of releases)release();};
}
