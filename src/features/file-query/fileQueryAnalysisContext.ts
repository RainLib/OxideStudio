import type {TabData} from "@/features/workspace-tabs/model/types";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import {dispatchLspConfiguration,type LspConfigurationPayload} from "@/services/lsp/configDispatch";

type RuntimeSnapshot={ready:boolean;generation:object};
/** Own one file snapshot/configuration receipt, never a generic session-key
 * grant. Read live stores before React so close/reopen/schema changes revoke
 * pending work and visible consumers synchronously. */
export function createFileQueryAnalysisContext(options:{
  document:TabData["fileQuery"];uri:string;runtime:RuntimeSnapshot;runtimeReady:boolean;dialect:string;config:LspConfigurationPayload;
  readTab:()=>TabData|undefined;readProject:()=>string;readRuntime:()=>RuntimeSnapshot;
  preferencesCurrent:()=>boolean;subscribeLive:(listener:()=>void)=>()=>void;
  updateConfiguration:(config:LspConfigurationPayload)=>Promise<void>;
  confirmConfiguration:(token:string)=>Promise<boolean>;
}){
  const expected=options.document,session=expected?.session,identity={};
  let disposed=false,started=false,generation=0,grant:{token:string;identity:object}|undefined,error:string|null=null;
  let release:(()=>void)|undefined,previousAvailable=false;
  let view={ready:false,error:null as string|null};
  const listeners=new Set<()=>void>();
  const available=()=>{
    const live=options.readTab()?.fileQuery,process=options.readRuntime();
    return Boolean(!disposed&&session&&expected&&live&&options.runtimeReady&&process===options.runtime&&process.ready&&
      options.readProject()===session.projectId&&options.preferencesCurrent()&&live.session===session&&live.schema===expected.schema&&live.source===expected.source&&
      live.driverId===expected.driverId&&live.packageVersion===expected.packageVersion&&live.csvHeader===expected.csvHeader&&
      live.source.projectId===session.projectId&&live.driverId===session.driverId&&live.packageVersion===session.packageVersion&&live.csvHeader===session.csvHeader);
  };
  const emit=()=>{const next={ready:available()&&Boolean(grant),error};if(next.ready!==view.ready||next.error!==view.error)view=next;for(const listener of listeners)listener();};
  const configure=async()=>{
    if(!available()||!session)return;
    const request=++generation;grant=undefined;error=null;emit();
    try{
      const result=await dispatchLspConfiguration({connectionId:session.id,driver:session.driverId,lspDialect:options.dialect,
        config:options.config,lastConfigKey:null,syncGeneration:request,getCurrentGeneration:()=>generation,
        isCancelled:()=>!available(),updateConfiguration:options.updateConfiguration,confirmConfiguration:options.confirmConfiguration});
      if(disposed||request!==generation||!available())return;
      if(result.status==="sent"&&result.analysisToken)grant={token:result.analysisToken,identity:{}};
    }catch(reason){if(!disposed&&request===generation&&available())error=reason instanceof Error?reason.message:String(reason);}
    if(!disposed&&request===generation)emit();
  };
  const refresh=()=>{
    const next=available();if(next===previousAvailable)return;previousAvailable=next;
    generation++;grant=undefined;error=null;emit();if(next)void configure();
  };
  const read=():CompletionContextState=>{
    const allowed=available(),ready=allowed&&Boolean(grant);
    return {connection:identity,runtime:options.readRuntime().generation,execution:generation,metadataVersion:0,
      projectId:session?.projectId??"",route:options.uri,generation:grant?.identity,
      syntaxAllowed:allowed,available:allowed,lspAllowed:ready,metadataAllowed:ready,analysisToken:ready?grant?.token:undefined};
  };
  return {read,getSnapshot:()=>view,subscribe:(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};},
    isReady:()=>available()&&Boolean(grant),
    start:()=>{if(started&&!disposed)return;disposed=false;started=true;release=options.subscribeLive(refresh);previousAvailable=available();if(previousAvailable)void configure();else emit();},
    dispose:()=>{if(disposed)return;disposed=true;started=false;generation++;grant=undefined;release?.();emit();listeners.clear();}};
}
