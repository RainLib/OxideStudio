import { QueryResult } from "@/services/tauri";

export type QueryResultExportFormat =
  | "csv"
  | "csvBom"
  | "json"
  | "jsonl"
  | "tsv"
  | "sql";

function columnLabel(result: QueryResult, index: number) {
  return result.columns[index]?.name || `column_${index + 1}`;
}

function jsonColumnKeys(result: QueryResult) {
  const seen = new Map<string, number>();

  return result.columns.map((_, index) => {
    const base = columnLabel(result, index);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

export function queryResultCellValue(
  result: QueryResult,
  rowIndex: number,
  columnIndex: number
) {
  const row = result.rows[rowIndex] as unknown;
  if (Array.isArray(row)) return row[columnIndex];

  if (row && typeof row === "object") {
    const record = row as Record<string, unknown>;
    return record[columnLabel(result, columnIndex)] ?? record[columnIndex];
  }

  return undefined;
}

function stringifyExportValue(value: unknown) {
  if (value == null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function escapeCsvValue(value: unknown) {
  const text = stringifyExportValue(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function escapeTsvValue(value: unknown) {
  return stringifyExportValue(value).replace(/[\t\r\n]+/g, " ");
}

export function queryResultRowsToObjects(result: QueryResult) {
  const keys = jsonColumnKeys(result);
  return result.rows.map((_, rowIndex) =>
    Object.fromEntries(
      keys.map((key, columnIndex) => [
        key,
        queryResultCellValue(result, rowIndex, columnIndex),
      ])
    )
  );
}

export function serializeQueryResultToCsv(result: QueryResult) {
  const headers = result.columns.map((_, index) =>
    escapeCsvValue(columnLabel(result, index))
  );
  const rows = result.rows.map((_, rowIndex) =>
    result.columns
      .map((_, columnIndex) =>
        escapeCsvValue(queryResultCellValue(result, rowIndex, columnIndex))
      )
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

export function serializeQueryResultToJson(result: QueryResult) {
  return JSON.stringify(queryResultRowsToObjects(result), null, 2);
}

export function serializeQueryResultToJsonLines(result: QueryResult) {
  return queryResultRowsToObjects(result)
    .map((row) => JSON.stringify(row))
    .join("\n");
}

export function serializeQueryResultToTsv(result: QueryResult) {
  return serializeQueryResultSelectionToTsv(
    result,
    result.rows.map((_, index) => index),
    result.columns.map((_, index) => index),
    true,
  );
}

function quoteSqlExportIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function sqlExportLiteral(value: unknown) {
  if (value == null) return "NULL";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = stringifyExportValue(value);
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * Produces portable INSERT statements for an ad-hoc query result. Because a
 * query can combine multiple relations, the target is intentionally a clear
 * placeholder instead of guessing from the editor title.
 */
export function serializeQueryResultToSql(
  result: QueryResult,
  targetTable = "target_table",
) {
  if (result.columns.length === 0 || result.rows.length === 0) {
    return "-- No rows to export.\n";
  }

  const columnList = jsonColumnKeys(result)
    .map(quoteSqlExportIdentifier)
    .join(", ");
  const table = quoteSqlExportIdentifier(targetTable);
  const statements: string[] = [
    "-- Review the target table name and column mapping before execution.",
  ];
  const batchSize = 500;
  for (let start = 0; start < result.rows.length; start += batchSize) {
    const values = result.rows
      .slice(start, start + batchSize)
      .map((_, batchIndex) => {
        const rowIndex = start + batchIndex;
        return `(${result.columns
          .map((__, columnIndex) =>
            sqlExportLiteral(
              queryResultCellValue(result, rowIndex, columnIndex),
            ),
          )
          .join(", ")})`;
      });
    statements.push(
      `INSERT INTO ${table} (${columnList})\nVALUES\n${values.join(",\n")};`,
    );
  }
  return `${statements.join("\n\n")}\n`;
}

export function serializeQueryResultSelectionToTsv(
  result: QueryResult,
  rowIndexes: number[],
  columnIndexes: number[],
  includeHeaders = false
) {
  const lines: string[] = [];

  if (includeHeaders) {
    lines.push(
      columnIndexes
        .map((index) => escapeTsvValue(columnLabel(result, index)))
        .join("\t")
    );
  }

  for (const rowIndex of rowIndexes) {
    lines.push(
      columnIndexes
        .map((columnIndex) =>
          escapeTsvValue(queryResultCellValue(result, rowIndex, columnIndex))
        )
        .join("\t")
    );
  }

  return lines.join("\n");
}

export function downloadText(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportToCsv(result: QueryResult, filename = "export.csv") {
  if (!result || !result.rows) return;
  downloadText(
    serializeQueryResultToCsv(result),
    filename,
    "text/csv;charset=utf-8",
  );
}

export function exportToJson(result: QueryResult, filename = "export.json") {
  if (!result || !result.rows) return;

  downloadText(
    serializeQueryResultToJson(result),
    filename,
    "application/json;charset=utf-8",
  );
}

export function exportQueryResult(
  result: QueryResult,
  format: QueryResultExportFormat,
  filename: string,
) {
  if (!result || !result.rows) return;
  switch (format) {
    case "csv":
      return downloadText(
        serializeQueryResultToCsv(result),
        filename,
        "text/csv;charset=utf-8",
      );
    case "csvBom":
      return downloadText(
        `\uFEFF${serializeQueryResultToCsv(result)}`,
        filename,
        "text/csv;charset=utf-8",
      );
    case "json":
      return downloadText(
        serializeQueryResultToJson(result),
        filename,
        "application/json;charset=utf-8",
      );
    case "jsonl":
      return downloadText(
        serializeQueryResultToJsonLines(result),
        filename,
        "application/x-ndjson;charset=utf-8",
      );
    case "tsv":
      return downloadText(
        serializeQueryResultToTsv(result),
        filename,
        "text/tab-separated-values;charset=utf-8",
      );
    case "sql":
      return downloadText(
        serializeQueryResultToSql(result),
        filename,
        "application/sql;charset=utf-8",
      );
  }
}
