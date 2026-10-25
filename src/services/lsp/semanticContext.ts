import type {ConnectionConfig, ConnectionRuntimeState} from "@/features/connections/model/types";
import type {LspSyncTab} from "./syncPlan";

const connectionTokens=new WeakMap<ConnectionConfig,object>();
export function semanticConnectionToken(connection:ConnectionConfig|undefined):object|undefined {
  if (!connection) return;
  let token=connectionTokens.get(connection);
  if (!token){token={};connectionTokens.set(connection,token);}
  return token;
}

export function semanticTabRoute(tab: Pick<LspSyncTab,"connectionId"|"databaseName"|"targetSchema"|"schemaName"> | undefined) {
  return JSON.stringify([tab?.connectionId||null,tab?.databaseName||null,tab?.targetSchema||null,tab?.schemaName||null]);
}

/** Renderer-only provenance. No SQL, credentials, URLs or serialized runtime ids. */
export type LspSemanticContextIdentity = {
  lspRuntime?:object;
  execution?: import("./connectionSemanticState").ConnectionSemanticObservation;
  connection: object | undefined;
  runtime: ConnectionRuntimeState | undefined;
  metadataVersion: number;
  projectId: string;
  currentSchema: string | null;
  routes: Readonly<Record<string,string>>;
};
export type LspSemanticContext = {identity: LspSemanticContextIdentity; sourcesReady: boolean; metadataReady: boolean;analysisToken?:string};

export type CompletionContextState = {
  lspRuntime?:unknown;
  syntaxAllowed?:boolean;
  analysisToken?:string;
  execution?: unknown;
  connection: unknown;
  runtime: unknown;
  metadataVersion: number;
  projectId: string;
  route: string;
  generation: unknown;
  available: boolean;
  lspAllowed: boolean;
  metadataAllowed: boolean;
};
export type CompletionContextSnapshot = {
  isCurrent: () => boolean;
  lspAllowed: boolean;
  metadataAllowed: boolean;
};
export function sameCompletionContext(a: CompletionContextState,b: CompletionContextState) {
  return a.connection===b.connection && a.runtime===b.runtime && a.lspRuntime===b.lspRuntime && a.execution===b.execution && a.analysisToken===b.analysisToken && a.metadataVersion===b.metadataVersion &&
    a.projectId===b.projectId && a.route===b.route && a.generation===b.generation &&
    a.available===b.available && a.syntaxAllowed===b.syntaxAllowed && a.lspAllowed===b.lspAllowed && a.metadataAllowed===b.metadataAllowed;
}
export function captureCompletionContext(read?: () => CompletionContextState): CompletionContextSnapshot {
  if (!read) return {isCurrent:()=>true,lspAllowed:true,metadataAllowed:true};
  const initial=read();
  return {lspAllowed:initial.available&&initial.lspAllowed,metadataAllowed:initial.available&&initial.metadataAllowed,
    isCurrent:()=>initial.available&&sameCompletionContext(initial,read())};
}

const suggestionContext=Symbol("oxideCompletionContext");
export function bindCompletionContext<T extends object>(suggestion:T,context:CompletionContextSnapshot):T {
  return Object.assign(suggestion,{[suggestionContext]:context});
}
export function completionContextForSuggestion(suggestion:object):CompletionContextSnapshot|undefined {
  return (suggestion as {[suggestionContext]?:CompletionContextSnapshot})[suggestionContext];
}
