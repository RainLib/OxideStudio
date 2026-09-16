import { normalizeDataGridNumericInput } from "@/features/data-grid/model/cellInputCoercion";
import type { GridTabSnapshot } from "@/features/data-grid/model/gridTypes";
import { isTableColumnEditable } from "@/features/data-grid/model/tableColumnEditability";
import type {
  QueryResultGridState,
  TabState,
} from "@/features/workspace-tabs/model/types";
import type { DataGridVisualRow } from "@/lib/dataGridRows";
import { resultColumnIndexByGridId } from "@/lib/gridColumns";
import type { QueryResult } from "@/services/tauri/types/query";
import type { ColumnInfo } from "@/services/tauri/types/schemaCatalog";
import type { GridColumn, GridSelection } from "@glideapps/glide-data-grid";
import { EditableGridCell, Item } from "@glideapps/glide-data-grid";

import { useCallback } from "react";

interface GridEditingOptions {
  activeTab: GridTabSnapshot | null;
  result: QueryResult | undefined;
  isTransposed: boolean;
  columns: GridColumn[];
  gridState: QueryResultGridState | undefined;
  setGridSort: TabState["setGridSort"];
  isEditable: boolean;
  visualRows: DataGridVisualRow[];
  overrideColumns: { name: string; type?: string | undefined }[] | undefined;
  tableColumnsByName: Map<string, ColumnInfo>;
  gridSelection: GridSelection;
  setCellEdit: TabState["setCellEdit"];
  setBulkCellEdit: TabState["setBulkCellEdit"];
  setColumnWidth: TabState["setColumnWidth"];
  gridScale: number;
  setColumnOrder: TabState["setColumnOrder"];
}

export function useGridEditing({
  activeTab,
  result,
  isTransposed,
  columns,
  gridState,
  setGridSort,
  isEditable,
  visualRows,
  overrideColumns,
  tableColumnsByName,
  gridSelection,
  setCellEdit,
  setBulkCellEdit,
  setColumnWidth,
  gridScale,
  setColumnOrder,
}: GridEditingOptions) {
  const onHeaderMenuClick = useCallback(
    (
      col: number,
      _bounds: { x: number; y: number; width: number; height: number },
    ) => {
      if (!activeTab || !result || isTransposed) return;

      const visualColumn = columns[col];
      if (!visualColumn) return;

      const originalColumnIndex = resultColumnIndexByGridId(
        result.columns,
        visualColumn.id,
      );
      const column = result.columns[originalColumnIndex];
      if (!column) return;

      const currentSort = gridState?.sortColumn;
      const currentDir = gridState?.sortDirection;

      let newDirection: "asc" | "desc" | null = "asc";

      const columnId = String(visualColumn.id);
      if (currentSort === columnId) {
        // Cycling: asc -> desc -> none
        if (currentDir === "asc") {
          newDirection = "desc";
        } else if (currentDir === "desc") {
          newDirection = null;
        }
      }

      setGridSort(activeTab.id, newDirection ? columnId : null, newDirection);
    },
    [activeTab, result, gridState, setGridSort, columns, isTransposed],
  );

  // Handle cell edit
  const onCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell): void => {
      if (!activeTab || !isEditable) return;

      const [col, row] = cell;

      // Extract value
      let value: any;
      if ("data" in newValue) {
        value = newValue.data;
      } else {
        value = null;
      }

      // Helper to map visual (r,c) to data indices
      const getIndices = (r: number, c: number) => {
        const actualRowKey = visualRows[r]?.rowKey;

        const vCol = columns[c];
        if (!vCol) return null;

        let origColIdx = -1;
        if (result && result.columns.length > 0) {
          origColIdx = resultColumnIndexByGridId(result.columns, vCol.id);
        } else if (overrideColumns) {
          origColIdx = overrideColumns.findIndex((col) => col.name === vCol.id);
        }

        if (actualRowKey === undefined || origColIdx === -1) return null;
        const columnName =
          result?.columns[origColIdx]?.name ||
          overrideColumns?.[origColIdx]?.name;
        const metadata = tableColumnsByName.get(columnName || "");
        if (!isTableColumnEditable(metadata)) return null;
        const dataType =
          metadata?.data_type ||
          result?.columns[origColIdx]?.data_type ||
          overrideColumns?.[origColIdx]?.type;
        return { rowIndex: actualRowKey, colIndex: origColIdx, dataType };
      };

      const edits: Array<{ rowIndex: number; colIndex: number; value: any }> =
        [];
      let appliedToSelection = false;
      const range = gridSelection.current?.range;

      if (range) {
        const { x, y, width, height } = range;
        // Check if edited cell is inside the selection range
        if (col >= x && col < x + width && row >= y && row < y + height) {
          appliedToSelection = true;
          for (let r = y; r < y + height; r++) {
            for (let c = x; c < x + width; c++) {
              const indices = getIndices(r, c);
              if (indices) {
                edits.push({
                  rowIndex: indices.rowIndex,
                  colIndex: indices.colIndex,
                  value: normalizeDataGridNumericInput(value, indices.dataType),
                });
              }
            }
          }
        }
      }

      if (!appliedToSelection) {
        const indices = getIndices(row, col);
        if (indices) {
          edits.push({
            rowIndex: indices.rowIndex,
            colIndex: indices.colIndex,
            value: normalizeDataGridNumericInput(value, indices.dataType),
          });
        }
      }

      if (edits.length > 0) {
        const firstEdit = edits[0];
        if (edits.length === 1 && firstEdit) {
          setCellEdit(
            activeTab.id,
            firstEdit.rowIndex,
            firstEdit.colIndex,
            firstEdit.value,
          );
        } else {
          setBulkCellEdit(activeTab.id, edits);
        }
      }
    },
    [
      activeTab,
      result,
      visualRows,
      setCellEdit,
      setBulkCellEdit,
      columns,
      overrideColumns,
      gridSelection,
      isEditable,
      tableColumnsByName,
    ],
  );

  // Column resize handler
  const onColumnResize = useCallback(
    (column: GridColumn, newSize: number) => {
      if (!activeTab || !column.id || isTransposed) return;
      setColumnWidth(activeTab.id, column.id, Math.round(newSize / gridScale));
    },
    [activeTab, gridScale, setColumnWidth, isTransposed],
  );

  // Column move handler
  const onColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      if (!activeTab || isTransposed) return;

      const newOrder = [...columns]
        .map((c) => c.id || "")
        .filter(Boolean) as string[];
      const [moved] = newOrder.splice(startIndex, 1);
      if (moved) {
        newOrder.splice(endIndex, 0, moved);
        setColumnOrder(activeTab.id, newOrder);
      }
    },
    [activeTab, columns, setColumnOrder, isTransposed],
  );

  return { onHeaderMenuClick, onCellEdited, onColumnResize, onColumnMoved };
}
