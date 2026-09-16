import {
  indexColumnList,
  normalizeIdentifier,
  normalizeRelationName,
  parenthesizedContent,
} from "@/features/schema-diff/model/project-ddl/identifiers";
import type { IndexInfo } from "@/services/tauri/types";

export function parseCreateIndex(statement: string, fallbackSchema: string) {
  const match = statement.match(
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(.+?)\s+ON\s+([^\s(]+)\s*/i,
  );
  if (!match) return null;
  const table = normalizeRelationName(match[3] || "", fallbackSchema);
  const name = normalizeIdentifier(match[2] || "");
  const columnGroup = parenthesizedContent(statement.slice(match[0].length));
  const columns = indexColumnList(columnGroup?.content || "");
  if (!table || !name || columns.length === 0) return null;
  return {
    table,
    index: { name, columns, is_unique: Boolean(match[1]), is_primary: false },
  };
}

export function parseCreateTableIndex(
  entry: string,
  table: string,
): IndexInfo | null {
  const header = entry.match(
    /^(UNIQUE\s+)?(?:(FULLTEXT|SPATIAL)\s+)?(?:KEY|INDEX)\s+([^\s(]+)\s*(?:USING\s+([A-Za-z0-9_]+)\s*)?/i,
  );
  if (!header) return null;
  const columnGroup = parenthesizedContent(entry.slice(header[0].length));
  const name = normalizeIdentifier(header[3] || "");
  const columns = indexColumnList(columnGroup?.content || "");
  if (!name || columns.length === 0) return null;
  const trailingType = columnGroup?.trailing.match(
    /^\s*USING\s+([A-Za-z0-9_]+)/i,
  )?.[1];
  const indexType = header[2] || header[4] || trailingType;
  return {
    name,
    columns,
    is_unique: Boolean(header[1]),
    is_primary: false,
    index_type: indexType?.toUpperCase(),
    definition: `${table}: ${entry.trim()}`,
  };
}
