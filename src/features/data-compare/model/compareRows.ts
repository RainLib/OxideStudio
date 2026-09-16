export const DISPLAY_LIMIT = 2_000;

import {
  type DataCompareFieldDifference,
  type DataCompareRow,
  type DataCompareRowStatus,
  type DataCompareSource,
} from "@/lib/dataCompare";

export interface FlatCompareLine {
  id: string;
  logicalRowId: string;
  firstForLogicalRow: boolean;
  status: DataCompareRowStatus;
  key: string;
  column: string;
  left: string;
  right: string;
  toleranceMatched: boolean;
}

export function flattenRows(
  rows: DataCompareRow[],
  left: DataCompareSource,
  right: DataCompareSource,
  showEqual: boolean,
  query: string,
) {
  const lines = rows.flatMap<FlatCompareLine>((row) => {
    if (row.status === "equal" && !showEqual) return [];
    const key = row.key
      .map((item) => `${item.column}=${formatValue(item.value)}`)
      .join(" · ");
    if (row.status === "changed") {
      return row.fields
        .filter((field) => !field.equal)
        .map((field, index) => fieldLine(row, key, field, index === 0));
    }
    if (row.status === "equal") {
      const tolerant = row.fields.filter((field) => field.toleranceMatched);
      return [
        {
          id: `${row.id}:equal`,
          logicalRowId: row.id,
          firstForLogicalRow: true,
          status: row.status,
          key,
          column:
            tolerant.length > 0
              ? `${tolerant.length} within tolerance`
              : "All shared fields",
          left: "Equal",
          right: "Equal",
          toleranceMatched: tolerant.length > 0,
        },
      ];
    }
    if (row.status === "duplicate") {
      return [
        {
          id: `${row.id}:duplicate`,
          logicalRowId: row.id,
          firstForLogicalRow: true,
          status: row.status,
          key,
          column: "Ambiguous key",
          left: `${row.leftMatchCount} matching rows`,
          right: `${row.rightMatchCount} matching rows`,
          toleranceMatched: false,
        },
      ];
    }
    return [
      {
        id: `${row.id}:${row.status}`,
        logicalRowId: row.id,
        firstForLogicalRow: true,
        status: row.status,
        key,
        column: "Loaded row",
        left: row.leftRow ? formatRow(left, row.leftRow) : "—",
        right: row.rightRow ? formatRow(right, row.rightRow) : "—",
        toleranceMatched: false,
      },
    ];
  });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return normalizedQuery
    ? lines.filter((line) =>
        [line.key, line.column, line.left, line.right].some((value) =>
          value.toLocaleLowerCase().includes(normalizedQuery),
        ),
      )
    : lines;
}

export function fieldLine(
  row: DataCompareRow,
  key: string,
  field: DataCompareFieldDifference,
  firstForLogicalRow: boolean,
): FlatCompareLine {
  return {
    id: `${row.id}:${field.column}`,
    logicalRowId: row.id,
    firstForLogicalRow,
    status: row.status,
    key,
    column: field.column,
    left: formatValue(field.left),
    right: formatValue(field.right),
    toleranceMatched: field.toleranceMatched,
  };
}

export function formatRow(source: DataCompareSource, row: unknown[]) {
  return formatValue(
    Object.fromEntries(
      source.columns.map((column, index) => [column.name, row[index]]),
    ),
  );
}

export function formatValue(value: unknown) {
  if (value === null) return "NULL";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value === "" ? '""' : bound(value);
  if (typeof value === "object") {
    try {
      return bound(JSON.stringify(value));
    } catch {
      return "[unserializable value]";
    }
  }
  return bound(String(value));
}

export function bound(value: string) {
  return value.length > 320 ? `${value.slice(0, 317)}…` : value;
}
