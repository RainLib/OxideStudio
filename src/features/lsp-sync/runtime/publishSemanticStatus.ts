import type {LspSemanticContextIdentity} from "@/services/lsp/semanticContext";
import type {LspSemanticCompletionStatus} from "@/store/useLspSemanticStatusStore";
type Ref<T>={current:T};
type Status=Omit<LspSemanticCompletionStatus,"updatedAt"|"telemetry">&Partial<Pick<LspSemanticCompletionStatus,"telemetry">>;
/** A failed publication cannot keep an earlier receipt for the same identity.
 * Readiness can return only after a fresh confirmed onConfigurationPublished. */
export function publishSemanticStatus(options:{
  connectionId:string;identity:LspSemanticContextIdentity;status:Status;
  provenance:Ref<{identity:LspSemanticContextIdentity;token:string}|null>;
  sources:Ref<LspSemanticContextIdentity|null>;metadata:Ref<LspSemanticContextIdentity|null>;
  publish:(connectionId:string,status:Status)=>void;
}) {
  const {identity,status,provenance,sources,metadata}=options;
  if(status.state==="error") {
    if(provenance.current?.identity===identity)provenance.current=null;
    if(sources.current===identity)sources.current=null;
    if(metadata.current===identity)metadata.current=null;
  }
  const token=status.state!=="error"&&provenance.current?.identity===identity?provenance.current.token:undefined;
  if(token&&(status.state==="full"||status.state==="cached"))metadata.current=identity;
  options.publish(options.connectionId,{...status,state:!token&&["full","cached","limited"].includes(status.state)?"syncing":status.state,
    context:{identity,analysisToken:token,metadataReady:Boolean(token)&&metadata.current===identity,
      sourcesReady:Boolean(token)&&(sources.current===identity||["full","cached","limited"].includes(status.state))}});
}
