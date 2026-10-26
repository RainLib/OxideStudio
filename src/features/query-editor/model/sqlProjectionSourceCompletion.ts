import type {DatabaseDriver,TableInfo} from "@/services/tauri/types";
import {cachedSqlDocumentContext} from "./cached-completion/documentContext";
import {cachedQueryScopes} from "./cached-completion/queryScopes";
import {cachedIdentifierInsertion,cachedIdentifierRange} from "./cached-completion/identifierEdits";
import {sqlCompletionIdentifierFragment} from "./sqlCompletionTriggerPolicy";
import {completionMatchScore,completionFilterTextForQuery} from "./completionMatch";

const sourcePicker=Symbol("oxideProjectionSourcePicker");
export const isProjectionSourceCompletion=(item:object)=>Boolean((item as {[sourcePicker]?:boolean})[sourcePicker]);
const snippetText=(value:string)=>value.replace(/[\\$}]/gu,"\\$&");

/** Only offer a new FROM at an empty/unqualified SELECT projection whose own
 * query branch has no FROM, including a FROM that follows the cursor. Never
 * turn a correlated parent or a neighbouring statement into the new target. */
export function projectionSourceContext(model:any,position:any,prefix:string){
  const document=cachedSqlDocumentContext(model,position,prefix);
  if(!document)return null;
  const scopes=cachedQueryScopes(document.masked,document.cursorOffset);
  if(scopes.activeClause!=="SELECT"||scopes.visibleInputPositions().some(offset=>scopes.relationAt(offset)===scopes.activeOwner))return null;
  const selects=[...document.masked.slice(0,document.cursorOffset).matchAll(/\bselect\b/giu)].filter(match=>scopes.relationAt(match.index)===scopes.activeOwner);
  const select=selects[selects.length-1];if(!select)return null;
  const tail=document.source.slice(select.index+select[0].length,document.cursorOffset).replace(/^\s*(?:distinct|all)\b\s*/iu,"");
  const fragment=sqlCompletionIdentifierFragment(prefix);
  if(fragment.unsupported)return null;
  if(tail.trim()&&tail.trim().length!==fragment.replacementLength)return null;
  if(tail.trim()&&!fragment.prefix&&!fragment.openingQuote)return null;
  const completedKeyword=!tail.trim()&&!/\s$/u.test(prefix);
  return {query:tail.trim()?fragment.prefix:"",fragment:tail.trim()?fragment:{prefix:"",replacementLength:0},completedKeyword};
}

export function sqlProjectionSourceCompletions(options:{model:any;position:any;prefix:string;monaco:any;tables:TableInfo[];driver:DatabaseDriver;database?:string|null;schema?:string|null;keywordCase:"upper"|"lower"|"preserve"}){
  const context=projectionSourceContext(options.model,options.position,options.prefix);
  if(!context)return [];
  const {monaco,position,driver}=options;
  const from=options.keywordCase==="lower"?"from":"FROM";
  return options.tables.map(table=>{
    const schema=table.schema||options.schema||undefined;
    const label=[options.database,schema===options.database?undefined:schema,table.name].filter(Boolean).join(".");
    const score=Math.max(completionMatchScore(table.name,context.query),completionMatchScore(label,context.query));
    return {table,schema,label,score};
  }).filter(item=>item.score>=0).sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label)).slice(0,128).map(({table,schema,label,score})=>{
    // PostgreSQL cannot query another database by adding a third name. The
    // database belongs in the label; SQL uses the selected schema and table.
    const target=[schema,table.name].filter((name):name is string=>Boolean(name)).map(name=>cachedIdentifierInsertion(name,{prefix:"",replacementLength:0},driver)).join(".");
    const namespace=[options.database,schema===options.database?undefined:schema].filter(Boolean).join(".");
    return {label:{label:table.name,description:namespace},kind:monaco.languages.CompletionItemKind.Struct,detail:`${label} · Choose table, then columns`,documentation:{value:table.comment||"Adds this FROM target and continues with its columns."},
      insertText:`${context.completedKeyword?" ":""}\${1} ${from} ${snippetText(target)}$0`,insertTextRules:monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      filterText:completionFilterTextForQuery(label,context.query),sortText:`1:${String(9999-Math.max(0,score)).padStart(4,"0")}:${label}`,
      range:context.completedKeyword?new monaco.Range(position.lineNumber,position.column,position.lineNumber,position.column):cachedIdentifierRange(monaco,options.model,position,context.fragment),[sourcePicker]:true};
  });
}
