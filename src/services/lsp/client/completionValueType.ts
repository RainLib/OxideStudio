import type {CompletionResponse} from "../types";
import {parseCompletionConstraints} from "./completionConstraints";

/** Positive expected-type knowledge is bound by the enclosing completion
 * snapshot. Absent knowledge must preserve the current local inference. */
export function parseCompletionValueType(value:unknown):string|null|undefined {
 if(value===undefined)return undefined;
 return typeof value==="string"&&value.length>0&&value.length<=256&&value.trim()===value&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)?value:null;
}
export function parseCompletionValueRole(value:unknown,valueType:string|null|undefined):"pattern-escape"|null|undefined{
 if(value===undefined)return undefined;
 return value==="pattern-escape"&&typeof valueType==="string"&&/^(?:text|varchar|nvarchar|string)$/iu.test(valueType)?value:null;
}
export function parseCompletionPatternEscape(value:unknown,logical:unknown):boolean|null|undefined{
 if(value===undefined)return undefined;
 return typeof value==="boolean"&&logical===true?value:null;
}
type CompletionKnowledge=Pick<CompletionResponse,"constraints"|"valueType"|"valueRole"|"logicalContinuation"|"patternEscape">;
/** Both wire routes accept or reject the complete semantic contract together. */
export function parseCompletionKnowledge(result:Record<string,unknown>):CompletionKnowledge|null{
 const constraints=parseCompletionConstraints(result.constraints);
 const valueType=parseCompletionValueType(result.valueType);
 const valueRole=parseCompletionValueRole(result.valueRole,valueType);
 const logical=result.logicalContinuation;
 const patternEscape=parseCompletionPatternEscape(result.patternEscape,logical);
 if(constraints===null||valueType===null||valueRole===null||patternEscape===null
  ||constraints&&valueType!==undefined
  ||logical!==undefined&&(typeof logical!=="boolean"||constraints||valueType!==undefined))return null;
 return {...(constraints?{constraints}:{}),...(valueType!==undefined?{valueType}:{}),...(valueRole!==undefined?{valueRole}:{}),...(logical!==undefined?{logicalContinuation:logical as boolean}:{}),...(patternEscape!==undefined?{patternEscape}:{})};
}
