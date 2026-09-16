import type { ColumnFormatterConfig } from "@/features/data-grid/model/columnFormatter";
import { columnIconForType } from "@/features/data-grid/model/gridPresentation";
import { resolveHeaderColumnType } from "@/features/data-grid/model/resultColumnType";
import type { QueryResultGridState } from "@/features/workspace-tabs/model/types";
import {
  resultColumnGridId,
  resultColumnIndexByGridId,
} from "@/lib/gridColumns";
import type { QueryResult } from "@/services/tauri/types/query";
import type { ColumnInfo } from "@/services/tauri/types/schemaCatalog";
import { GridColumn, GridColumnIcon } from "@glideapps/glide-data-grid";

import { useMemo } from "react";

interface GridColumnsOptions {
  isTransposed: boolean;
  result: QueryResult | undefined;
  gridScale: number;
  showTypeIcons: boolean;
  gridState: QueryResultGridState | undefined;
  columnWidths: Record<string, number>;
  tableColumnsByName: Map<string, ColumnInfo>;
  hiddenColumns: string[];
  columnOrder: string[];
  overrideColumns: { name: string; type?: string | undefined }[] | undefined;
  tableColumns: ColumnInfo[] | undefined;
  formatterForResultColumn: (
    columnIndex: number,
  ) => ColumnFormatterConfig | undefined;
  showColumnTypesInHeader: boolean;
  showColumnCommentsInHeader: boolean;
}

export function useGridColumns({
  isTransposed,
  result,
  gridScale,
  showTypeIcons,
  gridState,
  columnWidths,
  tableColumnsByName,
  hiddenColumns,
  columnOrder,
  overrideColumns,
  tableColumns,
  formatterForResultColumn,
  showColumnTypesInHeader,
  showColumnCommentsInHeader,
}: GridColumnsOptions) {
  const columns = useMemo<GridColumn[]>(() => {
    if (isTransposed && result && result.columns.length > 0) {
      return result.columns.map((column, index) => ({
        title: column.name,
        id: `transpose:${index}`,
        width: Math.round((index === 0 ? 190 : 150) * gridScale),
        icon:
          showTypeIcons && index === 0
            ? GridColumnIcon.HeaderString
            : undefined,
        hasMenu: false,
      }));
    }

    // If we have a result, use its columns
    if (result && result.columns.length > 0) {
      const allColumns = result.columns
        .map((col, index) => {
          const columnId = resultColumnGridId(result.columns, index);
          const isSorted = gridState?.sortColumn === columnId;
          const sortDir = gridState?.sortDirection;
          const customWidth = columnWidths[columnId] ?? columnWidths[col.name];

          const metadata = tableColumnsByName.get(col.name);
          const dataType = resolveHeaderColumnType({
            tableColumnType: metadata?.data_type,
            resultColumnType: col.data_type,
          });
          const title = col.name || "Unknown";
          const columnIcon = dataType
            ? columnIconForType(dataType, metadata?.is_primary_key)
            : undefined;

          return {
            title,
            id: columnId,
            width: Math.round((customWidth || 150) * gridScale),
            icon: isSorted
              ? sortDir === "asc"
                ? "headerSortAsc"
                : "headerSortDesc"
              : showTypeIcons
                ? columnIcon
                : undefined,
            hasMenu: true,
          };
        })
        .filter((column) => !hiddenColumns.includes(String(column.id)));

      if (!columnOrder || columnOrder.length === 0) {
        return allColumns;
      }

      // ... (reordering logic same as before)
      const orderedColumns: GridColumn[] = [];
      const usedIds = new Set<string>();
      columnOrder.forEach((colId) => {
        const col = allColumns.find((c) => c.id === colId);
        if (col) {
          orderedColumns.push(col);
          usedIds.add(colId);
        }
      });
      allColumns.forEach((col) => {
        if (!usedIds.has(col.id as string)) {
          orderedColumns.push(col);
        }
      });
      return orderedColumns;
    }

    // If no result but we have override columns (fallback for empty table view)
    if (overrideColumns && overrideColumns.length > 0) {
      const metaMap = new Map(tableColumns?.map((c) => [c.name, c]) || []);
      return overrideColumns
        .filter((col) => !hiddenColumns.includes(col.name))
        .map((col) => {
          let title = col.name;
          const meta = metaMap.get(col.name);
          let columnIcon: GridColumnIcon | undefined;
          if (meta) {
            title = col.name;
            columnIcon = columnIconForType(meta.data_type, meta.is_primary_key);
          }
          return {
            title,
            id: col.name,
            width: Math.round((columnWidths[col.name] || 150) * gridScale),
            icon: showTypeIcons ? columnIcon : undefined,
            hasMenu: true,
          };
        });
    }

    return [];
  }, [
    result,
    gridState,
    columnWidths,
    columnOrder,
    overrideColumns,
    tableColumns,
    showTypeIcons,
    gridScale,
    hiddenColumns,
    isTransposed,
    formatterForResultColumn,
  ]);

  const visibleHeaderMetadata = useMemo(
    () =>
      columns.map((column) => {
        const resultIndex = result
          ? resultColumnIndexByGridId(result.columns, column.id)
          : (overrideColumns?.findIndex(
              (candidate) => candidate.name === column.id,
            ) ?? -1);
        const resultColumn =
          resultIndex >= 0 ? result?.columns[resultIndex] : undefined;
        const name = resultColumn?.name || String(column.id);
        const metadata = tableColumnsByName.get(name);
        return {
          name,
          type: resolveHeaderColumnType({
            tableColumnType: metadata?.data_type,
            resultColumnType: resultColumn?.data_type,
          }),
          comment: metadata?.comment?.trim() || "",
          metadata,
        };
      }),
    [columns, overrideColumns, result, tableColumnsByName],
  );
  const reserveHeaderTypeLine =
    !isTransposed &&
    showColumnTypesInHeader &&
    visibleHeaderMetadata.some((column) => Boolean(column.type));
  const reserveHeaderCommentLine =
    !isTransposed &&
    showColumnCommentsInHeader &&
    visibleHeaderMetadata.some((column) => Boolean(column.comment));

  return {
    columns,
    reserveHeaderTypeLine,
    reserveHeaderCommentLine,
    visibleHeaderMetadata,
  };
}
