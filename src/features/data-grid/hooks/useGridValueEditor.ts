import type {
  DataGridDetailNavigationAxis,
  DataGridDetailNavigationDelta,
} from "@/features/data-grid/model/dataGridDetailNavigation";
import { adjacentDataGridDetailIndex } from "@/features/data-grid/model/dataGridDetailNavigation";
import type {
  GridTabSnapshot,
  GridValueEditorTarget,
} from "@/features/data-grid/model/gridTypes";
import {
  tableColumnEditability,
  tableColumnReadOnlyReason,
} from "@/features/data-grid/model/tableColumnEditability";
import { dataGridCellUsesFullValueEditor } from "@/features/data-grid/model/valueEditorActivation";
import { gridCellTooltipText } from "@/features/data-grid/ui/DataGridHoverTooltip";
import type { DataGridVisualRow } from "@/lib/dataGridRows";
import { isTableCellExpression } from "@/lib/tableCellExpression";
import type { QueryResult } from "@/services/tauri/types/query";
import type { ColumnInfo } from "@/services/tauri/types/schemaCatalog";
import type { GridCell, GridColumn, Item } from "@glideapps/glide-data-grid";
import { type GridKeyEventArgs } from "@glideapps/glide-data-grid";
import { useState } from "react";

import { useCallback, useMemo } from "react";

interface GridValueEditorOptions {
  activeTab: GridTabSnapshot | null;
  visualColumnIndexToResultIndex: (visualColumnIndex: number) => number;
  visualRows: DataGridVisualRow[];
  result: QueryResult | undefined;
  overrideColumns: { name: string; type?: string | undefined }[] | undefined;
  tableColumnsByName: Map<string, ColumnInfo>;
  isEditable: boolean;
  pendingEdits: Map<string, unknown>;
  openColumnLookup: () => boolean;
  getCellContent: (cell: Item) => GridCell;
  isTransposed: boolean;
  columns: GridColumn[];
}

