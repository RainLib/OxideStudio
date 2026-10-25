import type {CompletionContext,CompletionItem,CompletionResponse,Position} from "../types";
import type {LspClientBridge,LspCancellationToken} from "./contracts";
import {isObject} from "./parsing";
import {semanticPosition} from "./documentSemanticValidation";
import {validCompletionItem} from "./documentCompletions";
import {parseCompletionKnowledge} from "./completionValueType";
export type CompletionSnapshotRequest={uri:string;version:number;dialect:string;position:Position;analysisToken:string;context?:CompletionContext};
export async function getLspCompletionSnapshot(client:LspClientBridge,request:CompletionSnapshotRequest,token?:LspCancellationToken):Promise<CompletionResponse|null>{
 if(token?.isCancellationRequested||!client.isInitialized()||typeof request.uri!=="string"||!Number.isSafeInteger(request.version)||request.version<0||request.version>2147483647||typeof request.dialect!=="string"||!/^[a-z0-9_-]{1,64}$/u.test(request.dialect)||!semanticPosition(request.position)||typeof request.analysisToken!=="string"||!/^[a-zA-Z0-9_-]{1,128}$/u.test(request.analysisToken)||request.context&&(![1,2,3].includes(request.context.triggerKind)||request.context.triggerCharacter!==undefined&&(typeof request.context.triggerCharacter!=="string"||request.context.triggerCharacter.length>8||Array.from(request.context.triggerCharacter).length!==1)))return null;
 const result=await client.invokeCancellable<unknown>("lsp_request",{...client.requestSessionPayload(),method:"oxide/completionSnapshot",params:{textDocument:{uri:request.uri},version:request.version,dialect:request.dialect,position:request.position,oxideAnalysisToken:request.analysisToken,...(request.context?{context:{triggerKind:request.context.triggerKind,...(request.context.triggerCharacter?{triggerCharacter:request.context.triggerCharacter}:{})}}:{})}},token);
 if(token?.isCancellationRequested||!client.isInitialized()||!isObject(result)||result.uri!==request.uri||result.version!==request.version||result.dialect!==request.dialect||result.oxideAnalysisToken!==request.analysisToken||!semanticPosition(result.position)||result.position.line!==request.position.line||result.position.character!==request.position.character||typeof result.isIncomplete!=="boolean"||!Array.isArray(result.items)||result.items.length>512||!result.items.every(item=>validCompletionItem(item,false)))return null;
 const knowledge=parseCompletionKnowledge(result);if(!knowledge)return null;
 return {items:result.items as unknown as CompletionItem[],isIncomplete:result.isIncomplete,resolveProvider:false,...knowledge};
}
