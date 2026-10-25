import type {Position} from "../types";
import {isObject,normalizeMarkup} from "./parsing";
export const semanticInteger=(value:unknown):value is number=>typeof value==="number"&&Number.isInteger(value)&&value>=0&&value<=0xffffffff;
export const semanticPosition=(value:unknown):value is Position=>isObject(value)&&semanticInteger(value.line)&&semanticInteger(value.character);
const ordered=(a:Position,b:Position)=>a.line<b.line||a.line===b.line&&a.character<=b.character;
export const semanticRange=(value:any)=>isObject(value)&&semanticPosition(value.start)&&semanticPosition(value.end)&&ordered(value.start,value.end);
const documentation=(value:unknown)=>value===undefined||typeof value==="string"||isObject(value)&&typeof value.value==="string"&&(value.kind===undefined||typeof value.kind==="string");
const edits=(value:unknown)=>Array.isArray(value)&&value.every(edit=>isObject(edit)&&semanticRange(edit.range)&&typeof edit.newText==="string");
const workspace=(value:unknown,uri:string)=>{
  if(!isObject(value)||value.documentChanges!==undefined||value.changeAnnotations!==undefined||!isObject(value.changes))return false;
  return Object.entries(value.changes).every(([key,value])=>key===uri&&edits(value));
};
const signatureInformation=(signature:unknown)=>{
  if(!isObject(signature)||typeof signature.label!=="string"||!documentation(signature.documentation)||signature.activeParameter!==undefined&&!semanticInteger(signature.activeParameter))return false;
  const label=signature.label;
  return signature.parameters===undefined||Array.isArray(signature.parameters)&&signature.parameters.every((parameter:unknown)=>{
    if(!isObject(parameter)||!documentation(parameter.documentation))return false;
    if(typeof parameter.label==="string")return true;
    if(!Array.isArray(parameter.label)||parameter.label.length!==2)return false;
    const [start,end]=parameter.label;
    return semanticInteger(start)&&semanticInteger(end)&&start<=end&&end<=label.length;
  });
};
export function validDocumentSemanticValue(kind:string,value:unknown,uri:string):boolean{
  if(value===null)return ["hover","signature","prepareRename","rename"].includes(kind);
  switch(kind){
    case "hover":return isObject(value)&&Boolean(normalizeMarkup(value.contents))&&(value.range===undefined||semanticRange(value.range));
    case "definitions":case "references":return Array.isArray(value)&&value.every(item=>isObject(item)&&item.uri===uri&&semanticRange(item.range));
    case "prepareRename":return semanticRange(value);
    case "rename":return workspace(value,uri);
    case "signature":return isObject(value)&&Array.isArray(value.signatures)&&value.signatures.length>0&&
      (value.activeSignature===undefined||semanticInteger(value.activeSignature)&&value.activeSignature<value.signatures.length)&&
      (value.activeParameter===undefined||semanticInteger(value.activeParameter))&&value.signatures.every(signatureInformation);
    case "tokens":return isObject(value)&&Array.isArray(value.data)&&value.data.length%5===0&&value.data.every(semanticInteger)&&value.data.every((item:number,index:number)=>index%5!==3||item<5)&& (value.resultId===undefined||typeof value.resultId==="string");
    case "inlayHints":return Array.isArray(value)&&value.every(item=>isObject(item)&&semanticPosition(item.position)&&
      (typeof item.label==="string"||Array.isArray(item.label)&&item.label.every((part:unknown)=>isObject(part)&&typeof part.value==="string"&&documentation(part.tooltip)))&&documentation(item.tooltip)&&
      (item.textEdits===undefined||edits(item.textEdits))&&(item.kind===undefined||item.kind===1||item.kind===2));
    case "codeActions":return Array.isArray(value)&&value.every(item=>isObject(item)&&typeof item.title==="string"&&item.command===undefined&&
      (item.edit===undefined||workspace(item.edit,uri))&&(item.kind===undefined||typeof item.kind==="string")&&(item.disabled===undefined||isObject(item.disabled)&&typeof item.disabled.reason==="string"));
    default:return false;
  }
}
