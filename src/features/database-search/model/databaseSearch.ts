import type { ColumnInfo, DatabaseSearchColumn } from "@/services/tauri/types";

export const DATABASE_SEARCH_TABLE_BATCH_SIZE = 200;
export const DATABASE_SEARCH_MAX_TABLES = 50_000;
export const DATABASE_SEARCH_MAX_RESULTS = 5_000;
export const DATABASE_SEARCH_MAX_ERRORS = 200;
export const DATABASE_SEARCH_MAX_RESULT_BYTES = 8 * 1024 * 1024;

export type DatabaseSearchTableCandidate = {
  name: string;
  type?: string;
};

export function eligibleDatabaseSearchTables<T extends DatabaseSearchTableCandidate>(
  tables: readonly T[],
  maxTables = DATABASE_SEARCH_MAX_TABLES,
) {
  const limit = Math.max(1, Math.trunc(maxTables));
  const seen = new Set<string>();
  const eligible: T[] = [];
  for (const table of tables) {
    const name = table.name.trim();
    const type = table.type?.trim().toLocaleUpperCase() || "TABLE";
    if (!name || type.includes("VIEW") || seen.has(name)) continue;
    seen.add(name);
    eligible.push({ ...table, name });
    if (eligible.length >= limit) break;
  }
  return {
    tables: eligible,
    truncated: eligible.length >= limit && tables.length > eligible.length,
  };
}

export async function mapDatabaseSearchWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.trunc(concurrency)),
  );
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]!, index);
      }
    }),
  );
  return results;
}

const TEXT_TYPES = [
  "char",
  "text",
  "clob",
  "varchar",
  "nvarchar",
  "nchar",
  "uuid",
  "uniqueidentifier",
  "enum",
];
const NUMBER_TYPES = [
  "int",
  "serial",
  "number",
  "numeric",
  "decimal",
  "float",
  "double",
  "real",
  "money",
];
const SKIPPED_TYPES = [
  "blob",
  "binary",
  "bytea",
  "image",
  "geometry",
  "geography",
];

export function databaseSearchBatchRange(
  nextIndex: number,
  total: number,
  scanAllRemaining = false,
  batchSize = DATABASE_SEARCH_TABLE_BATCH_SIZE,
) {
  const safeTotal = Math.max(0, Math.trunc(total));
  const start = Math.min(Math.max(0, Math.trunc(nextIndex)), safeTotal);
  const safeBatchSize = Math.max(1, Math.trunc(batchSize));
  return {
    start,
    end: scanAllRemaining
      ? safeTotal
      : Math.min(start + safeBatchSize, safeTotal),
  };
}

export function databaseSearchNextBatchSize(
  nextIndex: number,
  total: number,
  batchSize = DATABASE_SEARCH_TABLE_BATCH_SIZE,
) {
  const range = databaseSearchBatchRange(nextIndex, total, false, batchSize);
  return range.end - range.start;
}

function normalizedType(column: Pick<ColumnInfo, "data_type">) {
  return column.data_type.toLocaleLowerCase();
}

export function isTextSearchColumn(column: Pick<ColumnInfo, "data_type">) {
  const type = normalizedType(column);
  return (
    !SKIPPED_TYPES.some((skipped) => type.includes(skipped)) &&
    TEXT_TYPES.some((textType) => type.includes(textType))
  );
}

export function isNumericSearchColumn(column: Pick<ColumnInfo, "data_type">) {
  const type = normalizedType(column);
  return (
    !SKIPPED_TYPES.some((skipped) => type.includes(skipped)) &&
    NUMBER_TYPES.some((numberType) => type.includes(numberType))
  );
}

export function databaseSearchColumn(column: ColumnInfo): DatabaseSearchColumn {
  return {
    name: column.name,
    dataType: column.data_type,
    isPrimaryKey: column.is_primary_key,
  };
}

function numericTerm(term: string) {
  const value = term.trim();
  return /^[+-]?(?:\d+|\d+\.\d+|\.\d+)$/u.test(value) ? value : null;
}

export function findMatchedSearchColumns(
  resultColumns: readonly string[],
  row: readonly unknown[],
  columns: readonly Pick<ColumnInfo, "name" | "data_type">[],
  term: string,
) {
  const query = term.trim().toLocaleLowerCase();
  const number = numericTerm(term);
  if (!query) return [];
  const columnsByName = new Map(
    columns.map((column) => [column.name.toLocaleLowerCase(), column]),
  );
  return resultColumns.filter((columnName, index) => {
    const value = row[index];
    if (value === null || value === undefined) return false;
    const column = columnsByName.get(columnName.toLocaleLowerCase());
    if (!column) return false;
    if (number && isNumericSearchColumn(column)) {
      return String(value).trim() === number;
    }
    return (
      isTextSearchColumn(column) &&
      String(value).toLocaleLowerCase().includes(query)
    );
  });
}

export function databaseSearchValuePreview(value: unknown, maxLength = 90) {
  if (value === null || value === undefined) return "NULL";
  const text = String(value).replace(/\s+/gu, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function databaseSearchRowPreview(
  resultColumns: readonly string[],
  row: readonly unknown[],
  matchedColumns: readonly string[],
) {
  const preferred = matchedColumns.length
    ? matchedColumns.slice(0, 3)
    : resultColumns.slice(0, 3);
  return preferred
    .map((column) => {
      const index = resultColumns.findIndex(
        (name) => name.toLocaleLowerCase() === column.toLocaleLowerCase(),
      );
      return index >= 0
        ? `${column}: ${databaseSearchValuePreview(row[index])}`
        : "";
    })
    .filter(Boolean)
    .join(" · ");
}

export function databaseSearchResultByteSize(
  tableLabel: string,
  preview: string,
  whereInput: string,
) {
  return new TextEncoder().encode(`${tableLabel}\0${preview}\0${whereInput}`).length;
}
