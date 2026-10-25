import type {Diagnostic,PublishDiagnosticsParams} from "@/services/lsp/types";
import {sameCompletionContext,type CompletionContextState} from "@/services/lsp/semanticContext";
import type {DiagnosticSnapshot} from "@/services/lsp/client/diagnostics";

type Model={getValue:()=>string;getVersionId:()=>number;isDisposed?:()=>boolean};
const validToken=(value:unknown):value is string=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const validPosition=(value:any)=>value&&Number.isSafeInteger(value.line)&&value.line>=0&&Number.isSafeInteger(value.character)&&value.character>=0;
const validDiagnostic=(value:any):value is Diagnostic=>value&&typeof value.message==="string"&&
  validPosition(value.range?.start)&&validPosition(value.range?.end);

/** A pushed notification is never stamped with today's authority on arrival.
 * Keep at most four opaque configuration candidates for this one document;
 * apply only after configuration and shadow-document acknowledgements match. */
export function createDiagnosticPublication<M extends Model>(options:{
  uri:string;dialect?:string;read:()=>CompletionContextState;model:()=>M|null;
  shadow:()=>{version:number|undefined;text:string|undefined};
  publish:(model:M,diagnostics:Diagnostic[])=>void;clear:()=>void;
}){
  const pending=new Map<string,PublishDiagnosticsParams>();
  let syntax:DiagnosticSnapshot|undefined;
  let disposed=false,context=options.read();
  let rendered:{model:M;version:number;publication:PublishDiagnosticsParams|DiagnosticSnapshot}|undefined;
  const syntaxAllowed=(current:CompletionContextState)=>current.syntaxAllowed??current.available;
  const selected=()=>{
    const current=options.read(),model=options.model(),shadow=options.shadow();
    const ready=Boolean(model&&!model.isDisposed?.()&&shadow.version!==undefined&&shadow.text===model.getValue());
    const full=current.available&&current.lspAllowed&&current.metadataAllowed&&validToken(current.analysisToken);
    const metadata=current.analysisToken?pending.get(current.analysisToken):undefined;
    const validMetadata=ready&&full&&metadata?.version===shadow.version?metadata:undefined;
    const validSyntax=ready&&syntaxAllowed(current)&&syntax?.version===shadow.version&&syntax?.dialect===options.dialect?syntax:undefined;
    const mode=ready&&full&&!validMetadata?"metadata":ready&&syntaxAllowed(current)&&options.dialect&&!validMetadata&&!validSyntax?"syntax":undefined;
    return {current,model,publication:validMetadata||validSyntax,mode};
  };
  const withdraw=()=>{if(rendered){rendered=undefined;options.clear();}};
  const flush=()=>{
    if(disposed)return;
    const {current,model,publication}=selected();
    if(!sameCompletionContext(context,current)){context=current;withdraw();}
    if(rendered&&(!model||model!==rendered.model||model.getVersionId()!==rendered.version))withdraw();
    if(!publication||!model){
      withdraw();return;
    }
    if(rendered?.publication===publication&&rendered.model===model&&rendered.version===model.getVersionId())return;
    options.publish(model,publication.diagnostics);
    rendered={model,version:model.getVersionId(),publication};
  };
  const accept=(publication:PublishDiagnosticsParams)=>{
      if(disposed||publication.uri!==options.uri||!validToken(publication.oxideAnalysisToken)||
        !Number.isSafeInteger(publication.version)||publication.version! < 0||
        !Array.isArray(publication.diagnostics)||!publication.diagnostics.every(validDiagnostic))return;
      const previous=pending.get(publication.oxideAnalysisToken);
      if(previous?.version!==undefined&&previous.version>publication.version!)return;
      pending.delete(publication.oxideAnalysisToken);pending.set(publication.oxideAnalysisToken,publication);
      while(pending.size>4)pending.delete(pending.keys().next().value!);
      flush();
    };
  return {
    accept,
    acceptSnapshot:(value:DiagnosticSnapshot)=>{
      if(value.uri!==options.uri||options.dialect&&value.dialect!==options.dialect)return;
      if(value.mode==="metadata"){accept(value);return;}
      if(disposed||value.mode!=="syntax"||value.dialect!==options.dialect||value.oxideAnalysisToken!==undefined||
        !Number.isSafeInteger(value.version)||value.version<0||!Array.isArray(value.diagnostics)||!value.diagnostics.every(validDiagnostic))return;
      if(syntax&&syntax.version>value.version)return;
      syntax=value;flush();
    },
    get snapshotMode(){return selected().mode as "syntax"|"metadata"|undefined;},
    refresh:flush,
    get pendingCount(){return pending.size;},
    dispose:()=>{if(disposed)return;disposed=true;pending.clear();syntax=undefined;withdraw();},
  };
}
