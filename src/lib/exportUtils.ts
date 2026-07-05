import { QueryResult } from "@/services/tauri";

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

export function exportToCsv(result: QueryResult, filename = "export.csv") {
  if (!result || !result.rows) return;

  const csvContent = serializeQueryResultToCsv(result);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportToJson(result: QueryResult, filename = "export.json") {
  if (!result || !result.rows) return;

  const jsonContent = serializeQueryResultToJson(result);
  const blob = new Blob([jsonContent], {
    type: "application/json;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
