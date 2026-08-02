import {
  qualifiedTableName,
  quoteIdentifier,
  quoteIdentifierWithCapabilities,
} from "@/lib/databaseDialect";
import type { CompletionItem } from "@/services/lsp/types";
import { CompletionItemKind } from "@/services/lsp/types";
import type { DatabaseDriver } from "@/services/tauri/types";

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
  /** Place the caret before this many trailing code units after insertion. */
  cursorOffsetFromEnd?: number;
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
  { label: "LIKE", insertText: "LIKE " },
  { label: "ILIKE", insertText: "ILIKE ", postgresOnly: true },
  { label: "IN", insertText: "IN (" },
  { label: "NOT IN", insertText: "NOT IN (" },
  { label: "BETWEEN", insertText: "BETWEEN " },
  { label: "IS NULL", insertText: "IS NULL " },
  { label: "IS NOT NULL", insertText: "IS NOT NULL " },
] as const;
const WHERE_VALUE_KEYWORDS = [
  "NULL",
  "TRUE",
  "FALSE",
  "CURRENT_DATE",
  "CURRENT_TIMESTAMP",
];
const WHERE_IS_PREDICATES = [
  { label: "NULL", insertText: "NULL " },
  { label: "NOT NULL", insertText: "NOT NULL " },
  { label: "TRUE", insertText: "TRUE " },
  { label: "FALSE", insertText: "FALSE " },
  { label: "UNKNOWN", insertText: "UNKNOWN " },
];
const WHERE_NOT_PREDICATES = [
  { label: "IN", insertText: "IN (" },
  { label: "LIKE", insertText: "LIKE " },
  { label: "BETWEEN", insertText: "BETWEEN " },
  { label: "NULL", insertText: "NULL " },
];
const SQL_RESERVED_IDENTIFIERS = new Set([
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

// The filter row accepts the same identifier surface as the editor: quoted
// names may contain spaces and qualified references may mix quote styles.
// A simple `\S+` or word regex would stop at `"created at"` and offer a
// second column instead of the predicate/operator that must follow it.
const SQL_IDENTIFIER_SEGMENT =
  '(?:"(?:[^"]|"")*"|`[^`]*`|\\[[^\\]]*\\]|[\\p{L}\\p{N}_$@-]+)';
const TRAILING_IDENTIFIER_REFERENCE = new RegExp(
  `(?:^|\\s)(${SQL_IDENTIFIER_SEGMENT}(?:\\s*\\.\\s*${SQL_IDENTIFIER_SEGMENT})*)$`,
  "u",
);
const TRAILING_PREDICATE_COLUMN = new RegExp(
  `(${SQL_IDENTIFIER_SEGMENT}(?:\\s*\\.\\s*${SQL_IDENTIFIER_SEGMENT})*)\\s*(?:=|<>|!=|<=|>=|<|>|\\b(?:like|ilike|between)\\b|\\b(?:not\\s+)?in\\s*\\()\\s*$`,
  "iu",
);
const PREDICATE_COLUMN_START = new RegExp(
  `(${SQL_IDENTIFIER_SEGMENT}(?:\\s*\\.\\s*${SQL_IDENTIFIER_SEGMENT})*)\\s*(?:=|<>|!=|<=|>=|<|>|\\b(?:like|ilike|between)\\b|\\b(?:not\\s+)?in\\b)`,
  "giu",
);
const COMPLETE_QUOTED_IDENTIFIER_SOURCE =
  '"(?:[^\"]|\"\")*"|`[^`]*`|\\[[^\\]]*\\]';

export function buildWhereCompletionDocument(options: {
  condition: string;
  cursorOffset: number;
  driver: DatabaseDriver;
  schema?: string | null;
  table: string;
}) {
  const relation = qualifiedTableName(
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

function unquoteIdentifierSegment(segment: string) {
  const trimmed = segment.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/gu, '"');
  }
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function trailingColumnReference(text: string) {
  const reference = text.trimEnd().match(TRAILING_IDENTIFIER_REFERENCE)?.[1];
  if (!reference) return null;
  const segments = reference.match(new RegExp(SQL_IDENTIFIER_SEGMENT, "gu"));
  const last = segments?.[segments.length - 1];
  return last ? unquoteIdentifierSegment(last).toLocaleLowerCase() : null;
}

function predicateColumnBeforeCursor(
  text: string,
  columns: Array<{ name: string; type?: string }>,
) {
  const trailingReference = text.match(TRAILING_PREDICATE_COLUMN)?.[1];
  const references = Array.from(text.matchAll(PREDICATE_COLUMN_START));
  const reference =
    trailingReference || references[references.length - 1]?.[1];
  if (!reference) return undefined;
  const name = trailingColumnReference(reference);
  if (!name) return undefined;
  return columns.find(
    (column) => column.name.toLocaleLowerCase() === name,
  );
}

function predicateValueCandidates(columnType?: string) {
  const type = columnType?.toLocaleLowerCase() || "";
  if (/\b(?:bool|boolean|bit)\b/u.test(type)) {
    return [
      { label: "TRUE", insertText: "TRUE " },
      { label: "FALSE", insertText: "FALSE " },
      { label: "NULL", insertText: "NULL " },
    ];
  }
  if (/\b(?:date|time|timestamp|interval)\b/u.test(type)) {
    return [
      { label: "CURRENT_DATE", insertText: "CURRENT_DATE " },
      { label: "CURRENT_TIMESTAMP", insertText: "CURRENT_TIMESTAMP " },
      { label: "NULL", insertText: "NULL " },
    ];
  }
  if (/\b(?:int|serial|numeric|decimal|number|float|double|real|money)\b/u.test(type)) {
    return [
      { label: "0", insertText: "0 " },
      { label: "1", insertText: "1 " },
      { label: "NULL", insertText: "NULL " },
    ];
  }
  if (/\b(?:char|varchar|nvarchar|nchar|text|string|clob|json|xml|uuid)\b/u.test(type)) {
    return [
      { label: "''", insertText: "'' " },
      { label: "'%…%'", insertText: "'%%' ", cursorOffsetFromEnd: 3 },
      { label: "NULL", insertText: "NULL " },
    ];
  }
  return WHERE_VALUE_KEYWORDS.map((label) => ({
    label,
    insertText: `${label} `,
  }));
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

export function localWhereCompletionCandidates(options: {
  condition: string;
  cursorOffset: number;
  driver: DatabaseDriver;
  identifierQuote?: string;
  columns: Array<{ name: string; type?: string }>;
}) {
  const replacement = whereReplacementRange(
    options.condition,
    options.cursorOffset,
  );
  const typed = completionFilterText(
    options.condition.slice(replacement.start, options.cursorOffset),
  );
  const beforeToken = options.condition.slice(0, replacement.start).trimEnd();
  const beforeCursor = options.condition.slice(0, options.cursorOffset);
  const normalizedColumns = new Set(
    options.columns.map((column) => column.name.toLocaleLowerCase()),
  );
  const lastIdentifier = trailingColumnReference(beforeToken);
  const afterColumn = Boolean(
    lastIdentifier && normalizedColumns.has(lastIdentifier),
  );
  const betweenNeedsSeparator =
    /\bbetween\s+(?:[^\s,()]+|'(?:''|[^'])*'|"(?:""|[^"])*")\s*$/iu.test(
      beforeCursor,
    );
  const betweenNeedsUpperValue =
    /\bbetween\s+(?:[^\s,()]+|'(?:''|[^'])*'|"(?:""|[^"])*")\s+and\s*$/iu.test(
      beforeCursor,
    );
  const insideInList = /\b(?:not\s+)?in\s*\([^)]*$/iu.test(beforeCursor);
  const afterInComma = insideInList && /,\s*$/u.test(beforeCursor);
  const afterInValue =
    insideInList &&
    !afterInComma &&
    /(?:'(?:''|[^'])*'|"(?:""|[^"])*"|\b(?:true|false|null|current_date|current_timestamp)\b|[-+]?\d+(?:\.\d+)?)\s*$/iu.test(
      beforeCursor,
    );
  const afterNullPredicate = /\bis\s+(?:not\s+)?null\s*$/iu.test(beforeCursor);
  const afterIsKeyword = /\bis\s*$/iu.test(beforeCursor);
  const afterNotKeyword = /\bnot\s*$/iu.test(beforeCursor);
  const afterCompletedExpression =
    afterNullPredicate ||
    (!afterColumn &&
      !betweenNeedsSeparator &&
      !betweenNeedsUpperValue &&
      !insideInList &&
      /(?:['"\d)]|\b(?:true|false|null|current_date|current_timestamp))$/iu.test(
        beforeToken,
      ));
  const afterPredicateOperator =
    /(?:=|<>|!=|<=|>=|<|>|\b(?:like|ilike|between))\s*$/iu.test(beforeToken) ||
    /\b(?:not\s+)?in\s*\(\s*$/iu.test(beforeCursor) ||
    betweenNeedsUpperValue ||
    afterInComma;
  const predicateColumn = predicateColumnBeforeCursor(beforeCursor, options.columns);

  const keywordCandidates = (
    keywords: Array<
      | string
      | {
          label: string;
          insertText: string;
          cursorOffsetFromEnd?: number;
        }
    >,
    detail: string,
    sortGroup: string,
  ) =>
    keywords
      .filter((keyword) =>
        Number.isFinite(
          fuzzyScore(typeof keyword === "string" ? keyword : keyword.label, typed),
        ),
      )
      .map((keyword, index) => ({
        label: typeof keyword === "string" ? keyword : keyword.label,
        insertText:
          typeof keyword === "string" ? `${keyword} ` : keyword.insertText,
        cursorOffsetFromEnd:
          typeof keyword === "string"
            ? undefined
            : keyword.cursorOffsetFromEnd,
        detail,
        kind: CompletionItemKind.Keyword,
        sortText: `${sortGroup}:${String(index).padStart(4, "0")}`,
        source: "local" as const,
      }));

  if (betweenNeedsSeparator) {
    return keywordCandidates(
      [{ label: "AND", insertText: "AND " }],
      "BETWEEN range separator",
      "0",
    );
  }
  if (afterInValue) {
    return keywordCandidates(
      [
        { label: ",", insertText: ", " },
        { label: ")", insertText: ") " },
      ],
      "IN list continuation",
      "0",
    );
  }
  if (afterCompletedExpression) {
    return keywordCandidates(WHERE_FOLLOW_UPS, "WHERE continuation", "0");
  }
  if (afterIsKeyword) {
    return keywordCandidates(WHERE_IS_PREDICATES, "IS predicate", "0");
  }
  if (afterNotKeyword) {
    return keywordCandidates(WHERE_NOT_PREDICATES, "NOT predicate", "0");
  }
  if (afterPredicateOperator) {
    return keywordCandidates(
      predicateValueCandidates(predicateColumn?.type),
      predicateColumn?.type
        ? `${predicateColumn.type} predicate value`
        : "Predicate value",
      "0",
    );
  }
  if (afterColumn) {
    return WHERE_OPERATORS.filter(
      (operator) =>
        !("postgresOnly" in operator) ||
        !operator.postgresOnly ||
        options.driver === "postgres",
    ).map((operator, index) => ({
      label: operator.label,
      insertText: operator.insertText,
      detail: "Predicate operator",
      kind: CompletionItemKind.Operator,
      sortText: `0:${String(index).padStart(4, "0")}`,
      source: "local" as const,
    }));
  }

  const columns = options.columns
    .map((column) => ({
      column,
      score: fuzzyScore(column.name, typed),
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.column.name.localeCompare(right.column.name, undefined, {
          sensitivity: "base",
          numeric: true,
        }),
    )
    .map(({ column }, index) => ({
      label: column.name,
      insertText: `${safeColumnInsertText(
        options.driver,
        column.name,
        options.identifierQuote,
      )} = `,
      detail: column.type ? `${column.type} · current table` : "Current table column",
      kind: CompletionItemKind.Field,
      sortText: `0:${String(index).padStart(4, "0")}`,
      source: "local" as const,
    }));

  return columns;
}

export function mergeWhereCompletionCandidates(
  local: WhereCompletionCandidate[],
  lspItems: CompletionItem[],
) {
  const merged = new Map<string, WhereCompletionCandidate>();
  for (const candidate of local) {
    merged.set(candidate.label.toLocaleLowerCase(), candidate);
  }
  for (const item of lspItems) {
    const key = item.label.toLocaleLowerCase();
    const existing = merged.get(key);
    const lspInsertText = item.textEdit?.newText || item.insertText || item.label;
    const preserveLocalWorkflowInsert =
      existing?.source === "local" &&
      (existing.kind === CompletionItemKind.Field ||
        existing.kind === CompletionItemKind.Operator);
    merged.set(key, {
      label: item.label,
      insertText: preserveLocalWorkflowInsert
        ? existing.insertText
        : lspInsertText,
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
