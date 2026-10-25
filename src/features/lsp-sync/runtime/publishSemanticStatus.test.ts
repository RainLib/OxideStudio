import {expect,it,vi} from "vitest";
import type {LspSemanticContextIdentity} from "@/services/lsp/semanticContext";
import {publishSemanticStatus} from "./publishSemanticStatus";
function fixture(){
  const identity={connection:{},runtime:undefined,metadataVersion:1,projectId:"project",currentSchema:"app",routes:{}} as LspSemanticContextIdentity;
  const provenance:{current:{identity:LspSemanticContextIdentity;token:string}|null}={current:{identity,token:"old"}},sources:{current:LspSemanticContextIdentity|null}={current:identity},metadata:{current:LspSemanticContextIdentity|null}={current:identity},publish=vi.fn();
  const send=(state:Parameters<typeof publishSemanticStatus>[0]["status"]["state"],context=identity)=>{publishSemanticStatus({connectionId:"connection",identity:context,status:{state,totalObjects:1,cacheHits:0,cacheMisses:1,failedObjects:0},provenance,sources,metadata,publish});return publish.mock.lastCall?.[1];};
  return {identity,provenance,sources,metadata,publish,send};
}
it("revokes a previous successful receipt when the same context later fails",()=>{const f=fixture();const status=f.send("error");expect(status.context.analysisToken).toBeUndefined();expect(status.context.sourcesReady).toBe(false);expect(status.context.metadataReady).toBe(false);expect(f.provenance.current).toBeNull();expect(f.sources.current).toBeNull();expect(f.metadata.current).toBeNull();});
it.each(["full","cached","limited"] as const)("cannot restore physical authority from a %s status without another receipt",state=>{const f=fixture();f.send("error");const status=f.send(state);expect(status.state).toBe("syncing");expect(status.context.sourcesReady).toBe(false);expect(status.context.analysisToken).toBeUndefined();});
it("restores authority only with a newly confirmed publication",()=>{const f=fixture();f.send("error");f.provenance.current={identity:f.identity,token:"repaired"};f.sources.current=f.identity;const status=f.send("full");expect(status.context).toMatchObject({analysisToken:"repaired",sourcesReady:true,metadataReady:true});});
it("keeps independently confirmed server sources while renderer metadata is incomplete",()=>{const f=fixture();f.metadata.current=null;const status=f.send("syncing");expect(status.context).toMatchObject({analysisToken:"old",sourcesReady:true,metadataReady:false});});
it("does not mutate receipt references belonging to another context",()=>{const f=fixture();f.send("error",{...f.identity});expect(f.provenance.current?.token).toBe("old");expect(f.sources.current).toBe(f.identity);expect(f.metadata.current).toBe(f.identity);});
