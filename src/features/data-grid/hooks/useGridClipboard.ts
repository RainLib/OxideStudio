import type { ConnectionConfig } from "@/features/connections/model/types";
import {
  exportFilename,
  rangeIndexes,
} from "@/features/data-grid/model/gridPresentation";
import type { GridTabSnapshot } from "@/features/data-grid/model/gridTypes";
import type { DataGridVisualRow } from "@/lib/dataGridRows";
import {
  exportQueryResult,
  serializeQueryResultSelectionToTsv,
  type QueryResultExportFormat,
} from "@/lib/exportUtils";
import type { QueryResult } from "@/services/tauri/types/query";
import { GridSelection } from "@glideapps/glide-data-grid";

import { useCallback } from "react";

interface GridClipboardOptions {
  result: QueryResult | undefined;
  copyIncludeHeaders: boolean;
  activeConnection: ConnectionConfig | undefined;
  activeTab: GridTabSnapshot | null;
  visualRows: DataGridVisualRow[];
  pendingEdits: Map<string, unknown>;
  visualColumnIndexToResultIndex: (visualColumnIndex: number) => number;
}

export function useGridClipboard({
  result,
  copyIncludeHeaders,
  activeConnection,
  activeTab,
  visualRows,
  pendingEdits,
  visualColumnIndexToResultIndex,
}: GridClipboardOptions) {
  const handleCopyAll = useCallback(async () => {
    if (!result || result.rows.length === 0) return;

    const rowIndexes = result.rows.map((_, index) => index);
    const columnIndexes = result.columns.map((_, index) => index);
    const text = serializeQueryResultSelectionToTsv(
      result,
      rowIndexes,
      columnIndexes,
      copyIncludeHeaders,
      activeConnection?.driver,
    );

    try {
      await navigator.clipboard.writeText(text);
      console.log("Copied query result to clipboard");
    } catch (err) {
      console.error("Failed to copy query result:", err);
    }
  }, [activeConnection?.driver, copyIncludeHeaders, result]);

  const handleExport = useCallback(
    (
      format: QueryResultExportFormat,
      extension: "csv" | "json" | "jsonl" | "md" | "tsv" | "sql",
    ) => {
      if (!result) return;
      exportQueryResult(
        result,
        format,
        exportFilename(activeTab?.title, extension),
      );
    },
    [activeTab?.title, result],
  );

  // Copy selected cells to clipboard
  const onCopy = useCallback(
    async (selection: GridSelection) => {
      if (!result) return;

      const range = selection.current?.range;
      let selectedVisualRows = selection.rows.toArray();
      let visualColumns = selection.columns.toArray();

      if (selectedVisualRows.length === 0 && range) {
        selectedVisualRows = rangeIndexes(range.y, range.height);
      }
      if (visualColumns.length === 0 && range) {
        visualColumns = rangeIndexes(range.x, range.width);
      }
      if (selectedVisualRows.length === 0 && visualColumns.length > 0) {
        selectedVisualRows = visualRows.map((_, index) => index);
      }

      const selectedRows = selectedVisualRows.flatMap((visualRowIndex) => {
        const visualRow = visualRows[visualRowIndex];
        if (!visualRow) return [];
        return [
          result.columns.map((_, columnIndex) => {
            const editKey = `${visualRow.rowKey}:${columnIndex}`;
            if (pendingEdits.has(editKey)) return pendingEdits.get(editKey);
            return visualRow.rowKey >= 0
              ? result.rows[visualRow.rowKey]?.[columnIndex]
              : undefined;
          }),
        ];
      });
      const selectionResult = { ...result, rows: selectedRows };
      const rowIndexes = selectedRows.map((_, index) => index);
      const columnIndexes =
        visualColumns.length > 0
          ? visualColumns
              .map(visualColumnIndexToResultIndex)
              .filter((columnIndex) => columnIndex >= 0)
          : result.columns.map((_, index) => index);
      const text = serializeQueryResultSelectionToTsv(
        selectionResult,
        rowIndexes,
        columnIndexes,
        copyIncludeHeaders,
        activeConnection?.driver,
      );

      if (text) {
        try {
          await navigator.clipboard.writeText(text);
          console.log("Copied to clipboard");
        } catch (err) {
          console.error("Failed to copy:", err);
        }
      }
    },
    [
      activeConnection?.driver,
      copyIncludeHeaders,
      pendingEdits,
      result,
      visualColumnIndexToResultIndex,
      visualRows,
    ],
  );

  return { onCopy, handleCopyAll, handleExport };
}
