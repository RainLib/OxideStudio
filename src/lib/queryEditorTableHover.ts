import type { ColumnInfo, IndexInfo } from "@/services/tauri/types";

export interface QueryEditorHoverTable {
  name: string;
  tableType?: string | null;
}

/** Extract the identifier under a Monaco one-based column, including common
 * quoted SQL identifiers. It intentionally returns only the final name in a
 * qualified reference; schema selection remains owned by the active query tab. */
export function sqlIdentifierAtColumn(line: string, column: number): string | null {
  const cursor = Math.max(0, Math.min(line.length - 1, column - 1));
  if (!line || cursor >= line.length) return null;
  const quoted = [
    ['"', '"'],
    ["`", "`"],
    ["[", "]"],
  ] as const;
  for (const [open, close] of quoted) {
    const before = line.lastIndexOf(open, cursor);
    const after = line.indexOf(close, cursor + (line[cursor] === close ? 0 : 1));
    if (before >= 0 && after >= cursor && before < cursor + 1) {
      const value = line.slice(before + 1, after).trim();
      if (value) return value.split(close + close).join(close);
    }
  }
  if (!/[\p{L}\p{N}_$]/u.test(line[cursor] || "")) return null;
  let start = cursor;
  let end = cursor + 1;
  while (start > 0 && /[\p{L}\p{N}_$]/u.test(line[start - 1] || "")) start -= 1;
  while (end < line.length && /[\p{L}\p{N}_$]/u.test(line[end] || "")) end += 1;
  return line.slice(start, end) || null;
}

export function findQueryEditorHoverTable<T extends QueryEditorHoverTable>(
  tables: T[],
  identifier: string | null,
): T | null {
  if (!identifier) return null;
  return (
    tables.find((table) => table.name.localeCompare(identifier, undefined, { sensitivity: "accent" }) === 0) ||
    null
  );
}

/** Avoid replacing a column hover merely because a table happens to have the
 * same name. This intentionally stays conservative; the language server keeps
 * ownership of all other semantic contexts. */
export function isSqlRelationIdentifierContext(line: string, column: number): boolean {
  const before = line.slice(0, Math.max(0, column - 1));
  return /\b(?:from|join|update|into|table|references)\s+(?:(?:[\w$]+|"[^"]*"|`[^`]*`|\[[^\]]*\])\s*\.\s*)?(?:"|`|\[)?$/iu.test(before);
}

function marker(column: ColumnInfo): string {
  const markers = [
    column.is_primary_key ? "PK" : null,
    column.is_unique ? "UNIQUE" : null,
    column.is_nullable ? null : "NOT NULL",
    column.is_auto_increment ? "AUTO" : null,
  ].filter(Boolean);
  if (column.default_value !== null && column.default_value !== undefined) {
    markers.push(`DEFAULT ${String(column.default_value)}`);
  }
  return markers.join(" · ");
}

/** A compact markdown payload designed for Monaco's hover popup. */
export function buildQueryEditorTableHoverMarkdown(input: {
  schema: string | null | undefined;
  table: QueryEditorHoverTable;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
}): string {
  const qualifiedName = [input.schema, input.table.name].filter(Boolean).join(".");
  const visibleColumns = input.columns.slice(0, 24);
  const columnLines = visibleColumns.map((column) => {
    const detail = marker(column);
    return `| \`${column.name}\` | \`${column.data_type || "unknown"}\` | ${detail || ""} |`;
  });
  if (input.columns.length > visibleColumns.length) {
    columnLines.push(`| … | ${input.columns.length - visibleColumns.length} more columns | |`);
  }
  const visibleIndexes = input.indexes.slice(0, 3);
  const indexSummary = visibleIndexes.length
    ? `\n\nIndexes: ${visibleIndexes
        .map((index) => `\`${index.name}\` (${index.columns.join(", ")})`)
        .join(" · ")}${input.indexes.length > visibleIndexes.length ? " · …" : ""}`
    : "";
  return `**${input.table.tableType === "view" ? "View" : "Table"}** \`${qualifiedName}\`\n\n| Column | Type | Details |\n| --- | --- | --- |\n${columnLines.join("\n") || "| — | — | — |"}${indexSummary}`;
}
