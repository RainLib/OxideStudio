import type { ColumnFormatterConfig } from "@/features/data-grid/model/columnFormatter";
import { applyColumnFormatter } from "@/features/data-grid/model/columnFormatter";
import { cssHslVarAlpha } from "@/features/data-grid/model/gridPresentation";
import { resolveRenderedColumnType } from "@/features/data-grid/model/resultColumnType";
import { isTableColumnEditable } from "@/features/data-grid/model/tableColumnEditability";
import { dataGridCellUsesFullValueEditor } from "@/features/data-grid/model/valueEditorActivation";
import type { DataGridVisualRow } from "@/lib/dataGridRows";
import { resultColumnIndexByGridId } from "@/lib/gridColumns";
import { createTypedCell } from "@/lib/gridUtils";
import { isTableCellExpression } from "@/lib/tableCellExpression";
import type { QueryResult } from "@/services/tauri/types/query";
import type { ColumnInfo } from "@/services/tauri/types/schemaCatalog";
import type { GridColumn } from "@glideapps/glide-data-grid";
import { GridCell, GridCellKind, Item } from "@glideapps/glide-data-grid";

import { useCallback } from "react";

interface GridCellContentOptions {
  result: QueryResult | undefined;
  overrideColumns: { name: string; type?: string | undefined }[] | undefined;
  visualRows: DataGridVisualRow[];
  columns: GridColumn[];
  isTransposed: boolean;
  pendingEdits: Map<string, unknown>;
  tableColumnsByName: Map<string, ColumnInfo>;
  isEditable: boolean;
  formatterForResultColumn: (
    columnIndex: number,
  ) => ColumnFormatterConfig | undefined;
  tableColumns: ColumnInfo[] | undefined;
}

export function useGridCellContent({
  result,
  overrideColumns,
  visualRows,
  columns,
  isTransposed,
  pendingEdits,
  tableColumnsByName,
  isEditable,
  formatterForResultColumn,
  tableColumns,
}: GridCellContentOptions) {
  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell;

      // Handle loading/empty state where result is null but overrideColumns exists
      if (!result && (!overrideColumns || overrideColumns.length === 0)) {
        return {
          kind: GridCellKind.Text,
          displayData: "",
          data: "",
          allowOverlay: false,
        };
      }

      const visualRow = visualRows[row];
      if (!visualRow) {
        return {
          kind: GridCellKind.Text,
          displayData: "",
          data: "",
          allowOverlay: false,
        };
      }
      const isNewRow = visualRow.isNew;

      // Determine the "Row Key" for editing/retrieval
      let editRowKey: number;
      let actualRowIndex: number | undefined;

      if (isNewRow) {
        editRowKey = visualRow.rowKey;
        actualRowIndex = undefined;
      } else {
        actualRowIndex = visualRow.rowKey;
        if (actualRowIndex === undefined) {
          return {
            kind: GridCellKind.Text,
            displayData: "",
            data: "",
            allowOverlay: false,
          };
        }
        editRowKey = actualRowIndex;
      }

      // If existing row but invalid index
      if (
        !isNewRow &&
        (actualRowIndex === undefined ||
          (result && !result.rows[actualRowIndex]))
      ) {
        return {
          kind: GridCellKind.Text,
          displayData: "",
          data: "",
          allowOverlay: false,
        };
      }

      // Map visual column index to actual data column index
      const visualColumn = columns[col];
      if (!visualColumn) {
        return {
          kind: GridCellKind.Text,
          displayData: "",
          data: "",
          allowOverlay: false,
        };
      }

      // Determine original column index
      let originalColIndex = -1;
      if (result && result.columns.length > 0) {
        originalColIndex = isTransposed
          ? col
          : resultColumnIndexByGridId(result.columns, visualColumn.id);
      } else if (overrideColumns) {
        originalColIndex = overrideColumns.findIndex(
          (c) => c.name === visualColumn.id,
        );
      }

      if (originalColIndex === -1) {
        return {
          kind: GridCellKind.Text,
          displayData: "",
          data: "",
          allowOverlay: false,
        };
      }

      // Retrieval Value
      const editKey = `${editRowKey}:${originalColIndex}`;
      let val: any = undefined;

      if (pendingEdits.has(editKey)) {
        val = pendingEdits.get(editKey);
      } else {
        // If not in pending edits, get from result if existing row
        if (!isNewRow && result && actualRowIndex !== undefined) {
          val = result.rows[actualRowIndex]?.[originalColIndex];
        }
      }

      const columnName =
        result?.columns[originalColIndex]?.name ||
        overrideColumns?.[originalColIndex]?.name;
      const metadata = tableColumnsByName.get(columnName || "");
      const cellEditable = isEditable && isTableColumnEditable(metadata);
      const baseCell = createTypedCell(
        isTableCellExpression(val) ? `ƒx ${val.expression}` : val,
        cellEditable,
        isNewRow ? "DEFAULT" : "NOT LOADED",
        resolveRenderedColumnType({
          resultColumnType: result?.columns[originalColIndex]?.data_type,
          tableColumnType:
            metadata?.data_type || overrideColumns?.[originalColIndex]?.type,
        }),
      );
      const gridCell = { ...baseCell };
      const formattedValue = applyColumnFormatter(
        val,
        formatterForResultColumn(originalColIndex),
      );
      if (formattedValue !== undefined && gridCell.kind === GridCellKind.Text) {
        gridCell.displayData = formattedValue;
      }

      if (pendingEdits.has(editKey)) {
        gridCell.themeOverride = {
          ...gridCell.themeOverride,
          bgCell: cssHslVarAlpha(
            "--wb-accent",
            0.12,
            "rgba(91, 137, 214, 0.12)",
          ),
        };
      }

      // Force editable for compatible types
      if (gridCell.kind !== GridCellKind.Boolean) {
        (gridCell as any).allowOverlay =
          cellEditable &&
          !dataGridCellUsesFullValueEditor(
            val,
            metadata?.data_type ||
              result?.columns[originalColIndex]?.data_type ||
              overrideColumns?.[originalColIndex]?.type,
          );
        (gridCell as any).readonly = !cellEditable;
      }

      // Apply theme override for new rows
      if (isNewRow) {
        gridCell.themeOverride = {
          ...gridCell.themeOverride,
          bgCell: cssHslVarAlpha(
            "--wb-accent",
            0.09,
            "rgba(91, 137, 214, 0.09)",
          ),
        };
      }

      return gridCell;
    },
    [
      result,
      visualRows,
      pendingEdits,
      columns,
      overrideColumns,
      isEditable,
      tableColumns,
      isTransposed,
      formatterForResultColumn,
    ],
  );

  // Handle header menu/arrow click for sorting
  // 'col' is visual index

  return { getCellContent };
}
