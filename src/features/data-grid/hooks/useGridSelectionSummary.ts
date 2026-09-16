import type { DataGridSelectionSummary } from "@/features/data-grid/model/gridTypes";
import type { DataGridVisualRow } from "@/lib/dataGridRows";
import { resultColumnIndexByGridId } from "@/lib/gridColumns";
import {
  collectSelectionCoordinates,
  summarizeSelection,
} from "@/lib/selectionAggregate";
import { isTableCellExpression } from "@/lib/tableCellExpression";
import type { QueryResult } from "@/services/tauri/types/query";
import type { ColumnInfo } from "@/services/tauri/types/schemaCatalog";
import type { GridColumn, GridSelection } from "@glideapps/glide-data-grid";

import { useEffect, useMemo } from "react";

interface GridSelectionSummaryOptions {
  gridSelection: GridSelection;
  visualRows: DataGridVisualRow[];
  onSelectionSummaryChange:
    | ((summary: DataGridSelectionSummary) => void)
    | undefined;
  columns: GridColumn[];
  result: QueryResult | undefined;
  isTransposed: boolean;
  tableColumnsByName: Map<string, ColumnInfo>;
  deferredGridSelectionContext: {
    activeTabId: string | null;
    resultIndex: number;
    selection: GridSelection;
  };
  activeTabId: string | null;
  resultIndex: number;
  pendingEdits: Map<string, unknown>;
}

export function useGridSelectionSummary({
  gridSelection,
  visualRows,
  onSelectionSummaryChange,
  columns,
  result,
  isTransposed,
  tableColumnsByName,
  deferredGridSelectionContext,
  activeTabId,
  resultIndex,
  pendingEdits,
}: GridSelectionSummaryOptions) {
  const selectedRowIndexes = useMemo(
    () =>
      gridSelection.rows
        .toArray()
        .map((row) => visualRows[row]?.rowKey)
        .filter(
          (rowIndex): rowIndex is number =>
            rowIndex !== undefined && rowIndex >= 0,
        ),
    [gridSelection.rows, visualRows],
  );

  useEffect(() => {
    onSelectionSummaryChange?.({
      selectedRowCount: selectedRowIndexes.length,
    });
  }, [onSelectionSummaryChange, selectedRowIndexes.length]);

  const aggregateColumnMetadata = useMemo(
    () =>
      columns.map((visualColumn) => {
        const originalColumnIndex = result
          ? isTransposed
            ? Number(String(visualColumn.id).replace("transpose:", ""))
            : resultColumnIndexByGridId(result.columns, visualColumn.id)
          : -1;
        const resultColumn = result?.columns[originalColumnIndex];
        return {
          originalColumnIndex,
          dataType:
            resultColumn?.data_type ||
            tableColumnsByName.get(resultColumn?.name || "")?.data_type,
        };
      }),
    [columns, result, tableColumnsByName, isTransposed],
  );

  const selectionAggregate = useMemo(() => {
    if (
      !result ||
      isTransposed ||
      columns.length === 0 ||
      deferredGridSelectionContext.activeTabId !== activeTabId ||
      deferredGridSelectionContext.resultIndex !== resultIndex
    ) {
      return null;
    }
    const deferredGridSelection = deferredGridSelectionContext.selection;
    const current = deferredGridSelection.current;
    const selection = collectSelectionCoordinates({
      ranges: current ? [current.range, ...current.rangeStack] : [],
      rows: deferredGridSelection.rows.toArray(),
      columns: deferredGridSelection.columns.toArray(),
      rowCount: visualRows.length,
      columnCount: columns.length,
    });
    if (selection.coordinates.length <= 1) return null;

    const cells = selection.coordinates.map(([row, column]) => {
      const columnMetadata = aggregateColumnMetadata[column];
      if (!columnMetadata) return { value: undefined };
      const { originalColumnIndex } = columnMetadata;
      if (originalColumnIndex < 0) return { value: undefined };

      const visualRow = visualRows[row];
      if (!visualRow) return { value: undefined };
      const { isNew: isNewRow, rowKey } = visualRow;
      const editKey = `${rowKey}:${originalColumnIndex}`;
      const pendingValue = pendingEdits.has(editKey)
        ? pendingEdits.get(editKey)
        : isNewRow
          ? undefined
          : result.rows[rowKey]?.[originalColumnIndex];

      return {
        // An uncommitted expression has no observable scalar value yet, so
        // never feed it into local numeric aggregates.
        value: isTableCellExpression(pendingValue) ? undefined : pendingValue,
        dataType: columnMetadata.dataType,
      };
    });

    return summarizeSelection(cells, selection.truncated);
  }, [
    columns,
    activeTabId,
    aggregateColumnMetadata,
    deferredGridSelectionContext,
    pendingEdits,
    result,
    resultIndex,
    isTransposed,
    visualRows,
  ]);

  // Update getCellContent to handle missing result & new rows

  return { selectedRowIndexes, selectionAggregate };
}
