import type { NewGridRowPlacement } from "@/lib/dataGridRows";
import { QueryResult } from "@/services/tauri";
import type { ColumnDef, ColumnInfo, IndexInfo } from "@/services/tauri/types";

export function mutationKeyColumns(
  columns: ColumnInfo[] | undefined,
  indexes: IndexInfo[] | undefined,
  resultColumns: ColumnDef[],
) {
  const tableColumns = columns || [];
  const resultColumnNames = new Set(resultColumns.map((column) => column.name));
  const byName = new Map(tableColumns.map((column) => [column.name, column]));
  const primaryKeyColumns = tableColumns.filter(
    (column) => column.is_primary_key && resultColumnNames.has(column.name),
  );

  if (primaryKeyColumns.length > 0) {
    return primaryKeyColumns;
  }

  const usableUniqueIndexes = (indexes || [])
    .filter((index) => index.is_unique && index.columns.length > 0)
    .map((index) => ({
      index,
      columns: index.columns
        .map((columnName) => byName.get(columnName))
        .filter((column): column is ColumnInfo => Boolean(column)),
    }))
    .filter(
      ({ index, columns }) =>
        columns.length === index.columns.length &&
        columns.every((column) => resultColumnNames.has(column.name)),
    )
    .map(({ columns }) => columns)
    .sort((left, right) => left.length - right.length);

  if (usableUniqueIndexes[0]) {
    return usableUniqueIndexes[0];
  }

  const uniqueColumns = tableColumns.filter(
    (column) =>
      !column.is_primary_key &&
      column.is_unique &&
      resultColumnNames.has(column.name),
  );

  // Column-level uniqueness is ambiguous for composite unique constraints.
  return uniqueColumns.length === 1 ? uniqueColumns : [];
}

export function rowMutationKey(
  row: unknown[],
  resultColumns: ColumnDef[],
  keyColumns: ColumnInfo[],
) {
  const key: Record<string, unknown> = {};

  for (const keyColumn of keyColumns) {
    const keyIndex = resultColumns.findIndex(
      (column) => column.name === keyColumn.name,
    );
    if (keyIndex === -1) return null;

    const value = row[keyIndex];
    if (value === null || value === undefined) return null;
    key[keyColumn.name] = value;
  }

  return Object.keys(key).length === keyColumns.length ? key : null;
}

