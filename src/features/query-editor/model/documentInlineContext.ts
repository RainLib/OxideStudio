import {createCachedSqlCompletionRequest,type CachedSqlCompletionSourceOptions} from "./cachedSqlCompletion";
import type {InlineLspContext} from "@/services/tauri/ai.service";

/** Reuse completion's bounded query-local resolver with physical access
 * explicitly disabled. No catalog id, tables or persistent field cache. */
export async function documentInlineContext(options:{
  model:any;monaco:any;position:any;prefix:string;driver:CachedSqlCompletionSourceOptions["driver"];
  sqlCompletion:CachedSqlCompletionSourceOptions["sqlCompletion"];sqlFormatting:CachedSqlCompletionSourceOptions["sqlFormatting"];
  token:{isCancellationRequested?:boolean};isCurrent:()=>boolean;
}):Promise<InlineLspContext>{
  if(!options.isCurrent())return {};
  const request=createCachedSqlCompletionRequest({driver:options.driver,metadataRevision:0,schemaTables:[],connectionId:null,
    sqlCompletion:options.sqlCompletion,sqlFormatting:options.sqlFormatting},
    {fields:new Map(),joinConstraints:new Map()},
    {model:options.model,monaco:options.monaco,position:options.position,textBeforeCursor:options.prefix,
      completionDriver:options.driver,token:options.token,context:{isCurrent:options.isCurrent,lspAllowed:false,metadataAllowed:false}});
  const suggestions=await request.metadataSuggestions();
  if(!options.isCurrent())return {};
  return {dialect:options.driver,candidates:suggestions.map(item=>({
    label:typeof item.label==="string"?item.label:item.label.label,insertText:item.insertText,kind:5,
  }))};
}
