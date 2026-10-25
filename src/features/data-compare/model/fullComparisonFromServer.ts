import {
  type DataCompareResult,
  type DataCompareRow,
  type DataCompareSource,
} from "@/lib/dataCompare";
import { type TableDataCompareResult } from "@/services/tauri";

export function fullComparisonFromServer(
  result: TableDataCompareResult,
  left: DataCompareSource,
  right: DataCompareSource,
  keyColumns: string[],
  sharedColumns: string[],
): DataCompareResult {
  const leftIndexes = new Map(
    left.columns.map((column, index) => [column.name, index]),
  );
  const rightIndexes = new Map(
    right.columns.map((column, index) => [column.name, index]),
  );
  const toRow = (values: Record<string, unknown>, source: DataCompareSource) =>
    source.columns.map((column) => values[column.name]);
  const keyFor = (values: Record<string, unknown>) =>
    keyColumns.map((column) => ({ column, value: values[column] }));
  const rows: DataCompareRow[] = [
    ...result.added.map((row) => ({
      id: `full:left:${row.key}`,
      status: "leftOnly" as const,
      key: keyFor(row.values),
      leftRow: toRow(row.values, left),
      fields: [],
      leftMatchCount: 1,
      rightMatchCount: 0,
    })),
    ...result.removed.map((row) => ({
      id: `full:right:${row.key}`,
      status: "rightOnly" as const,
      key: keyFor(row.values),
      rightRow: toRow(row.values, right),
      fields: [],
      leftMatchCount: 0,
      rightMatchCount: 1,
    })),
    ...result.modified.map((row) => ({
      id: `full:changed:${row.key}`,
      status: "changed" as const,
      key: keyFor(row.sourceValues),
      leftRow: toRow(row.sourceValues, left),
      rightRow: toRow(row.targetValues, right),
      fields: row.changedColumns.map((column) => ({
        column,
        left: row.sourceValues[column],
        right: row.targetValues[column],
        equal: false,
        toleranceMatched: false,
      })),
      leftMatchCount: 1,
      rightMatchCount: 1,
    })),
  ];
  const leftOnlyColumns = left.columns
    .map((column) => column.name)
    .filter((column) => !rightIndexes.has(column));
  const rightOnlyColumns = right.columns
    .map((column) => column.name)
    .filter((column) => !leftIndexes.has(column));
  return {
    rows,
    keyColumns,
    comparedColumns: sharedColumns.filter(
      (column) => !keyColumns.includes(column),
    ),
    leftOnlyColumns,
    rightOnlyColumns,
    typeMismatchColumns: [],
    counts: {
      equal: result.equalCount,
      changed: result.modifiedCount,
      leftOnly: result.addedCount,
      rightOnly: result.removedCount,
      duplicate: 0,
    },
    comparedKeyCount: result.comparedKeyCount,
    warnings: [
      ...(result.degradationLevel === "full"
        ? [
            "Full table comparison ran in the host process. Counts are exact; equal rows are counted but not materialized in the result list.",
          ]
        : result.degradationLevel === "sample"
          ? [
              `The tables exceeded the full-compare ceiling. Oxide inspected ${result.sampledKeyCount.toLocaleString()} ${result.samplingStrategy === "stratified" ? "deterministic keys across ordered strata" : "deterministic first/last keys"} (${(result.samplingRate * 100).toFixed(2)}% minimum per-table row coverage); difference counts and checksums describe only that sampled key universe.`,
              "Deterministic sampling is not random, so Oxide does not claim a statistical confidence score or whole-table equality. Unsampled differences can remain, and changing tables require a fresh comparison.",
            ]
          : [
              "The tables exceed the safe sampling ceiling. Only exact row counts were read; no row-level comparison or equality claim was produced.",
            ]),
      ...(result.detailsTruncated
        ? [
            `Difference details are limited to ${result.detailLimitPerStatus.toLocaleString()} rows per status. ${result.countsExact ? "Counts above remain exact." : "Sample-local counts above remain complete for the inspected keys."}`,
          ]
        : []),
    ],
  };
}
