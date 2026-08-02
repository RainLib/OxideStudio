import type { QueryResult } from "@/services/tauri/types";

/**
 * Builds a display-only result where source columns become rows.
 *
 * The Data Editor uses this only as a read-only inspection surface. It never
 * maps edits back to the source result, so table mutation and paging semantics
 * remain attached to the normal orientation.
 */
export function transposeQueryResult(result: QueryResult): QueryResult {
  return {
    columns: [
      { name: "Field", data_type: "TEXT" },
      ...result.rows.map((_, index) => ({
        name: `Row ${index + 1}`,
        data_type: "",
      })),
    ],
    rows: result.columns.map((column, columnIndex) => [
      column.data_type
        ? `${column.name} (${column.data_type})`
        : column.name,
      ...result.rows.map((row) => row[columnIndex]),
    ]),
    truncated: result.truncated,
    rowLimit: result.rowLimit,
    statementType: result.statementType,
    message: result.message,
  };
}
