import type {HoverInfo,Location,LspCodeAction,LspInlayHint,LspSemanticTokens,Position,Range,SignatureHelp,WorkspaceEdit} from "../types";
import type {LspClientBridge} from "./contracts";
import {isObject,normalizeMarkup} from "./parsing";
import {semanticPosition,semanticRange,validDocumentSemanticValue} from "./documentSemanticValidation";
export type DocumentSemanticInputs={
  hover:{position:Position};definitions:{position:Position};references:{position:Position;includeDeclaration:boolean};signature:{position:Position};
  prepareRename:{position:Position};rename:{position:Position;newName:string};codeActions:{range:Range;context:{diagnostics:unknown[];only?:string[]}};
  tokens:Record<never,never>;inlayHints:{range:Range};
};
export type DocumentSemanticValues={hover:HoverInfo|null;definitions:Location[];references:Location[];signature:SignatureHelp|null;prepareRename:Range|null;rename:WorkspaceEdit|null;codeActions:LspCodeAction[];tokens:LspSemanticTokens;inlayHints:LspInlayHint[]};
export type DocumentSemanticKind=keyof DocumentSemanticInputs;
export type DocumentSemanticRequest<K extends DocumentSemanticKind=DocumentSemanticKind>={uri:string;version:number;dialect:string;operation:{kind:K}&DocumentSemanticInputs[K]};
export type DocumentSemanticSnapshot<K extends DocumentSemanticKind>={uri:string;version:number;dialect:string;kind:K;value:DocumentSemanticValues[K]};
function operationPayload(operation:DocumentSemanticRequest["operation"]):Record<string,unknown>|null{
  const item=operation as Record<string,unknown>,kind=item.kind;
  if(["hover","definitions","references","signature","prepareRename","rename"].includes(String(kind))){
    if(!semanticPosition(item.position))return null;
    if(kind==="references")return typeof item.includeDeclaration==="boolean"?{kind,position:item.position,includeDeclaration:item.includeDeclaration}:null;
    if(kind==="rename")return typeof item.newName==="string"?{kind,position:item.position,newName:item.newName}:null;
    return {kind,position:item.position};
  }
  if(kind==="tokens")return {kind};
  if(kind==="inlayHints")return semanticRange(item.range)?{kind,range:item.range}:null;
  if(kind==="codeActions"&&semanticRange(item.range)&&isObject(item.context)&&Array.isArray(item.context.diagnostics)&&
    (item.context.only===undefined||Array.isArray(item.context.only)&&item.context.only.every((value:unknown)=>typeof value==="string")))return {kind,range:item.range,context:{diagnostics:item.context.diagnostics,...(item.context.only===undefined?{}:{only:item.context.only})}};
  return null;
}
export async function getLspDocumentSemantics<K extends DocumentSemanticKind>(client:LspClientBridge,request:DocumentSemanticRequest<K>):Promise<DocumentSemanticSnapshot<K>|null>{
  if(!client.isInitialized()||typeof request.uri!=="string"||!Number.isSafeInteger(request.version)||request.version<0||request.version>2147483647||!/^[a-z0-9_-]{1,64}$/.test(request.dialect)||!isObject(request.operation))return null;
  const operation=operationPayload(request.operation);if(!operation)return null;
  const response=await client.request<unknown>("oxide/documentSemantics",{textDocument:{uri:request.uri},version:request.version,dialect:request.dialect,operation});
  if(!client.isInitialized()||!isObject(response)||response.uri!==request.uri||response.version!==request.version||response.dialect!==request.dialect||typeof response.kind!=="string"||response.kind!==request.operation.kind||response.oxideAnalysisToken!==undefined||!validDocumentSemanticValue(response.kind,response.value,request.uri))return null;
  const value=response.kind==="hover"&&isObject(response.value)?{contents:normalizeMarkup(response.value.contents),...(response.value.range?{range:response.value.range}:{})}:response.value;
  return {...response,value} as DocumentSemanticSnapshot<K>;
}