export function useGridValueEditor({
  activeTab,
  visualColumnIndexToResultIndex,
  visualRows,
  result,
  overrideColumns,
  tableColumnsByName,
  isEditable,
  pendingEdits,
  openColumnLookup,
  getCellContent,
  isTransposed,
  columns,
}: GridValueEditorOptions) {
  const [valueEditorTarget, setValueEditorTarget] =
    useState<GridValueEditorTarget | null>(null);

  const openValueEditor = useCallback(
    (cell: Item) => {
      if (!activeTab) return;
      const [visualColumnIndex, visualRowIndex] = cell;
      const columnIndex = visualColumnIndexToResultIndex(visualColumnIndex);
      if (columnIndex < 0) return;

      const visualRow = visualRows[visualRowIndex];
      if (!visualRow) return;
      const { rowKey: rowIndex } = visualRow;

      const resultColumn = result?.columns[columnIndex];
      const fallbackColumn = overrideColumns?.[columnIndex];
      const columnName = resultColumn?.name || fallbackColumn?.name;
      if (!columnName) return;
      const metadata = tableColumnsByName.get(columnName || "");
      const columnEditability = tableColumnEditability(metadata);
      const cellEditable =
        isEditable &&
        !activeTab.isExecuting &&
        columnEditability === "editable";
      const editKey = `${rowIndex}:${columnIndex}`;
      const pending = pendingEdits.has(editKey);
      const originalValue =
        rowIndex >= 0 ? result?.rows[rowIndex]?.[columnIndex] : undefined;
      const pendingValue = pending ? pendingEdits.get(editKey) : undefined;
      const expression = isTableCellExpression(pendingValue)
        ? pendingValue.expression
        : undefined;
      const value =
        expression === undefined
          ? pending
            ? pendingValue
            : originalValue
          : originalValue;
      const pageOffset =
        activeTab.type === "table"
          ? (activeTab.tablePage || 0) * (activeTab.tablePageSize || 0)
          : 0;

      setValueEditorTarget({
        key: `${activeTab.id}:${editKey}`,
        tabId: activeTab.id,
        rowIndex,
        columnIndex,
        columnName,
        columnType:
          metadata?.data_type ||
          resultColumn?.data_type ||
          fallbackColumn?.type,
        rowLabel:
          rowIndex < 0
            ? `New row ${Math.abs(rowIndex)}`
            : `Row ${(pageOffset + rowIndex + 1).toLocaleString()}`,
        value,
        originalValue,
        editable: cellEditable,
        nullable: metadata?.is_nullable !== false,
        pending,
        defaultValue: metadata?.default_value,
        expression,
        expressionAllowed: cellEditable && rowIndex >= 0,
        readOnlyReason: cellEditable
          ? undefined
          : tableColumnReadOnlyReason(columnEditability),
      });
    },
    [
      activeTab,
      isEditable,
      overrideColumns,
      pendingEdits,
      result,
      visualRows,
      tableColumnsByName,
      visualColumnIndexToResultIndex,
    ],
  );

  const onGridKeyDown = useCallback(
    (event: GridKeyEventArgs) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "g" &&
        openColumnLookup()
      ) {
        event.preventDefault();
        event.cancel();
        return;
      }
      if (
        event.shiftKey &&
        event.key === "Enter" &&
        event.location &&
        event.location[1] >= 0
      ) {
        event.preventDefault();
        event.cancel();
        openValueEditor(event.location);
      }
    },
    [openColumnLookup, openValueEditor],
  );

  const onCellActivated = useCallback(
    (cell: Item) => {
      const [visualColumnIndex] = cell;
      const originalColumnIndex =
        visualColumnIndexToResultIndex(visualColumnIndex);
      if (originalColumnIndex < 0) return;
      const gridCell = getCellContent(cell);
      const dataType =
        result?.columns[originalColumnIndex]?.data_type ||
        overrideColumns?.[originalColumnIndex]?.type;
      if (
        dataGridCellUsesFullValueEditor(gridCellTooltipText(gridCell), dataType)
      ) {
        openValueEditor(cell);
      }
    },
    [
      getCellContent,
      openValueEditor,
      overrideColumns,
      result,
      visualColumnIndexToResultIndex,
    ],
  );

  const valueEditorNavigation = useMemo(() => {
    if (!valueEditorTarget || valueEditorTarget.editable || isTransposed) {
      return undefined;
    }
    const rowPosition = visualRows.findIndex(
      (row) => row.rowKey === valueEditorTarget.rowIndex,
    );
    const columnPosition = columns.findIndex(
      (_, visualColumnIndex) =>
        visualColumnIndexToResultIndex(visualColumnIndex) ===
        valueEditorTarget.columnIndex,
    );
    return {
      up:
        adjacentDataGridDetailIndex(rowPosition, -1, visualRows.length) !==
        null,
      down:
        adjacentDataGridDetailIndex(rowPosition, 1, visualRows.length) !== null,
      left:
        adjacentDataGridDetailIndex(columnPosition, -1, columns.length) !==
        null,
      right:
        adjacentDataGridDetailIndex(columnPosition, 1, columns.length) !== null,
    };
  }, [
    columns,
    isTransposed,
    valueEditorTarget,
    visualColumnIndexToResultIndex,
    visualRows,
  ]);

  const navigateValueEditor = useCallback(
    (
      axis: DataGridDetailNavigationAxis,
      delta: DataGridDetailNavigationDelta,
    ) => {
      if (!valueEditorTarget || valueEditorTarget.editable || isTransposed)
        return;
      const rowPosition = visualRows.findIndex(
        (row) => row.rowKey === valueEditorTarget.rowIndex,
      );
      const columnPosition = columns.findIndex(
        (_, visualColumnIndex) =>
          visualColumnIndexToResultIndex(visualColumnIndex) ===
          valueEditorTarget.columnIndex,
      );
      const nextRowPosition =
        axis === "row"
          ? adjacentDataGridDetailIndex(rowPosition, delta, visualRows.length)
          : rowPosition;
      const nextColumnPosition =
        axis === "column"
          ? adjacentDataGridDetailIndex(columnPosition, delta, columns.length)
          : columnPosition;
      if (nextRowPosition === null || nextColumnPosition === null) return;
      openValueEditor([nextColumnPosition, nextRowPosition]);
    },
    [
      columns,
      isTransposed,
      openValueEditor,
      valueEditorTarget,
      visualColumnIndexToResultIndex,
      visualRows,
    ],
  );

  return {
    openValueEditor,
    onCellActivated,
    onGridKeyDown,
    valueEditorNavigation,
    navigateValueEditor,
    valueEditorTarget,
    setValueEditorTarget,
  };
}
