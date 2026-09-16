import { normalizeDataGridNumericInput } from "@/features/data-grid/model/cellInputCoercion";
import type { GridTabSnapshot } from "@/features/data-grid/model/gridTypes";
import { planExpandableNewRowPaste } from "@/features/data-grid/model/newRowPaste";
import { isTableColumnEditable } from "@/features/data-grid/model/tableColumnEditability";
import type { TabState } from "@/features/workspace-tabs/model/types";
import type { DataGridVisualRow } from "@/lib/dataGridRows";
import { resultColumnIndexByGridId } from "@/lib/gridColumns";
import type { QueryResult } from "@/services/tauri/types/query";
import type { ColumnInfo } from "@/services/tauri/types/schemaCatalog";
import type { GridColumn, GridSelection } from "@glideapps/glide-data-grid";
import { Item, type EditListItem } from "@glideapps/glide-data-grid";

import { useCallback, useMemo } from "react";

interface GridPasteOptions {
  columns: GridColumn[];
  result: QueryResult | undefined;
  isTransposed: boolean;
  overrideColumns: { name: string; type?: string | undefined }[] | undefined;
  tableColumnsByName: Map<string, ColumnInfo>;
  activeTab: GridTabSnapshot | null;
  isEditable: boolean;
  visualRows: DataGridVisualRow[];
  setBulkCellEdit: TabState["setBulkCellEdit"];
  gridSelection: GridSelection;
  pendingEdits: Map<string, unknown>;
  applyNewRowPaste: TabState["applyNewRowPaste"];
}

export function useGridPaste({
  columns,
  result,
  isTransposed,
  overrideColumns,
  tableColumnsByName,
  activeTab,
  isEditable,
  visualRows,
  setBulkCellEdit,
  gridSelection,
  pendingEdits,
  applyNewRowPaste,
}: GridPasteOptions) {
  const visualColumnIndexToResultIndex = useCallback(
    (visualColumnIndex: number) => {
      const visualColumn = columns[visualColumnIndex];
      if (!visualColumn) return -1;
      if (result) {
        if (isTransposed) return visualColumnIndex;
        return resultColumnIndexByGridId(result.columns, visualColumn.id);
      }
      return (
        overrideColumns?.findIndex(
          (column) => column.name === visualColumn.id,
        ) ?? -1
      );
    },
    [columns, overrideColumns, result, isTransposed],
  );

  const pasteColumns = useMemo(
    () =>
      columns.map((_, visualColumnIndex) => {
        const columnIndex = visualColumnIndexToResultIndex(visualColumnIndex);
        const resultColumn = result?.columns[columnIndex];
        const fallbackColumn = overrideColumns?.[columnIndex];
        const metadata = tableColumnsByName.get(
          resultColumn?.name || fallbackColumn?.name || "",
        );
        return {
          columnIndex,
          editable: columnIndex >= 0 && isTableColumnEditable(metadata),
          dataType:
            metadata?.data_type ||
            resultColumn?.data_type ||
            fallbackColumn?.type,
        };
      }),
    [
      columns,
      overrideColumns,
      result,
      tableColumnsByName,
      visualColumnIndexToResultIndex,
    ],
  );

  const onCellsEdited = useCallback(
    (items: readonly EditListItem[]): boolean | void => {
      if (!activeTab || !isEditable || items.length <= 1) return;
      const edits = items.flatMap(({ location: [column, row], value }) => {
        const visualRow = visualRows[row];
        const pasteColumn = pasteColumns[column];
        if (!visualRow || !pasteColumn?.editable || !("data" in value)) {
          return [];
        }
        return [
          {
            rowIndex: visualRow.rowKey,
            colIndex: pasteColumn.columnIndex,
            value: normalizeDataGridNumericInput(
              value.data,
              pasteColumn.dataType,
            ),
          },
        ];
      });
      if (edits.length > 0) setBulkCellEdit(activeTab.id, edits);
      // Suppress Glide's per-cell callback even when every item became
      // readonly between paste parsing and this atomic store update.
      return true;
    },
    [activeTab, isEditable, pasteColumns, setBulkCellEdit, visualRows],
  );

  const onPaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]): boolean => {
      if (!activeTab || !isEditable) return true;
      const plan = planExpandableNewRowPaste({
        target,
        selection: gridSelection.current?.range,
        selectedRows: gridSelection.rows.toArray(),
        hasColumnSelection: gridSelection.columns.length > 0,
        pastedRows: values,
        visualRows,
        pendingEdits,
        visibleColumns: pasteColumns,
      });
      if (!plan) return true;

      const rows = plan.rows.map((row) =>
        row.map((cell) => {
          const normalized = normalizeDataGridNumericInput(
            cell.value,
            cell.dataType,
          );
          return {
            ...cell,
            value:
              normalized === null || typeof normalized === "string"
                ? normalized
                : cell.value,
          };
        }),
      );
      const handled = applyNewRowPaste(
        activeTab.id,
        plan.targetRowKey,
        plan.reusableRowKeys,
        rows,
      );
      // Glide proceeds with its bounded paste only when true is returned.
      return !handled;
    },
    [
      activeTab,
      applyNewRowPaste,
      gridSelection.current?.range,
      gridSelection.columns,
      gridSelection.rows,
      isEditable,
      pasteColumns,
      pendingEdits,
      visualRows,
    ],
  );

  return { visualColumnIndexToResultIndex, onCellsEdited, onPaste };
}