export function missingMutationKeyMessage(
  action: "update" | "delete",
  table: string,
) {
  const operation = action === "update" ? "update rows in" : "delete rows from";
  return `Cannot ${operation} "${table}" because no primary key or usable unique index is available.`;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function mutationRefreshError(
  operation: "save" | "delete",
  details?: string | null,
) {
  const completedAction =
    operation === "save" ? "Changes were saved" : "Rows were deleted";
  const detailSuffix = details ? ` Details: ${details}` : "";
  return `${completedAction}, but the table could not be refreshed. Click Refresh to load the latest data.${detailSuffix}`;
}

export function mutationPreservedDraftsMessage(operation: "save" | "delete") {
  const completedAction =
    operation === "save" ? "Changes were saved" : "Rows were deleted";
  return `${completedAction}. Other unsaved table changes were preserved; submit or revert them before refreshing.`;
}

export function resultsAfterSubmittedEdits(
  results: QueryResult[] | null,
  submittedEdits: Map<string, any>,
) {
  if (!results?.[0] || submittedEdits.size === 0) return results;

  const rows = results[0].rows.map((row) => [...row]);
  for (const [key, value] of submittedEdits) {
    const separatorIndex = key.indexOf(":");
    const rowIndex = Number.parseInt(key.slice(0, separatorIndex), 10);
    const columnIndex = Number.parseInt(key.slice(separatorIndex + 1), 10);
    if (
      separatorIndex === -1 ||
      Number.isNaN(rowIndex) ||
      Number.isNaN(columnIndex) ||
      rowIndex < 0 ||
      !rows[rowIndex]
    ) {
      continue;
    }
    rows[rowIndex]![columnIndex] = value;
  }

  return results.map((result, index) =>
    index === 0 ? { ...result, rows } : result,
  );
}

export function pendingEditsAfterRowDeletion(
  pendingEdits: Map<string, any> | undefined,
  deletedRowIndexes: number[],
) {
  const nextEdits = new Map<string, any>();
  const deletedRows = new Set(deletedRowIndexes);

  for (const [key, value] of pendingEdits || []) {
    const separatorIndex = key.indexOf(":");
    const rowIndex = Number.parseInt(key.slice(0, separatorIndex), 10);
    const columnIndex = key.slice(separatorIndex + 1);

    if (separatorIndex === -1 || Number.isNaN(rowIndex) || rowIndex < 0) {
      nextEdits.set(key, value);
      continue;
    }
    if (deletedRows.has(rowIndex)) continue;

    const precedingDeletedRows = deletedRowIndexes.filter(
      (deletedRowIndex) => deletedRowIndex < rowIndex,
    ).length;
    nextEdits.set(`${rowIndex - precedingDeletedRows}:${columnIndex}`, value);
  }

  return nextEdits;
}

export function newRowPlacementsAfterRowDeletion(
  placements: Array<NewGridRowPlacement | null> | undefined,
  deletedRowIndexes: number[],
) {
  const deletedRows = new Set(deletedRowIndexes);
  return (placements || []).map((placement) => {
    if (!placement || placement.anchorRowKey < 0) return placement || null;
    if (deletedRows.has(placement.anchorRowKey)) return null;
    const precedingDeletedRows = deletedRowIndexes.filter(
      (deletedRowIndex) => deletedRowIndex < placement.anchorRowKey,
    ).length;
    return {
      ...placement,
      anchorRowKey: placement.anchorRowKey - precedingDeletedRows,
    };
  });
}

export function tableDraftsAfterSuccessfulSave(
  pendingEdits: Map<string, any> | undefined,
  newRowsCount: number | undefined,
  newRowPlacements: Array<NewGridRowPlacement | null> | undefined,
  submittedEdits: Map<string, any>,
  insertedRowIndexes: Set<number>,
) {
  const insertedOffsets = Array.from(insertedRowIndexes)
    .map((rowIndex) => -rowIndex - 1)
    .filter((offset) => offset >= 0 && offset < (newRowsCount || 0))
    .sort((left, right) => left - right);
  const insertedOffsetSet = new Set(insertedOffsets);
  const nextEdits = new Map<string, any>();

  for (const [key, value] of pendingEdits || []) {
    const separatorIndex = key.indexOf(":");
    const rowIndex = Number.parseInt(key.slice(0, separatorIndex), 10);
    const columnIndex = key.slice(separatorIndex + 1);

    if (separatorIndex === -1 || Number.isNaN(rowIndex)) {
      nextEdits.set(key, value);
      continue;
    }

    if (rowIndex >= 0) {
      if (
        submittedEdits.has(key) &&
        Object.is(submittedEdits.get(key), value)
      ) {
        continue;
      }
      nextEdits.set(key, value);
      continue;
    }

    const rowOffset = -rowIndex - 1;
    if (insertedOffsetSet.has(rowOffset)) continue;

    const precedingInsertedRows = insertedOffsets.filter(
      (insertedOffset) => insertedOffset < rowOffset,
    ).length;
    nextEdits.set(
      `${-1 - (rowOffset - precedingInsertedRows)}:${columnIndex}`,
      value,
    );
  }

  const nextPlacements = (newRowPlacements || [])
    .map((placement, offset) => ({ placement, offset }))
    .filter(({ offset }) => !insertedOffsetSet.has(offset))
    .map(({ placement }) => {
      if (!placement || placement.anchorRowKey >= 0) return placement || null;
      const anchorOffset = -placement.anchorRowKey - 1;
      if (insertedOffsetSet.has(anchorOffset)) return null;
      const precedingInsertedRows = insertedOffsets.filter(
        (insertedOffset) => insertedOffset < anchorOffset,
      ).length;
      return {
        ...placement,
        anchorRowKey: -1 - (anchorOffset - precedingInsertedRows),
      };
    });

  return {
    pendingEdits: nextEdits,
    newRowsCount: Math.max(0, (newRowsCount || 0) - insertedOffsets.length),
    newRowPlacements: nextPlacements,
  };
}
