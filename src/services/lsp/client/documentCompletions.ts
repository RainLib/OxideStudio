import type {CompletionItem,CompletionResponse,Position} from "../types";
import type {LspClientBridge,LspCancellationToken} from "./contracts";
import {isObject} from "./parsing";
import {semanticPosition,semanticRange} from "./documentSemanticValidation";
import {parseCompletionKnowledge} from "./completionValueType";
export type DocumentCompletionRequest={uri:string;version:number;dialect:string;position:Position;preferences:{keywordCase:"upper"|"lower"|"preserve";functionCase:"upper"|"lower"|"preserve";tableAlias:"none"|"initials"}};
const optionalText=(value:unknown)=>value===undefined||typeof value==="string";
export function validCompletionItem(item:unknown,documentOnly=true):boolean {
  if(!isObject(item)||typeof item.label!=="string"||documentOnly&&(item.data!==undefined||item.command!==undefined||item.additionalTextEdits!==undefined))return false;
  if(![item.detail,item.insertText,item.sortText,item.filterText].every(optionalText)||item.kind!==undefined&&(!Number.isInteger(item.kind)||Number(item.kind)<1||Number(item.kind)>25))return false;
  if(item.insertTextFormat!==undefined&&item.insertTextFormat!==1&&item.insertTextFormat!==2||item.insertTextMode!==undefined&&item.insertTextMode!==1&&item.insertTextMode!==2)return false;
  if(item.documentation!==undefined&&typeof item.documentation!=="string"&&(!isObject(item.documentation)||typeof item.documentation.value!=="string"))return false;
  if(item.labelDetails!==undefined&&(!isObject(item.labelDetails)||!optionalText(item.labelDetails.detail)||!optionalText(item.labelDetails.description)))return false;
  if(item.textEdit!==undefined){const edit=item.textEdit;if(!isObject(edit)||typeof edit.newText!=="string")return false;
    if(edit.range!==undefined){if(!semanticRange(edit.range))return false;}else if(!semanticRange(edit.insert)||!semanticRange(edit.replace))return false;
  }
  if(!documentOnly&&item.additionalTextEdits!==undefined&&(!Array.isArray(item.additionalTextEdits)||!item.additionalTextEdits.every(edit=>isObject(edit)&&typeof edit.newText==="string"&&semanticRange(edit.range))))return false;
  if(!documentOnly&&item.command!==undefined&&(!isObject(item.command)||typeof item.command.command!=="string"))return false;
  return true;
}
export async function getLspDocumentCompletions(client:LspClientBridge,request:DocumentCompletionRequest,token?:LspCancellationToken):Promise<CompletionResponse|null>{
  const preferences=request.preferences;
  if(token?.isCancellationRequested||!client.isInitialized()||typeof request.uri!=="string"||!Number.isSafeInteger(request.version)||request.version<0||request.version>2147483647||!/^[a-z0-9_-]{1,64}$/.test(request.dialect)||!semanticPosition(request.position)||!preferences||
    !["upper","lower","preserve"].includes(preferences.keywordCase)||!["upper","lower","preserve"].includes(preferences.functionCase)||!["none","initials"].includes(preferences.tableAlias))return null;
  const result=await client.invokeCancellable<unknown>("lsp_request",{...client.requestSessionPayload(),method:"oxide/documentCompletions",params:{textDocument:{uri:request.uri},version:request.version,dialect:request.dialect,position:request.position,preferences:{keywordCase:preferences.keywordCase,functionCase:preferences.functionCase,tableAlias:preferences.tableAlias}}},token);
  if(token?.isCancellationRequested||!client.isInitialized()||!isObject(result)||result.uri!==request.uri||result.version!==request.version||result.dialect!==request.dialect||result.oxideAnalysisToken!==undefined||typeof result.isIncomplete!=="boolean"||!Array.isArray(result.items)||result.items.length>512||!result.items.every(item=>validCompletionItem(item)))return null;
  const knowledge=parseCompletionKnowledge(result);
  if(!knowledge||result.position!==undefined&&(!semanticPosition(result.position)||result.position.line!==request.position.line||result.position.character!==request.position.character)||Object.keys(knowledge).length>0&&!result.position)return null;
  return {items:result.items as unknown as CompletionItem[],isIncomplete:result.isIncomplete,resolveProvider:false,...knowledge};
}
