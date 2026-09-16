import {
  DATA_GRID_MAX_EXPANDABLE_PASTE_CELLS,
  DATA_GRID_MAX_EXPANDABLE_PASTE_ROWS,
  isBlankDataGridDraftValue,
  isTableColumnEditable,
} from "@/features/data-grid";
import { isTableCellExpression } from "@/lib/tableCellExpression";

import type { TabSlice } from "./types";

export const createGridDraftsSlice: TabSlice<
  | "setCellEdit"
  | "setBulkCellEdit"
  | "applyNewRowPaste"
  | "cancelEdits"
  | "addNewRow"
  | "cloneRows"
> = (set) => ({
  setCellEdit: (tabId, rowIndex, colIndex, value) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        if (t.isExecuting) return t;
        const pendingEdits = new Map(t.pendingEdits || new Map());
        const key = `${rowIndex}:${colIndex}`;
        pendingEdits.set(key, value);
        return { ...t, pendingEdits };
      }),
    }));
  },

  setBulkCellEdit: (tabId, edits) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        if (t.isExecuting) return t;
        const pendingEdits = new Map(t.pendingEdits || new Map());

        edits.forEach(({ rowIndex, colIndex, value }) => {
          const key = `${rowIndex}:${colIndex}`;
          pendingEdits.set(key, value);
        });

        return { ...t, pendingEdits };
      }),
    }));
  },

  applyNewRowPaste: (tabId, targetRowKey, reusableRowKeys, rows) => {
    let applied = false;
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (
          tab.id !== tabId ||
          tab.type !== "table" ||
          tab.isExecuting ||
          rows.length <= 1 ||
          rows.length > DATA_GRID_MAX_EXPANDABLE_PASTE_ROWS
        ) {
          return tab;
        }

        const result =
          tab.results?.[tab.activeResultIndex ?? 0] ?? tab.results?.[0];
        const currentCount = tab.newRowsCount || 0;
        const validNewRowKey = (rowKey: number) =>
          Number.isInteger(rowKey) && rowKey < 0 && -rowKey - 1 < currentCount;
        if (
          !result ||
          !validNewRowKey(targetRowKey) ||
          reusableRowKeys[0] !== targetRowKey ||
          new Set(reusableRowKeys).size !== reusableRowKeys.length ||
          reusableRowKeys.some((rowKey) => !validNewRowKey(rowKey))
        ) {
          return tab;
        }

        const pendingEdits = new Map(tab.pendingEdits || new Map());
        const reusable = reusableRowKeys.slice(0, rows.length);
        const reusableSet = new Set(reusable);
        for (const [key, value] of pendingEdits) {
          const separator = key.indexOf(":");
          if (separator <= 0) continue;
          const rowKey = Number(key.slice(0, separator));
          if (reusableSet.has(rowKey) && !isBlankDataGridDraftValue(value)) {
            return tab;
          }
        }

        const metadataByName = new Map(
          (tab.tableColumns || []).map((column) => [column.name, column]),
        );
        const cells = rows.flat();
        if (
          cells.length === 0 ||
          cells.length > DATA_GRID_MAX_EXPANDABLE_PASTE_CELLS ||
          cells.every(({ value }) => isBlankDataGridDraftValue(value)) ||
          cells.some(({ columnIndex }) => {
            const resultColumn = result.columns[columnIndex];
            return (
              !Number.isInteger(columnIndex) ||
              columnIndex < 0 ||
              !resultColumn ||
              !isTableColumnEditable(metadataByName.get(resultColumn.name))
            );
          })
        ) {
          return tab;
        }

        const additionalCount = Math.max(0, rows.length - reusable.length);
        const targetRowKeys = [
          ...reusable,
          ...Array.from(
            { length: additionalCount },
            (_, offset) => -1 - currentCount - offset,
          ),
        ];
        rows.forEach((row, rowOffset) => {
          const rowKey = targetRowKeys[rowOffset]!;
          row.forEach(({ columnIndex, value }) => {
            pendingEdits.set(`${rowKey}:${columnIndex}`, value);
          });
        });

        const placements = Array.from(
          { length: currentCount },
          (_, offset) => tab.newRowPlacements?.[offset] || null,
        );
        applied = true;
        return {
          ...tab,
          pendingEdits,
          newRowsCount: currentCount + additionalCount,
          newRowPlacements: [
            ...placements,
            ...Array.from({ length: additionalCount }, () => null),
          ],
        };
      }),
    }));
    return applied;
  },

  cancelEdits: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              pendingEdits: new Map(),
              newRowsCount: 0,
              newRowPlacements: [],
            }
          : t,
      ),
    }));
  },

  addNewRow: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId || t.isExecuting) return t;
        const currentCount = t.newRowsCount || 0;
        const placements = Array.from(
          { length: currentCount },
          (_, offset) => t.newRowPlacements?.[offset] || null,
        );
        return {
          ...t,
          newRowsCount: currentCount + 1,
          newRowPlacements: [...placements, null],
        };
      }),
    }));
  },

  cloneRows: (tabId, rowIndexes) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.isExecuting || tab.type !== "table")
          return tab;
        const result = tab.results?.[0];
        if (!result) return tab;
        const sources = [...new Set(rowIndexes)].filter(
          (rowIndex) =>
            Number.isInteger(rowIndex) &&
            rowIndex >= 0 &&
            rowIndex < result.rows.length,
        );
        if (sources.length === 0) return tab;

        const pendingEdits = new Map(tab.pendingEdits || new Map());
        let newRowsCount = tab.newRowsCount || 0;
        const placements = Array.from(
          { length: newRowsCount },
          (_, offset) => tab.newRowPlacements?.[offset] || null,
        );
        const metadataByName = new Map(
          (tab.tableColumns || []).map((column) => [column.name, column]),
        );

        for (const sourceRowIndex of sources) {
          const sourceRow = result.rows[sourceRowIndex];
          if (!sourceRow) continue;
          const rowKey = -1 - newRowsCount;
          for (
            let columnIndex = 0;
            columnIndex < result.columns.length;
            columnIndex += 1
          ) {
            const resultColumn = result.columns[columnIndex];
            if (!resultColumn) continue;
            const metadata = metadataByName.get(resultColumn.name);
            if (metadata?.is_auto_increment || metadata?.is_generated) continue;
            const sourceEditKey = `${sourceRowIndex}:${columnIndex}`;
            const value = pendingEdits.has(sourceEditKey)
              ? pendingEdits.get(sourceEditKey)
              : sourceRow[columnIndex];
            if (!isTableCellExpression(value)) {
              pendingEdits.set(`${rowKey}:${columnIndex}`, value);
            }
          }
          placements.push({ anchorRowKey: sourceRowIndex, position: "below" });
          newRowsCount += 1;
        }

        return {
          ...tab,
          pendingEdits,
          newRowsCount,
          newRowPlacements: placements,
        };
      }),
    }));
  },
});
