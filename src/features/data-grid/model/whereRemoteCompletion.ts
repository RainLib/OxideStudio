import {CompletionItemKind,type CompletionItem,type CompletionKeywordConstraints} from "@/services/lsp/types";
import {currentWhereKeywordConstraints} from "./whereCompletionConstraints";
import {type PredicateContext} from "@/features/query-languages/sql/predicateContext";
import {compatibleSqlValueKeyword,sqlIsPredicateLabels,sqlLogicalContinuation} from "@/features/query-languages/sql/valueTemplates";
import {sqlNegatedPatternOperators,sqlEscapeLiteral} from "@/features/query-languages/sql/patternOperators";

const operandKinds=new Set<number>([CompletionItemKind.Field,CompletionItemKind.Variable,CompletionItemKind.Function,CompletionItemKind.Method,CompletionItemKind.Constant,CompletionItemKind.Value,CompletionItemKind.EnumMember]);
const exactSlots:Partial<Record<PredicateContext["phase"],ReadonlySet<string>>>={
 "between-separator":new Set(["AND"]),"in-continuation":new Set([",",")"]),
 "case-when":new Set(["WHEN"]),"case-then":new Set(["THEN","AND","OR"]),
 "case-result":new Set(["WHEN","ELSE","END"]),"case-end":new Set(["END"]),"open-in":new Set(["("]),
 "distinct-from":new Set(["FROM"]),
 "similar-to":new Set(["TO"]),
};
/** Apply the input's proven grammar slot without narrowing document-only operand
 * completions or guessing the return type of an unknown function. */
export function filterWhereRemoteCompletions(items:CompletionItem[],context:PredicateContext,dialect:string,constraints?:CompletionKeywordConstraints,logicalContinuation?:boolean){
 const allowed=currentWhereKeywordConstraints(context,dialect,constraints);
 return items.filter(item=>{
  const label=item.label.trim().toUpperCase();
  const keyword=item.kind===CompletionItemKind.Keyword||item.kind===CompletionItemKind.Operator;
  if(context.phase==="value"&&context.valueRole==="pattern-escape"){
   if(!context.escapeSupported||!context.type)return false;
   if([CompletionItemKind.Keyword,CompletionItemKind.Operator,CompletionItemKind.Value,CompletionItemKind.Snippet,CompletionItemKind.Constant,CompletionItemKind.EnumMember].includes(item.kind??-1)){
    const text=item.textEdit?.newText??item.insertText??item.label;
    if(item.insertTextFormat===2||!sqlEscapeLiteral(text.trim(),dialect))return false;
   }
  }
  if(allowed)return keyword&&allowed.has(label);
  if(context.phase==="value"&&keyword&&!compatibleSqlValueKeyword(context.type,dialect,label))return false;
  if(["sqlserver","mssql","tsql"].includes(dialect)&&["value","is","is-not"].includes(context.phase)&&keyword&&["TRUE","FALSE","UNKNOWN","NOT TRUE","NOT FALSE"].includes(label))return false;
  if(!context.structural||context.blocked)return true;
  if(context.phase==="not")return keyword&&["IN","BETWEEN",...sqlNegatedPatternOperators(dialect)].includes(label);
  if(["is","is-not"].includes(context.phase)&&["postgres","postgresql","pgsql","psql","mysql","mariadb","sqlserver","mssql","tsql","duckdb","hive","hql","clickhouse"].includes(dialect))return keyword&&(sqlIsPredicateLabels(context.type,dialect,context.phase==="is-not").includes(label)||["sqlserver","mssql","tsql","clickhouse"].includes(dialect)&&(label==="DISTINCT FROM"||context.phase==="is"&&label==="NOT DISTINCT FROM"));
  if(["is","is-not"].includes(context.phase)&&["sqlite","sqlite3"].includes(dialect)&&keyword&&["UNKNOWN","NOT UNKNOWN"].includes(label))return false;
  const exact=exactSlots[context.phase];if(exact)return exact.has(label)&&(context.phase!=="similar-to"||keyword);
  if(context.phase==="operator"){
   if(item.kind!==undefined&&operandKinds.has(item.kind))return false;
   if(keyword&&["AND","OR"].includes(label)&&(logicalContinuation??sqlLogicalContinuation(context.type,dialect))===false)return false;
  }
  if(context.phase==="continuation"){
   if(item.kind!==undefined&&operandKinds.has(item.kind))return false;
   if(label==="ESCAPE"&&(!keyword||!context.canEscape))return false;
   if(keyword&&!["AND","OR", ")",...(context.canEscape?["ESCAPE"]:[])].includes(label))return false;
  }
  if(context.phase==="value"&&keyword&&["AND","OR"].includes(label))return false;
  return true;
 });
}
