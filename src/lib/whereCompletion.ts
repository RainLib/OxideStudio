import {sqlValueTemplates,sqlIsPredicateLabels,sqlLogicalContinuation} from "@/features/query-languages/sql/valueTemplates";
import {SQL_PATTERN_WORDS,SQL_ESCAPE_VALUES,sqlNegatedPatternOperators,sqlPatternOperators} from "@/features/query-languages/sql/patternOperators";
import {
  qualifiedTableName,
  quoteIdentifier,
  quoteIdentifierWithCapabilities,
} from "@/lib/databaseDialect";
import type { CompletionItem } from "@/services/lsp/types";
import { CompletionItemKind } from "@/services/lsp/types";
import type { DatabaseDriver } from "@/services/tauri/types";
import {boundedCachedComment, rankCachedColumns, searchCachedColumns} from "@/features/query-editor/model/cached-completion/metadataSearch";
import {sqlPredicateContext,SQL_UNTYPED_STRING} from "@/features/query-languages/sql/predicateContext";

export type WhereCompletionDocument = {
  text: string;
  conditionStart: number;
  cursorOffset: number;
  line: number;
  character: number;
};

export type WhereCompletionCandidate = {
  label: string;
  insertText: string;
  snippet?: boolean;
  preserveInsertText?: boolean;
  /** Place the caret before this many trailing code units after insertion. */
  cursorOffsetFromEnd?: number;
  /** Insert continuations at the caret instead of replacing the active token. */
  replacementRange?: WhereReplacementRange;
  detail?: string;
  kind?: number;
  sortText: string;
  source: "local" | "lsp" | "history";
};

export type WhereReplacementRange = { start: number; end: number };

const WHERE_FOLLOW_UPS = ["AND", "OR"];
const WHERE_OPERATORS = [
  { label: "=", insertText: "= " },
  { label: "<>", insertText: "<> " },
  { label: ">", insertText: "> " },
  { label: "<", insertText: "< " },
  { label: ">=", insertText: ">= " },
  { label: "<=", insertText: "<= " },
  { label: "IN", insertText: "IN (" },
  { label: "NOT IN", insertText: "NOT IN (" },
  { label: "BETWEEN", insertText: "BETWEEN " },
  { label: "IS NULL", insertText: "IS NULL " },
  { label: "IS NOT NULL", insertText: "IS NOT NULL " },
] as const;

const WHERE_NOT_PREDICATES = [
  { label: "IN", insertText: "IN (" },
  { label: "BETWEEN", insertText: "BETWEEN " },
];
const SQL_RESERVED_IDENTIFIERS = new Set([
  ...SQL_PATTERN_WORDS,
  "ALL",
  "AND",
  "AS",
  "BY",
  "CASE",
  "DELETE",
  "DISTINCT",
  "ELSE",
  "END",
  "FALSE",
  "FROM",
  "GROUP",
  "HAVING",
  "IN",
  "INSERT",
  "JOIN",
  "LIMIT",
  "NOT",
  "NULL",
  "ON",
  "OR",
  "ORDER",
  "SELECT",
  "TABLE",
  "THEN",
  "TRUE",
  "UNION",
  "UPDATE",
  "USER",
  "WHEN",
  "WHERE",
]);

const COMPLETE_QUOTED_IDENTIFIER_SOURCE =
  '"(?:[^\"]|\"\")*"|`[^`]*`|\\[[^\\]]*\\]';

export function buildWhereCompletionDocument(options: {
  condition: string;
  cursorOffset: number;
  driver: DatabaseDriver;
  identifierQuote?: string;
  schema?: string | null;
  table: string;
}) {
  const relation = options.identifierQuote ? [options.schema,options.table].filter((value):value is string=>Boolean(value)).map(value=>quoteIdentifierWithCapabilities({identifierQuote:options.identifierQuote!},value)).join(".") : qualifiedTableName(
    options.driver,
    options.schema,
    options.table,
  );
  const prefix = `SELECT * FROM ${relation} WHERE `;
  const boundedCursor = Math.max(
    0,
    Math.min(options.cursorOffset, options.condition.length),
  );
  const cursorOffset = prefix.length + boundedCursor;
  const text = `${prefix}${options.condition};`;
  const beforeCursor = text.slice(0, cursorOffset);
  const lines = beforeCursor.split("\n");

  return {
    text,
    conditionStart: prefix.length,
    cursorOffset,
    line: lines.length - 1,
    character: lines[lines.length - 1]?.length || 0,
  } satisfies WhereCompletionDocument;
}

