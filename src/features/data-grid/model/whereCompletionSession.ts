import {acquireLspDocument,type LspDocumentLease} from "@/services/lsp/documentOwnership";
import type {LspClient} from "@/services/lsp/client/LspClient";
import type {DocumentCompletionRequest} from "@/services/lsp/client/documentCompletions";
import type {LspCancellationToken} from "@/services/lsp/client/contracts";
import {captureLspDocumentRequest,watchLspProviderContext} from "@/features/query-editor/model/lspProviderContext";
import type {CompletionContextState} from "@/services/lsp/semanticContext";
import type {WhereColumnSource,WhereColumn} from "./whereColumnSource";
import {wherePhysicalTargetRelation} from "./wherePhysicalTarget";
import {buildWhereCompletionDocument,localWhereCompletionCandidates,searchWhereCompletionCandidates,mergeWhereCompletionCandidates,whereCompletionContext,whereReplacementRange,type WhereCompletionCandidate} from "@/lib/whereCompletion";
import {filterWhereRemoteCompletions} from "./whereRemoteCompletion";
import {constrainLocalWhereCompletions} from "./whereCompletionConstraints";
import type {CompletionKeywordConstraints,CompletionValueRole} from "@/services/lsp/types";
import type {DatabaseCapabilities,DatabaseDriver} from "@/services/tauri/types";

export function whereCompletionDocumentUri(source:string,owner:string,dialect:string) {
  return `oxide://where/${encodeURIComponent(owner)}.${encodeURIComponent(dialect)}.sql?source=${encodeURIComponent(source)}`;
}
export type WhereCompletionInteraction={condition:string;cursorOffset:number;manual:boolean};
type Client=Pick<LspClient,"didOpen"|"didChange"|"didClose"|"getRuntimeSnapshot"|"getCompletions"|"getDocumentCompletions">&Partial<Pick<LspClient,"getCompletionSnapshot">>;

