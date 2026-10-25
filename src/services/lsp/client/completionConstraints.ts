import type {CompletionKeywordConstraints} from "../types";
import {isObject} from "./parsing";
const allowed={
 "is":new Set(["NULL","NOT NULL","TRUE","FALSE","UNKNOWN","NOT TRUE","NOT FALSE","NOT UNKNOWN","DISTINCT FROM","NOT DISTINCT FROM"]),
 "is-not":new Set(["NULL","TRUE","FALSE","UNKNOWN","DISTINCT FROM"]),
 "distinct-from":new Set(["FROM"]),
};
const truthKeywords=new Set(["TRUE","FALSE","UNKNOWN","NOT TRUE","NOT FALSE","NOT UNKNOWN"]);
/** Undefined is legacy/no contract; null rejects malformed explicit constraints. */
export function parseCompletionConstraints(value:unknown):CompletionKeywordConstraints|null|undefined{
 if(value===undefined)return undefined;
 if(!isObject(value)||typeof value.slot!=="string"||!Object.prototype.hasOwnProperty.call(allowed,value.slot)||!Array.isArray(value.allowedKeywords)||value.allowedKeywords.length>16)return null;
 const slot=value.slot as CompletionKeywordConstraints["slot"],keywords=value.allowedKeywords;
 if(!keywords.every(keyword=>typeof keyword==="string"&&allowed[slot].has(keyword))||new Set(keywords).size!==keywords.length||!keywords.includes(slot==="distinct-from"?"FROM":"NULL"))return null;
 const truth=value.truthTests;
 if(truth!==undefined&&(typeof truth!=="boolean"||slot==="distinct-from"||truth&&!keywords.includes("TRUE")||!truth&&keywords.some(keyword=>truthKeywords.has(keyword))))return null;
 return {slot,allowedKeywords:[...keywords],...(truth!==undefined?{truthTests:truth as boolean}:{})};
}
