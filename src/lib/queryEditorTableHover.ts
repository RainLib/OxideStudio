import type { ColumnInfo, IndexInfo } from "@/services/tauri/types";

export interface QueryEditorHoverTable {
  name: string;
  tableType?: string | null;
}

const HOVER_TEXT_LIMIT = 160;
const HOVER_INDEX_COLUMN_LIMIT = 8;
const HOVER_DDL_CHAR_LIMIT = 24 * 1024;
const HOVER_DDL_LINE_LIMIT = 160;

function compactHoverText(value: unknown, limit = HOVER_TEXT_LIMIT): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

/** Monaco renders this as Markdown, so database-owned identifiers cannot
 * change the structure of the hover table. */
function hoverCode(value: unknown): string {
  return `\`${compactHoverText(value).replace(/`/g, "\\`").replace(/\|/g, "\\|")}\``;
}

function compactIndexColumns(columns: string[]): string {
  const visible = columns.slice(0, HOVER_INDEX_COLUMN_LIMIT).map((column) => hoverCode(column));
  if (columns.length > visible.length) visible.push(`… +${columns.length - visible.length}`);
  return visible.join(", ");
}

export function boundedHoverDdl(value: string): {
  text: string;
  truncated: boolean;
} {
  const normalized = value.trim();
  if (!normalized) return { text: "", truncated: false };
  const lines = normalized.split(/\r?\n/u);
  const visibleLines = lines.slice(0, HOVER_DDL_LINE_LIMIT);
  let text = visibleLines.join("\n");
  let truncated = lines.length > visibleLines.length;
  const characters = Array.from(text);
  if (characters.length > HOVER_DDL_CHAR_LIMIT) {
    text = characters.slice(0, HOVER_DDL_CHAR_LIMIT).join("");
    truncated = true;
  }
  return { text, truncated };
}

function markdownSqlFence(sql: string): string {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(sql.matchAll(/`+/gu), (match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}sql\n${sql}\n${fence}`;
}

/** Extract the identifier under a Monaco one-based column, including common
 * quoted SQL identifiers. It intentionally returns only the final name in a
 * qualified reference; schema selection remains owned by the active query tab. */
export function sqlIdentifierAtColumn(line: string, column: number): string | null {
  const cursor = Math.max(0, Math.min(line.length - 1, column - 1));
  if (!line || cursor >= line.length) return null;
  const quoted = [["\"", "\""], ["`", "`"], ["[", "]"]] as const;
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
  return tables.find((table) => table.name.localeCompare(identifier, undefined, { sensitivity: "accent" }) === 0) || null;
}

/** Avoid replacing a column hover merely because a table happens to have the
 * same name. The language server owns all other semantic contexts. */
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
    markers.push(`DEFAULT ${hoverCode(column.default_value)}`);
  }
  return markers.join(" · ");
}

/** A compact, bounded markdown payload designed for Monaco's hover popup. */
export function buildQueryEditorTableHoverMarkdown(input: {
  schema: string | null | undefined;
  table: QueryEditorHoverTable;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  ddl?: string | null;
}): string {
  const qualifiedName = [input.schema, input.table.name].filter(Boolean).map(hoverCode).join(".");
  const visibleColumns = input.columns.slice(0, 24);
  const columnLines = visibleColumns.map((column) => {
    const detail = marker(column);
    return `| ${hoverCode(column.name)} | ${hoverCode(column.data_type || "unknown")} | ${detail || ""} |`;
  });
  if (input.columns.length > visibleColumns.length) {
    columnLines.push(`| … | ${input.columns.length - visibleColumns.length} more columns | |`);
  }
  const visibleIndexes = input.indexes.slice(0, 3);
  const indexSummary = visibleIndexes.length
    ? `\n\nIndexes: ${visibleIndexes
      .map((index) => `${hoverCode(index.name)} (${compactIndexColumns(index.columns)})`)
      .join(" · ")}${input.indexes.length > visibleIndexes.length ? " · …" : ""}`
    : "";
  const ddl = boundedHoverDdl(input.ddl || "");
  const ddlPreview = ddl.text
    ? `\n\n**DDL preview**\n\n${markdownSqlFence(ddl.text)}${
        ddl.truncated
          ? "\n\n_Preview truncated. Open the table DDL tab and use Ctrl/Cmd+F to search the full definition._"
          : ""
      }`
    : "";
  return `**${input.table.tableType === "view" ? "View" : "Table"}** ${qualifiedName}\n\n| Column | Type | Details |\n| --- | --- | --- |\n${columnLines.join("\n") || "| … | … | … |"}${indexSummary}${ddlPreview}`;
}
