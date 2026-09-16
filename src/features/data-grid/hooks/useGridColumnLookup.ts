import { useRef, useState } from "react";

import type { DataGridColumnLookupItem } from "@/features/data-grid/model/columnLookup";
import { filterDataGridColumnLookupItems } from "@/features/data-grid/model/columnLookup";
import { resultColumnIndexByGridId } from "@/lib/gridColumns";
import type { QueryResult } from "@/services/tauri/types/query";
import type { ColumnInfo } from "@/services/tauri/types/schemaCatalog";
import type { DataEditorRef, GridColumn } from "@glideapps/glide-data-grid";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useMemo } from "react";

interface GridColumnLookupOptions {
  isTransposed: boolean;
  columns: GridColumn[];
  result: QueryResult | undefined;
  overrideColumns: { name: string; type?: string | undefined }[] | undefined;
  tableColumnsByName: Map<string, ColumnInfo>;
  dataEditorRef: React.RefObject<DataEditorRef | null>;
}

export function useGridColumnLookup({
  isTransposed,
  columns,
  result,
  overrideColumns,
  tableColumnsByName,
  dataEditorRef,
}: GridColumnLookupOptions) {
  const [columnLookupOpen, setColumnLookupOpen] = useState(false);
  const [columnLookupQuery, setColumnLookupQuery] = useState("");
  const [columnLookupSelectedIndex, setColumnLookupSelectedIndex] = useState(0);
  const columnLookupInputRef = useRef<HTMLInputElement>(null);

  const columnLookupItems = useMemo<DataGridColumnLookupItem[]>(() => {
    if (isTransposed) return [];
    return columns.map((visualColumn, index) => {
      const resultColumnIndex = result
        ? resultColumnIndexByGridId(result.columns, visualColumn.id)
        : -1;
      const resultColumn = result?.columns[resultColumnIndex];
      const name =
        resultColumn?.name ||
        overrideColumns?.[resultColumnIndex]?.name ||
        String(visualColumn.id);
      const metadata = tableColumnsByName.get(name);
      const detail = [
        resultColumn?.data_type || metadata?.data_type,
        metadata?.comment,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" · ");
      return { index, name, detail: detail || undefined };
    });
  }, [columns, isTransposed, overrideColumns, result, tableColumnsByName]);

  const filteredColumnLookupItems = useMemo(
    () => filterDataGridColumnLookupItems(columnLookupItems, columnLookupQuery),
    [columnLookupItems, columnLookupQuery],
  );

  const openColumnLookup = useCallback(() => {
    if (columnLookupItems.length === 0) return false;
    setColumnLookupQuery("");
    setColumnLookupSelectedIndex(0);
    setColumnLookupOpen(true);
    return true;
  }, [columnLookupItems.length]);

  const selectColumnLookupItem = useCallback(
    (item: DataGridColumnLookupItem | undefined) => {
      if (!item) return;
      dataEditorRef.current?.scrollTo(item.index, 0, "horizontal", 16, 0, {
        hAlign: "center",
        behavior: "smooth",
      });
      setColumnLookupOpen(false);
      dataEditorRef.current?.focus();
    },
    [],
  );

  const onColumnLookupKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      const count = filteredColumnLookupItems.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        if (!count) return;
        setColumnLookupSelectedIndex(
          (index) =>
            (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count,
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        selectColumnLookupItem(
          filteredColumnLookupItems[columnLookupSelectedIndex],
        );
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setColumnLookupOpen(false);
      }
    },
    [
      columnLookupSelectedIndex,
      filteredColumnLookupItems,
      selectColumnLookupItem,
    ],
  );

  useEffect(() => {
    if (!columnLookupOpen) return;
    const timer = window.setTimeout(
      () => columnLookupInputRef.current?.focus(),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [columnLookupOpen]);

  useEffect(() => {
    setColumnLookupSelectedIndex(0);
  }, [columnLookupQuery]);

  useEffect(() => {
    setColumnLookupSelectedIndex((current) =>
      Math.min(current, Math.max(filteredColumnLookupItems.length - 1, 0)),
    );
  }, [filteredColumnLookupItems.length]);

  // Apply filters and sorting

  return {
    openColumnLookup,
    onColumnLookupKeyDown,
    filteredColumnLookupItems,
    selectColumnLookupItem,
    columnLookupOpen,
    setColumnLookupOpen,
    columnLookupQuery,
    setColumnLookupQuery,
    columnLookupSelectedIndex,
    setColumnLookupSelectedIndex,
    columnLookupInputRef,
  };
}
