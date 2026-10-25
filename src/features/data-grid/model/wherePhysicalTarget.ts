import {cachedSqlDocumentContext} from "@/features/query-editor/model/cached-completion/documentContext";
import {cachedSqlRelationForFieldCompletion} from "@/features/query-editor/model/cached-completion/relations";
import type {WhereCompletionDocument} from "@/lib/whereCompletion";

/** Reuse the editor's scoped bindings before attaching table-field fallback. */
export function wherePhysicalTargetRelation(document:WhereCompletionDocument,target:{schema?:string|null;table:string}) {
 const statement=cachedSqlDocumentContext({getValue:()=>document.text,getOffsetAt:()=>document.cursorOffset},null,document.text.slice(0,document.cursorOffset));
 if(!statement)return null;
 const relation=cachedSqlRelationForFieldCompletion(statement.source.slice(0,statement.cursorOffset),statement);
 return relation&&!relation.isCte&&!relation.isDerived&&!relation.server&&!relation.schemaOmitted&&
  relation.table.toLowerCase()===target.table.toLowerCase()&&
  (!relation.schema||relation.schema.toLowerCase()===target.schema?.toLowerCase())?relation:null;
}
export function isWherePhysicalTarget(document:WhereCompletionDocument,target:{schema?:string|null;table:string}) {
 return Boolean(wherePhysicalTargetRelation(document,target));
}
