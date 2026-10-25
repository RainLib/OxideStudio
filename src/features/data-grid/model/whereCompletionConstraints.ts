import type {CompletionKeywordConstraints} from "@/services/lsp/types";
import type {PredicateContext} from "@/features/query-languages/sql/predicateContext";
import type {WhereCompletionCandidate} from "@/lib/whereCompletion";
import {CompletionItemKind} from "@/services/lsp/types";
import {sqlIsPredicateLabels} from "@/features/query-languages/sql/valueTemplates";
const truthKeywords=["TRUE","FALSE","UNKNOWN","NOT TRUE","NOT FALSE","NOT UNKNOWN"];
export function currentWhereKeywordConstraints(context:PredicateContext,dialect:string,constraints:CompletionKeywordConstraints|undefined){
 if(context.blocked||constraints?.slot!==context.phase)return undefined;
 const allowed=new Set(constraints.allowedKeywords);
 if(constraints.truthTests!==true){
  const local=new Set(sqlIsPredicateLabels(context.type,dialect,context.phase==="is-not"));
  for(const keyword of truthKeywords)if(constraints.truthTests===false||!local.has(keyword))allowed.delete(keyword);
 }
 return allowed;
}
export function constrainLocalWhereCompletions(items:WhereCompletionCandidate[],context:PredicateContext,dialect:string,constraints:CompletionKeywordConstraints|undefined){
 const allowed=currentWhereKeywordConstraints(context,dialect,constraints);
 return allowed?items.filter(item=>![CompletionItemKind.Keyword,CompletionItemKind.Operator].includes(item.kind??-1)||allowed.has(item.label.trim().toUpperCase())):items;
}
