import type { ColumnFilter } from "@/components/workspace/GridFilterRow";
import { sortDataGridRowIndexes } from "@/features/data-grid/model/dataGridSort";
import type { GridTabSnapshot } from "@/features/data-grid/model/gridTypes";
import type { QueryResultGridState } from "@/features/workspace-tabs/model/types";
import { buildDataGridVisualRows } from "@/lib/dataGridRows";
import { resultColumnIndexByGridId } from "@/lib/gridColumns";
import { applyFilter } from "@/lib/gridUtils";
import type { QueryResult } from "@/services/tauri/types/query";

import { useMemo } from "react";

interface GridRowsOptions {
  result: QueryResult | undefined;
  isTransposed: boolean;
  columnFilters: ColumnFilter[];
  globalFilter: string;
  gridState: QueryResultGridState | undefined;
  activeTab: GridTabSnapshot | null;
  newRowsCount: number;
}

export function useGridRows({
  result,
  isTransposed,
  columnFilters,
  globalFilter,
  gridState,
  activeTab,
  newRowsCount,
}: GridRowsOptions) {
  const sortedIndices = useMemo(() => {
    if (!result) return [];

    if (isTransposed) {
      return result.rows.map((_, index) => index);
    }

    let indices = result.rows.map((_, i) => i);

    // Apply column filters (from query builder filter row)
    if (columnFilters.length > 0 && result) {
      indices = indices.filter((rowIndex) => {
        // Evaluate filters with AND/OR logic
        let passesFilter = true;

        for (let i = 0; i < columnFilters.length; i++) {
          const filter = columnFilters[i];
          if (!filter) continue;

          const colIndex = result.columns.findIndex(
            (c) => c.name === filter.column,
          );

          if (colIndex === -1) continue;

          const cellValue = result.rows[rowIndex]?.[colIndex];
          const matches = applyFilter(cellValue, filter);

          if (i === 0) {
            // First filter sets the initial state
            passesFilter = matches;
          } else {
            // Subsequent filters use their logic operator
            if (filter.logic === "OR") {
              passesFilter = passesFilter || matches;
            } else {
              // Default to AND
              passesFilter = passesFilter && matches;
            }
          }
        }

        return passesFilter;
      });
    }

    // Apply global filter
    if (globalFilter && result) {
      const searchLower = globalFilter.toLowerCase();
      indices = indices.filter((i) =>
        result.rows[i]?.some((cell) =>
          String(cell).toLowerCase().includes(searchLower),
        ),
      );
    }

    const localColumnFilters = gridState?.columnFilters || {};
    const localFilterEntries = Object.entries(localColumnFilters).filter(
      ([, filter]) => filter?.value,
    );
    if (localFilterEntries.length > 0) {
      indices = indices.filter((rowIndex) =>
        localFilterEntries.every(([column, filter]) => {
          const colIndex = resultColumnIndexByGridId(result.columns, column);
          if (colIndex === -1) return true;

          return applyFilter(result.rows[rowIndex]?.[colIndex], {
            operator: filter.operator as ColumnFilter["operator"],
            value: filter.value,
          });
        }),
      );
    }

    // Apply sorting
    if (
      activeTab?.type !== "table" &&
      gridState?.sortColumn &&
      gridState?.sortDirection &&
      result
    ) {
      const colIndex = resultColumnIndexByGridId(
        result.columns,
        gridState.sortColumn,
      );
      if (colIndex >= 0) {
        indices = sortDataGridRowIndexes({
          rows: result.rows,
          rowIndexes: indices,
          columnIndex: colIndex,
          direction: gridState.sortDirection,
          columnType: result.columns[colIndex]?.data_type,
        });
      }
    }

    return indices;
  }, [
    result,
    gridState,
    globalFilter,
    columnFilters,
    activeTab?.type,
    isTransposed,
  ]);

  const visualRows = useMemo(
    () =>
      buildDataGridVisualRows(
        sortedIndices,
        newRowsCount,
        activeTab?.newRowPlacements,
      ),
    [activeTab?.newRowPlacements, newRowsCount, sortedIndices],
  );

  return { visualRows };
}
