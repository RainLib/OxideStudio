import {sameCompletionContext,type CompletionContextState} from "@/services/lsp/semanticContext";
import {MetadataTaskLimiter} from "@/services/metadataTaskLimiter";
import type {ColumnInfo} from "@/services/tauri/types";
import {boundedCachedComment} from "@/features/query-editor/model/cached-completion/metadataSearch";

export type WhereColumn={name:string;type?:string;comment?:string};
const limiter=new MetadataTaskLimiter(2,64);
const MAX_CACHE_BYTES=8*1024*1024;

/** Columns are obtained under a physical grant, never inferred from UI arrays.
 * One bounded cache entry and one coalesced request belong to this table source. */
export function createWhereColumnSource(options:{
 read:()=>CompletionContextState;scope:string;load:()=>Promise<ColumnInfo[]>;
 limiter?:Pick<MetadataTaskLimiter,"run">;
}) {
 let cached:{context:CompletionContextState;columns:WhereColumn[]}|undefined;
 let pending:{context:CompletionContextState;promise:Promise<WhereColumn[]>}|undefined;
 const allowed=(context:CompletionContextState)=>context.available&&context.metadataAllowed;
 const current=(context:CompletionContextState)=>allowed(context)&&sameCompletionContext(context,options.read());
 return {
  peek():WhereColumn[]{
   if(cached&&current(cached.context))return cached.columns;
   cached=undefined;return [];
  },
  load():Promise<WhereColumn[]>{
   const context=options.read();
   if(!allowed(context)){cached=undefined;return Promise.resolve([]);}
   if(cached&&current(cached.context))return Promise.resolve(cached.columns);
   cached=undefined;
   if(pending&&sameCompletionContext(pending.context,context))return pending.promise;
   const work=(options.limiter??limiter).run(options.scope,"where-columns",async()=>{
    if(!current(context))return [];
    const values=await options.load();
    if(!current(context))return [];
    const columns=values.map(value=>({name:value.name,type:value.data_type,...(value.comment?{comment:boundedCachedComment(value.comment)}:{})}));
    const bytes=columns.reduce((sum,column)=>sum+64+2*(column.name.length+(column.type?.length??0)+(column.comment?.length??0)),0);
    if(bytes<=MAX_CACHE_BYTES)cached={context,columns};
    return columns;
   }).finally(()=>{if(pending?.promise===work)pending=undefined;});
   pending={context,promise:work};return work;
  },
 };
}
export type WhereColumnSource=ReturnType<typeof createWhereColumnSource>;