export function whereReplacementRange(
  condition: string,
  cursorOffset: number,
): WhereReplacementRange {
  const boundedCursor = Math.max(0, Math.min(cursorOffset, condition.length));
  for (const match of condition.matchAll(
    new RegExp(COMPLETE_QUOTED_IDENTIFIER_SOURCE, "gu"),
  )) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (boundedCursor >= start && boundedCursor <= end) {
      return { start, end };
    }
  }

  // While a quoted identifier is still being typed, replace the unmatched
  // prefix as a unit. This prevents accepting `status code` after `"sta`
  // from leaving the original opening quote behind.
  const unfinishedQuoted = condition
    .slice(0, boundedCursor)
    .match(/(?:^|[\s.])("[^"]*|`[^`]*|\[[^\]]*)$/u)?.[1];
  if (unfinishedQuoted) {
    return {
      start: boundedCursor - unfinishedQuoted.length,
      end: boundedCursor,
    };
  }

  let start = boundedCursor;
  let end = boundedCursor;
  const isIdentifierCharacter = (character: string) =>
    /[\p{L}\p{N}_.$@-]/u.test(character);

  while (start > 0 && isIdentifierCharacter(condition[start - 1]!)) start -= 1;
  while (end < condition.length && isIdentifierCharacter(condition[end]!)) {
    end += 1;
  }
  return { start, end };
}

