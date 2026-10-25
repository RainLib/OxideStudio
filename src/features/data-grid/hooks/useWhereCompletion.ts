import {useCallback,useEffect,useMemo,useRef} from "react";
import {useConnectionStore} from "@/store/useConnectionStore";
import {useSchemaStore} from "@/store/useSchemaStore";
import {useTabStore} from "@/store/useTabStore";
import {useProjectStore} from "@/store/useProjectStore";
import {useSettingsStore} from "@/store/useSettingsStore";
import {createCompletionContextReader,subscribeCompletionContext} from "@/features/query-editor/model/completionContextState";
import {semanticTabRoute} from "@/services/lsp/semanticContext";
import {getLspDocumentUri} from "@/services/lsp/document";
import {lspLanguageIdForCapabilities,lspServerDialectForCapabilities} from "@/lib/databaseDialect";
import {createWhereCompletionSession,whereCompletionDocumentUri,type WhereCompletionInteraction} from "../model/whereCompletionSession";
import type {LspClient} from "@/services/lsp/client/LspClient";
import type {DatabaseCapabilities,DatabaseDriver} from "@/services/tauri/types";
import type {WhereCompletionCandidate} from "@/lib/whereCompletion";
import {createWhereColumnSource} from "../model/whereColumnSource";
import {getColumns} from "@/services/tauri/schema/catalog";
import {getDatabaseColumns} from "@/services/tauri/schema/relations";

export function useWhereCompletion(options:{
 client:LspClient;sessionKey:string;connectionId?:string|null;tabId?:string|null;driver?:DatabaseDriver|null;
 capabilities:DatabaseCapabilities|null;owner:string;schema?:string|null;table?:string|null;database?:string|null;
 isCurrent:(interaction:WhereCompletionInteraction)=>boolean;publish:(items:WhereCompletionCandidate[])=>void;
}){
 const {client,connectionId,tabId,driver,capabilities,owner,schema,table,isCurrent,publish}=options;
 const connection=useConnectionStore(state=>state.connections.find(value=>value.id===connectionId));
 const metadataVersion=useSchemaStore(state=>state.metadataVersion),currentSchema=useSchemaStore(state=>state.currentSchema);
 const projectId=useProjectStore(state=>state.activeProjectId),tab=useTabStore(state=>state.tabs.find(value=>value.id===tabId));
 const preferences=useSettingsStore(state=>state.settings.editor.sqlCompletion);
 const route=semanticTabRoute(tab);
 const read=useMemo(()=>{
   const base=createCompletionContextReader({connectionId:connectionId||null,tabId:tabId||undefined,connection,lspClient:client,metadataVersion,currentSchema,projectId,route});
   return ()=>{
     const state=base(),current=useTabStore.getState().tabs.find(value=>value.id===tabId);
     const targetCurrent=current?.type!=="table"||current.tableName===table;
     return {...state,route:JSON.stringify([state.route,table]),available:state.available&&targetCurrent,
       syntaxAllowed:state.syntaxAllowed&&targetCurrent,lspAllowed:state.lspAllowed&&targetCurrent,metadataAllowed:state.metadataAllowed&&targetCurrent};
   };
 },[connectionId,tabId,connection,client,metadataVersion,currentSchema,projectId,route,table]);
 const interaction=useRef<WhereCompletionInteraction|undefined>(undefined);
 const database=options.database||tab?.databaseName||undefined;
 const namespace=schema||currentSchema||database;
 const columns=useMemo(()=>createWhereColumnSource({read,scope:JSON.stringify([projectId,connectionId,database]),load:async()=>{
   if(!connectionId||!namespace||!table)return [];
   return database?getDatabaseColumns(connectionId,database,namespace,table):getColumns(connectionId,namespace,table);
 }}),[read,projectId,connectionId,database,namespace,table]);
 const configuration=useMemo(()=>{
   if(!driver||!capabilities?.supportsSqlQuery||!tabId||!table)return;
   const dialect=lspServerDialectForCapabilities(capabilities);
   const source=getLspDocumentUri(tabId,driver,lspLanguageIdForCapabilities(capabilities));
   return {client,sessionKey:options.sessionKey,uri:whereCompletionDocumentUri(source,owner,dialect),driver,capabilities,schema,table,dialect,
     preferences:{keywordCase:preferences.keywordCase,functionCase:preferences.functionCase,tableAlias:preferences.tableAlias},read,
     subscribe:(listener:()=>void)=>subscribeCompletionContext(listener,client),columns,isCurrent,publish};
 },[driver,capabilities,tabId,table,client,options.sessionKey,owner,schema,preferences,read,columns,isCurrent,publish]);
 const session=useRef<ReturnType<typeof createWhereCompletionSession>|undefined>(undefined);
 useEffect(()=>{
   const current=configuration?createWhereCompletionSession(configuration):undefined;session.current=current;
   publish([]);if(interaction.current)void current?.request(interaction.current);
   return ()=>{if(session.current===current)session.current=undefined;void current?.dispose().catch(error=>console.debug("[WhereCompletion] Document close failed",error));};
 },[configuration,publish]);
 const request=useCallback((value:WhereCompletionInteraction)=>{interaction.current=value;return session.current?.request(value);},[]);
 const cancel=useCallback(()=>{interaction.current=undefined;session.current?.cancel();},[]);
 const isCandidateCurrent=useCallback((candidate:WhereCompletionCandidate)=>candidate.source==="history"||session.current?.isCandidateCurrent(candidate)===true,[]);
 return {request,cancel,isCandidateCurrent};
}