/** One input owns one independent wire buffer and one cancellable interaction. */
export function createWhereCompletionSession(options:{
  client:Client;sessionKey:string;uri:string;driver:DatabaseDriver;capabilities:DatabaseCapabilities;
  schema?:string|null;table:string;dialect:string;preferences:DocumentCompletionRequest["preferences"];
  read:()=>CompletionContextState;subscribe:(listener:()=>void)=>()=>void;
  columns:WhereColumnSource;isCurrent:(interaction:WhereCompletionInteraction)=>boolean;
  publish:(candidates:WhereCompletionCandidate[])=>void;
}) {
  let disposed=false,sequence=0,lease:LspDocumentLease|undefined;
  let pending:WhereCompletionInteraction|undefined,cancelToken=()=>{};
  let generation=options.client.getRuntimeSnapshot().generation;
  const guards=new WeakMap<WhereCompletionCandidate,()=>boolean>();
  let published=new Set<string>();
  const cancel=(clear=true)=>{sequence++;published.clear();cancelToken();cancelToken=()=>{};if(clear)pending=undefined;};
  const publish=(items:WhereCompletionCandidate[],guard:()=>boolean)=>{
    if(!guard())return;
    const visible=items.slice(0,80),fallback=pending?whereReplacementRange(pending.condition,pending.cursorOffset):{start:0,end:0};
    const key=(item:WhereCompletionCandidate)=>JSON.stringify([item.insertText,Boolean(item.snippet),item.cursorOffsetFromEnd??null,item.replacementRange?.start??fallback.start,item.replacementRange?.end??fallback.end]);
    published=new Set(visible.map(key));
    for(const item of visible){const itemKey=key(item);guards.set(item,()=>guard()&&published.has(itemKey));}
    options.publish(visible);
  };
  async function request(interaction:WhereCompletionInteraction) {
    if(disposed||!options.isCurrent(interaction))return;
    cancel(false);pending=interaction;const revision=sequence;
    const active=()=>!disposed&&sequence===revision&&options.isCurrent(interaction);
    const context=captureLspDocumentRequest({read:options.read,model:{getVersionId:()=>sequence},isActive:active});
    const current=()=>context.isCurrent();
    if(!current()){options.publish([]);return;}
    const document=buildWhereCompletionDocument({condition:interaction.condition,cursorOffset:interaction.cursorOffset,driver:options.driver,identifierQuote:options.capabilities.identifierQuote,schema:options.schema,table:options.table});
    const physical=context.metadataAllowed&&wherePhysicalTargetRelation(document,{schema:options.schema,table:options.table});
    const qualifiers=physical?(physical.alias?[physical.alias]:[physical.table,[physical.schema,physical.table].filter(Boolean).join(".")]):[];
    let valueType:string|undefined;
    let valueRole:CompletionValueRole|undefined;
    let logicalContinuation:boolean|undefined;
    let patternEscape:boolean|undefined;
    const candidateOptions=(columns:WhereColumn[])=>({condition:interaction.condition,cursorOffset:interaction.cursorOffset,driver:options.driver,dialect:options.dialect,identifierQuote:options.capabilities.identifierQuote,columns,qualifiers,valueType,valueRole,logicalContinuation,patternEscape});
    const candidates=(columns:WhereColumn[])=>localWhereCompletionCandidates(candidateOptions(columns));
    const initialColumns=physical?options.columns.peek():[];
    let currentColumns=initialColumns;
    let local=candidates(initialColumns),syntax=whereCompletionContext(candidateOptions(initialColumns));
    let remote:Awaited<ReturnType<Client["getCompletions"]>>=[];
    let constraints:CompletionKeywordConstraints|undefined;
    const editSource={document,condition:interaction.condition};
    const merged=()=>mergeWhereCompletionCandidates(constrainLocalWhereCompletions(local,syntax,options.dialect,constraints),filterWhereRemoteCompletions(remote,syntax,options.dialect,constraints,logicalContinuation),editSource);
    publish(local,current);
    const metadata=physical?options.columns.load().then(async columns=>{
      if(!current())return;
      const searchedValueType=valueType;
      const searchedValueRole=valueRole;
      const searchedLogical=logicalContinuation;
      const searchedPatternEscape=patternEscape;
      const items=await searchWhereCompletionCandidates(candidateOptions(columns),{get isCancellationRequested(){return !current();}});
      if(current()){currentColumns=columns;local=searchedValueType===valueType&&searchedValueRole===valueRole&&searchedLogical===logicalContinuation&&searchedPatternEscape===patternEscape?items:candidates(columns);syntax=whereCompletionContext(candidateOptions(columns));publish(merged(),current);}
    }).catch(error=>{if(current())console.debug("[WhereCompletion] Metadata unavailable",error);}):Promise.resolve();
    if(!options.client.getRuntimeSnapshot().ready){await metadata;return;}
    const listeners=new Set<()=>void>();
    const cancellation:LspCancellationToken={isCancellationRequested:false,onCancellationRequested:listener=>{listeners.add(listener);return {dispose:()=>listeners.delete(listener)};}};
    cancelToken=()=>{cancellation.isCancellationRequested=true;for(const listener of listeners)listener();listeners.clear();};
    try {
      const nextGeneration=options.client.getRuntimeSnapshot().generation;
      if(nextGeneration!==generation){const old=lease;lease=undefined;generation=nextGeneration;await old?.release();if(!current())return;}
      lease??=acquireLspDocument({client:options.client,sessionKey:options.sessionKey,uri:options.uri,priority:1});
      const shadow=await lease.synchronize(document.text,options.dialect);
      if(!current()||shadow.text!==document.text)return;
      const position={line:document.line,character:document.character},analysisToken=options.read().analysisToken;
      const needsSemanticSnapshot=["value","operator","continuation"].includes(syntax.phase)||["is","is-not"].includes(syntax.phase)&&!["sqlite","sqlite3"].includes(options.dialect);
      const result=context.lspAllowed
        ?options.client.getCompletionSnapshot&&analysisToken&&needsSemanticSnapshot
          ?await options.client.getCompletionSnapshot({uri:options.uri,version:shadow.version,dialect:options.dialect,position,analysisToken,context:{triggerKind:interaction.manual?1:3}},cancellation)
          :{items:await options.client.getCompletions(options.uri,document.line,document.character,{triggerKind:interaction.manual?1:3},cancellation),constraints:undefined,valueType:undefined,valueRole:undefined,logicalContinuation:undefined,patternEscape:undefined}
        :await options.client.getDocumentCompletions({uri:options.uri,version:shadow.version,dialect:options.dialect,position,preferences:options.preferences},cancellation);
      // Preserve the converted edits when metadata finishes after the LSP.
      if(current()){
        remote=result?.items??[];constraints=result?.constraints;valueType=result?.valueType;valueRole=result?.valueRole;logicalContinuation=result?.logicalContinuation;patternEscape=result?.patternEscape;
        if(valueType!==undefined||logicalContinuation!==undefined||patternEscape!==undefined){local=candidates(currentColumns);syntax=whereCompletionContext(candidateOptions(currentColumns));}
        publish(merged(),current);
      }
    } catch(error) {
      if(current())console.debug("[WhereCompletion] LSP completion unavailable",error);
    }
    await metadata;
  }
  const release=watchLspProviderContext({getSemanticContext:options.read,subscribeSemanticContext:options.subscribe},()=>{
    const interaction=pending;cancel(false);options.publish([]);
    if(interaction&&options.isCurrent(interaction))void request(interaction);
  });
  return {request,cancel:()=>cancel(),isCandidateCurrent:(candidate:WhereCompletionCandidate)=>guards.get(candidate)?.()===true,
    dispose:async()=>{if(disposed)return;disposed=true;cancel();release();await lease?.release();}};
}