function completionFilterText(value: string) {
  const qualifiedParts = value.trim().split(".");
  const qualifiedTail = qualifiedParts[qualifiedParts.length - 1] || "";
  return qualifiedTail
    .replace(/^["`\[]/u, "")
    .replace(/["`\]]$/u, "");
}

function fuzzyScore(label: string, typed: string) {
  const normalizedLabel = label.toLocaleLowerCase();
  const normalizedTyped = typed.toLocaleLowerCase();
  if (!normalizedTyped) return 20;
  if (normalizedLabel.startsWith(normalizedTyped)) return 0;
  const containsAt = normalizedLabel.indexOf(normalizedTyped);
  if (containsAt >= 0) return 10 + containsAt;

  let labelIndex = 0;
  let gapScore = 30;
  for (const character of normalizedTyped) {
    const next = normalizedLabel.indexOf(character, labelIndex);
    if (next < 0) return Number.POSITIVE_INFINITY;
    gapScore += next - labelIndex;
    labelIndex = next + 1;
  }
  return gapScore;
}

function safeColumnInsertText(
  driver: DatabaseDriver,
  name: string,
  identifierQuote?: string,
) {
  return /^[A-Za-z_][A-Za-z0-9_$]*$/u.test(name) &&
    !SQL_RESERVED_IDENTIFIERS.has(name.toLocaleUpperCase())
    ? name
    : identifierQuote
      ? quoteIdentifierWithCapabilities({ identifierQuote }, name)
      : quoteIdentifier(driver, name);
}

type WhereSearchColumn = { name: string; type?: string; comment?: string };
type WhereCompletionOptions = {
  condition: string;
  cursorOffset: number;
  driver: DatabaseDriver;
  identifierQuote?: string;
  dialect?: string;
  qualifiers?: readonly string[];
  valueType?: string;
  valueRole?: "pattern-escape";
  logicalContinuation?: boolean;
  patternEscape?: boolean;
  columns: WhereSearchColumn[];
};
export function whereCompletionContext(options:WhereCompletionOptions){
  let context=sqlPredicateContext({...options,dialect:options.dialect??options.driver,replacementStart:whereReplacementRange(options.condition,options.cursorOffset).start});
  if(context.phase==="continuation"&&context.escapeAttachable&&options.patternEscape!==undefined)context={...context,canEscape:options.patternEscape};
  return context.phase==="value"&&options.valueType!==undefined?{...context,type:options.valueType,...(context.valueRole?{escapeSupported:context.escapeSupported||options.valueRole==="pattern-escape"}:{} )}:context;
}
export function localWhereCompletionCandidates(options: WhereCompletionOptions,
  rankColumns: (columns: WhereSearchColumn[], query: string) => ReturnType<typeof rankCachedColumns<WhereSearchColumn>> = rankCachedColumns,
): WhereCompletionCandidate[] {
  const replacement = whereReplacementRange(
    options.condition,
    options.cursorOffset,
  );
  let typed = completionFilterText(
    options.condition.slice(replacement.start, options.cursorOffset),
  );
  const beforeToken = options.condition.slice(0, replacement.start).trimEnd();
  const beforeCursor = options.condition.slice(0, options.cursorOffset);
  const fieldPrefix=options.condition.slice(replacement.start,options.cursorOffset);
  const context=whereCompletionContext(options);
  if(context.blocked||context.phase==="relation"||context.phase==="type")return [];
  if(context.consumedKeyword)typed="";
  const afterNegatedOperand=/\bnot\s*$/iu.test(beforeCursor)&&context.phase==="operand";

  const keywordCandidates = (
    keywords: Array<
      | string
      | {
          label: string;
          insertText: string;
          cursorOffsetFromEnd?: number;
          preserveInsertText?: boolean;
          replacementRange?: WhereReplacementRange;
        }
    >,
    detail: string,
    sortGroup: string,
    filterByTyped = true,
  ) =>
    keywords
      .filter((keyword) =>
        !filterByTyped || Number.isFinite(
          fuzzyScore(typeof keyword === "string" ? keyword : keyword.label, typed),
        ),
      )
      .map((keyword, index) => {
        const explicitRange=typeof keyword === "string" ? undefined : keyword.replacementRange;
        const insertText=typeof keyword === "string" ? `${keyword} ` : keyword.insertText;
        const insertAfterKeyword=context.consumedKeyword&&!explicitRange;
        return ({
        label: typeof keyword === "string" ? keyword : keyword.label,
        insertText:
          `${insertAfterKeyword&&insertText!=="("&&!/\s$/u.test(beforeCursor)?" ":""}${insertText}`,
        cursorOffsetFromEnd:
          typeof keyword === "string"
            ? undefined
            : keyword.cursorOffsetFromEnd,
        replacementRange:
          explicitRange??(insertAfterKeyword?{start:options.cursorOffset,end:options.cursorOffset}:undefined),
        detail,
        preserveInsertText: insertAfterKeyword|| (typeof keyword === "string" ? undefined : keyword.preserveInsertText),
        kind: CompletionItemKind.Keyword,
        sortText: `${sortGroup}:${String(index).padStart(4, "0")}`,
        source: "local" as const,
      });});
  const continuation=(labels:string[],detail:string)=>keywordCandidates(labels.map(label=>({
    label,insertText:`${/^[A-Z]/u.test(label)&&!/\s$/u.test(beforeCursor)?" ":""}${label}${label===")"?"":" "}`,
    replacementRange:{start:options.cursorOffset,end:options.condition.slice(options.cursorOffset).startsWith(label)?options.cursorOffset+label.length:options.cursorOffset},
  })),detail,"0",false);

  if (context.phase==="between-separator") {
    const needsSpace = !/\s$/u.test(beforeCursor);
    return keywordCandidates(
      [{
        label: "AND",
        insertText: `${needsSpace ? " " : ""}AND `,
        replacementRange: {
          start: options.cursorOffset,
          end: options.cursorOffset,
        },
      }],
      "BETWEEN range separator",
      "0",
      false,
    );
  }
  if (context.phase==="in-continuation") {
    return keywordCandidates(
      [
        {
          label: ",",
          insertText: ", ",
          replacementRange: {
            start: options.cursorOffset,
            end: options.cursorOffset,
          },
        },
        {
          label: ")",
          insertText: ") ",
          replacementRange: {
            start: options.cursorOffset,
            end: options.cursorOffset,
          },
        },
      ],
      "IN list continuation",
      "0",
      false,
    );
  }
  if (context.phase==="continuation") {
    const activeWord=!context.consumedKeyword&&replacement.start<options.cursorOffset&&/^[\p{L}_]/u.test(options.condition.slice(replacement.start,options.cursorOffset));
    const start=activeWord?replacement.start:options.cursorOffset;
    const needsSpace = !/\s$/u.test(options.condition.slice(0,start));
    return keywordCandidates(
      [...WHERE_FOLLOW_UPS,...(context.canEscape?["ESCAPE"]:[])].map((label) => ({
        label,
        insertText: `${needsSpace ? " " : ""}${label} `,
        replacementRange: {
          start,
          end: activeWord?replacement.end:options.cursorOffset,
        },
      })),
      "WHERE continuation",
      "0",
      false,
    );
  }
  let isKeywords:WhereCompletionCandidate[]=[];
  if (context.phase==="is"||context.phase==="is-not") {
    const profile=options.dialect??options.driver;
    isKeywords=keywordCandidates(sqlIsPredicateLabels(context.type,profile,context.phase==="is-not"),"IS predicate","0");
    if(!["sqlite","sqlite3"].includes(profile))return isKeywords;
  }
  if (context.phase==="distinct-from")return keywordCandidates(["FROM"],"Comparison operator","0");
  if (context.phase==="similar-to")return keywordCandidates(["TO"],"Pattern operator","0");
  if (context.phase==="not") {
    return keywordCandidates([...WHERE_NOT_PREDICATES,...sqlNegatedPatternOperators(options.dialect??options.driver).map(label=>({label,insertText:label+" "}))], "NOT predicate", "0");
  }
  if (context.phase==="open-in")return keywordCandidates([{label:"(",insertText:"("}],"IN list","0",false);
  if (context.phase==="case-when")return continuation(["WHEN"],"CASE branch");
  if (context.phase==="case-then")return continuation(["THEN","AND","OR"],"CASE condition");
  if (context.phase==="case-result")return continuation(["WHEN","ELSE","END"],"CASE result");
  if (context.phase==="case-end")return continuation(["END"],"CASE result");
  if (context.phase==="value") {
    if(context.valueRole==="pattern-escape")return context.escapeSupported&&context.type?keywordCandidates(SQL_ESCAPE_VALUES,"Pattern escape character","0"):[];
    return keywordCandidates(
      sqlValueTemplates(context.type,options.dialect??options.driver),
      context.type&&context.type!==SQL_UNTYPED_STRING
        ? `${context.type} predicate value`
        : "Predicate value",
      "0",
    );
  }
  if (context.phase==="operator"||context.phase==="argument-continuation") {
    const operators=[...WHERE_OPERATORS,...sqlPatternOperators(options.dialect??options.driver).map(label=>({label,insertText:label+" "}))].map((operator, index) => ({
      label: operator.label,
      insertText: operator.insertText,
      detail: "Predicate operator",
      kind: CompletionItemKind.Operator,
      sortText: `0:${String(index).padStart(4, "0")}`,
      source: "local" as const,
    }));
    const logical=(options.logicalContinuation??sqlLogicalContinuation(context.type,options.dialect??options.driver))===true&&context.phase==="operator"
      ?keywordCandidates(["AND","OR"].map(label=>({label,insertText:`${replacement.start>0&&!/\s$/u.test(options.condition.slice(0,replacement.start))?" ":""}${label} `,preserveInsertText:true})),"Logical continuation","0") :[];
    return context.phase==="argument-continuation"?[...continuation([",",")"],"Function argument"),...operators]:[...logical,...operators];
  }

  const qualifierEnd=/^["`\[]/u.test(fieldPrefix)?-1:fieldPrefix.lastIndexOf(".");
  const fieldReplacement=context.consumedKeyword?{start:options.cursorOffset,end:options.cursorOffset}:qualifierEnd>=0?{start:replacement.start+qualifierEnd+1,end:replacement.end}:undefined;
  const appendPredicate=qualifierEnd<0&&context.canAppendPredicate&&!options.condition.slice(replacement.end).trim();
  const columns: WhereCompletionCandidate[] = rankColumns(options.columns, typed).items
    .map(({ column, sortText }) => ({
      label: column.name,
      insertText: `${context.consumedKeyword&&!/\s$/u.test(beforeCursor)?" ":""}${safeColumnInsertText(
        options.driver,
        column.name,
        options.identifierQuote,
      )}${appendPredicate?" = ":""}`,
      replacementRange:fieldReplacement,
      preserveInsertText:context.consumedKeyword,
      detail: [column.type ? `${column.type} · current table` : "Current table column", boundedCachedComment(column.comment)].filter(Boolean).join(" · "),
      kind: CompletionItemKind.Field,
      sortText,
      source: "local" as const,
    }));

  if(isKeywords.length)return [...isKeywords,...columns];
  const canStartNegatedPredicate =
    !afterNegatedOperand &&
    (!beforeToken || /(?:\(|\b(?:and|or))\s*$/iu.test(beforeToken));
  if (!canStartNegatedPredicate || !Number.isFinite(fuzzyScore("NOT", typed))) {
    return columns;
  }
  return [
    ...columns,
    {
      label: "NOT",
      insertText: "NOT ",
      detail: "Negate the next predicate",
      kind: CompletionItemKind.Keyword,
      sortText: "1:0000",
      source: "local" as const,
    },
  ];
}

/** Load the shared pinyin dictionary only when this interaction searches fields. */
export async function searchWhereCompletionCandidates(options: WhereCompletionOptions, token: {readonly isCancellationRequested?: boolean} = {}) {
  if(token.isCancellationRequested)return [];
  let query: string | undefined;
  const syntax = localWhereCompletionCandidates(options, (_columns, typed) => {
    query = typed;
    return {items: [], incomplete: false};
  });
  if(query === undefined)return syntax;
  const result = await searchCachedColumns(options.columns, query, token);
  if(token.isCancellationRequested)return [];
  return localWhereCompletionCandidates(options, () => result);
}

export function mergeWhereCompletionCandidates(
  local: WhereCompletionCandidate[],
  lspItems: CompletionItem[],
  source?: {document:WhereCompletionDocument;condition:string},
) {
  const merged = new Map<string, WhereCompletionCandidate>();
  const lines=source?.document.text.split("\n")??[],lineOffsets:number[]=[];
  let lineOffset=0;
  for(const line of lines){lineOffsets.push(lineOffset);lineOffset+=line.length+1;}
  for (const candidate of local) {
    merged.set(candidate.label.toLocaleLowerCase(), candidate);
  }
  for (const item of lspItems) {
    // This input cannot apply edits to the virtual SELECT prefix or another
    // document. Reject those items rather than silently accepting half an edit.
    if(source&&item.additionalTextEdits?.length)continue;
    let replacementRange:WhereReplacementRange|undefined;
    if(source&&item.textEdit){
      const range="range" in item.textEdit?item.textEdit.range:item.textEdit.replace;
      const offset=(position:{line:number;character:number})=>{
        if(!Number.isInteger(position.line)||!Number.isInteger(position.character)||position.line<0||position.line>=lines.length||position.character<0||position.character>lines[position.line]!.length)return -1;
        return lineOffsets[position.line]!+position.character-source.document.conditionStart;
      };
      const start=offset(range.start),end=offset(range.end);
      if(start<0||end<start||end>source.condition.length)continue;
      replacementRange={start,end};
    }
    const key = item.label.toLocaleLowerCase();
    const existing = merged.get(key);
    const lspInsertText = item.textEdit?.newText || item.insertText || item.label;
    const preserveLocalWorkflowInsert =
      existing?.source === "local" &&
      (existing.preserveInsertText || existing.kind === CompletionItemKind.Field ||
        existing.kind === CompletionItemKind.Operator ||
        existing.cursorOffsetFromEnd !== undefined ||
        existing.replacementRange !== undefined);
    merged.set(key, {
      label: item.label,
      insertText: preserveLocalWorkflowInsert
        ? existing.insertText
        : lspInsertText,
      snippet:!preserveLocalWorkflowInsert&&item.insertTextFormat===2,
      cursorOffsetFromEnd: existing?.cursorOffsetFromEnd,
      preserveInsertText:existing?.preserveInsertText,
      replacementRange: preserveLocalWorkflowInsert?existing?.replacementRange:replacementRange||existing?.replacementRange,
      detail: item.detail || existing?.detail,
      kind: item.kind || existing?.kind,
      sortText: item.sortText || existing?.sortText || `1:${key}`,
      source: "lsp",
    });
  }
  return Array.from(merged.values()).sort(
    (left, right) =>
      left.sortText.localeCompare(right.sortText) ||
      left.label.localeCompare(right.label, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
  );
}
