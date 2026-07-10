import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  DataEditor,
  GridCell,
  GridColumn,
  Item,
  Theme,
  GridCellKind,
  EditableGridCell,
  GridSelection,
  CompactSelection,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { useTabStore } from "@/store/useTabStore";
import { useTheme } from "@/theme/useTheme";
import { createTypedCell, applyFilter, compareValues } from "@/lib/gridUtils";
import {
  Check,
  Copy,
  Download,
  FileJson,
  X as XIcon,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColumnFilter } from "./GridFilterRow";
import { StatusBarPortal } from "./StatusBarPortal";
import {
  exportToCsv,
  exportToJson,
  serializeQueryResultSelectionToTsv,
} from "@/lib/exportUtils";

// In DataGridProps
interface DataGridProps {
  globalFilter?: string;
  columnFilters?: ColumnFilter[];
  overrideColumns?: Array<{ name: string; type?: string }>;
  readOnly?: boolean;
}

function rangeIndexes(start: number, length: number) {
  return Array.from({ length }, (_, index) => start + index);
}

function exportFilename(title: string | undefined, extension: "csv" | "json") {
  const safeTitle = (title || "query-result")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safeTitle || "query-result"}.${extension}`;
}

function cssHslVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value ? `hsl(${value})` : fallback;
}

function cssHslVarAlpha(name: string, alpha: number, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value ? `hsl(${value} / ${alpha})` : fallback;
}

export function DataGrid({
  globalFilter = "",
  columnFilters = [],
  overrideColumns,
  readOnly = false,
}: DataGridProps) {
  const {
    tabs,
    activeTabId,
    setGridFilter,
    setGridSort,
    setCellEdit,
    setBulkCellEdit,
    commitEdits,
    cancelEdits,
    setColumnWidth,
    setColumnOrder,
    addNewRow,
    deleteRows,
    fetchTableColumns,
  } = useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    if (
      activeTabId &&
      activeTab?.type === "table" &&
      (!activeTab.tableColumns || !activeTab.tableIndexes) &&
      !activeTab.isFetchingColumns
    ) {
      fetchTableColumns(activeTabId);
    }
  }, [
    activeTabId,
    activeTab?.type,
    activeTab?.tableColumns,
    activeTab?.tableIndexes,
    activeTab?.isFetchingColumns,
    fetchTableColumns,
  ]);

  const result = activeTab?.results?.[0];
  const error = activeTab?.error;
  const gridState = activeTab?.gridState;
  const pendingEdits = activeTab?.pendingEdits || new Map();
  const isEditable = activeTab?.type === "table" && !readOnly;
  const hasEdits = isEditable && pendingEdits.size > 0;
  const columnWidths = activeTab?.columnWidths || {};
  const columnOrder = activeTab?.columnOrder || [];
  const newRowsCount = activeTab?.newRowsCount || 0;

  // Row selection state
  const [gridSelection, setGridSelection] = useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  });

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    type: "cell" | "header" | null;
    x: number;
    y: number;
    col?: number;
    row?: number;
    columnName?: string;
  }>({ type: null, x: 0, y: 0 });

  const gridContainerRef = useRef<HTMLDivElement>(null);

  const tableColumns = activeTab?.tableColumns;

  // Column definitions
  const columns = useMemo<GridColumn[]>(() => {
    // If we have a result, use its columns
    if (result && result.columns.length > 0) {
      const allColumns = result.columns.map((col) => {
        const isSorted = gridState?.sortColumn === col.name;
        const sortDir = gridState?.sortDirection;
        const customWidth = columnWidths[col.name];

        let title = col.name || "Unknown";
        if (tableColumns) {
          try {
            const meta = tableColumns.find((c) => c.name === col.name);
            if (meta) {
              let prefix = "";
              if (meta.is_primary_key) prefix = "🔑 ";
              else if (meta.is_unique) prefix = "⭐️ ";
              else if (meta.is_indexed) prefix = "⚡️ ";

              let type = meta.data_type || "text";
              if (type === "character varying") type = "varchar";
              if (type === "timestamp without time zone") type = "timestamp";

              title = `${prefix}${col.name} (${type})`;
            }
          } catch (e) {
            console.error("DataGrid: Error generating column header", e);
          }
        }

        return {
          title,
          id: col.name,
          width: customWidth || 150,
          icon: isSorted
            ? sortDir === "asc"
              ? "headerSortAsc"
              : "headerSortDesc"
            : undefined,
          hasMenu: true,
        };
      });

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
      return overrideColumns.map((col) => {
        let title = col.name;
        const meta = metaMap.get(col.name);
        if (meta) {
          let prefix = "";
          if (meta.is_primary_key) prefix = "🔑 ";
          else if (meta.is_unique) prefix = "⭐️ ";
          else if (meta.is_indexed) prefix = "⚡️ ";
          title = `${prefix}${col.name} (${meta.data_type})`;
        }
        return {
          title,
          id: col.name,
          width: 150,
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
  ]);

  // Apply filters and sorting
  const { filteredRows, sortedIndices } = useMemo(() => {
    if (!result) return { filteredRows: [], sortedIndices: [] };

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
            (c) => c.name === filter.column
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
          String(cell).toLowerCase().includes(searchLower)
        )
      );
    }

    const localColumnFilters = gridState?.columnFilters || {};
    const localFilterEntries = Object.entries(localColumnFilters).filter(
      ([, filter]) => filter?.value
    );
    if (localFilterEntries.length > 0) {
      indices = indices.filter((rowIndex) =>
        localFilterEntries.every(([column, filter]) => {
          const colIndex = result.columns.findIndex((c) => c.name === column);
          if (colIndex === -1) return true;

          return applyFilter(result.rows[rowIndex]?.[colIndex], {
            operator: filter.operator as ColumnFilter["operator"],
            value: filter.value,
          });
        })
      );
    }

    // Apply sorting
    if (
      activeTab?.type !== "table" &&
      gridState?.sortColumn &&
      gridState?.sortDirection &&
      result
    ) {
      const colIndex = result.columns.findIndex(
        (c) => c.name === gridState.sortColumn
      );
      if (colIndex >= 0) {
        indices.sort((a, b) => {
          const valA = result.rows[a]?.[colIndex];
          const valB = result.rows[b]?.[colIndex];
          return compareValues(valA, valB, gridState.sortDirection!);
        });
      }
    }

    return {
      filteredRows: indices.map((i) => result.rows[i]),
      sortedIndices: indices,
    };
  }, [result, gridState, globalFilter, columnFilters, activeTab?.type]);

  const selectedRowIndexes = useMemo(
    () =>
      gridSelection.rows
        .toArray()
        .map((row) => sortedIndices[row])
        .filter((rowIndex): rowIndex is number => rowIndex !== undefined),
    [gridSelection.rows, sortedIndices]
  );

  // Update getCellContent to handle missing result & new rows
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

      // Check if it's a new row
      const isNewRow = row >= filteredRows.length;

      // Determine the "Row Key" for editing/retrieval
      let editRowKey: number;
      let actualRowIndex: number | undefined;

      if (isNewRow) {
        const newRowOffset = row - filteredRows.length;
        editRowKey = -1 - newRowOffset; // -1, -2, -3...
        actualRowIndex = undefined;
      } else {
        actualRowIndex = sortedIndices[row];
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
        originalColIndex = result.columns.findIndex(
          (c) => c.name === visualColumn.id
        );
      } else if (overrideColumns) {
        originalColIndex = overrideColumns.findIndex(
          (c) => c.name === visualColumn.id
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
      let val: any = null;

      if (pendingEdits.has(editKey)) {
        val = pendingEdits.get(editKey);
      } else {
        // If not in pending edits, get from result if existing row
        if (!isNewRow && result && actualRowIndex !== undefined) {
          val = result.rows[actualRowIndex]?.[originalColIndex];
        }
      }

      const baseCell = createTypedCell(val !== null ? val : "", isEditable);
      const gridCell = { ...baseCell };

      // Force editable for compatible types
      if (gridCell.kind !== GridCellKind.Boolean) {
        (gridCell as any).allowOverlay = isEditable;
        (gridCell as any).readonly = !isEditable;
      }

      // Apply theme override for new rows
      if (isNewRow) {
        gridCell.themeOverride = {
          bgCell: "rgba(34, 197, 94, 0.1)", // Green tint
        };
      }

      return gridCell;
    },
    [
      result,
      filteredRows,
      sortedIndices,
      pendingEdits,
      columns,
      overrideColumns,
      isEditable,
    ]
  );

  // Handle header click - no sorting, just for future actions
  const onHeaderClicked = useCallback((col: number) => {
    // Clicking header name doesn't sort anymore
    console.log("Header clicked (no sort):", col);
  }, []);

  // Handle header menu/arrow click for sorting
  // 'col' is visual index
  const onHeaderMenuClick = useCallback(
    (
      col: number,
      _bounds: { x: number; y: number; width: number; height: number }
    ) => {
      if (!activeTab || !result) return;

      const visualColumn = columns[col];
      if (!visualColumn) return;

      // Find original column from visual column ID (name)
      const column = result.columns.find((c) => c.name === visualColumn.id);
      if (!column) return;

      const currentSort = gridState?.sortColumn;
      const currentDir = gridState?.sortDirection;

      let newDirection: "asc" | "desc" | null = "asc";

      if (currentSort === column.name) {
        // Cycling: asc -> desc -> none
        if (currentDir === "asc") {
          newDirection = "desc";
        } else if (currentDir === "desc") {
          newDirection = null;
        }
      }

      setGridSort(
        activeTab.id,
        newDirection ? column.name : null,
        newDirection
      );
    },
    [activeTab, result, gridState, setGridSort, columns]
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
        let actualRowKey: number | undefined;
        if (r >= filteredRows.length) {
          actualRowKey = -1 - (r - filteredRows.length);
        } else {
          actualRowKey = sortedIndices[r];
        }

        const vCol = columns[c];
        if (!vCol) return null;

        let origColIdx = -1;
        if (result && result.columns.length > 0) {
          origColIdx = result.columns.findIndex((col) => col.name === vCol.id);
        } else if (overrideColumns) {
          origColIdx = overrideColumns.findIndex((col) => col.name === vCol.id);
        }

        if (actualRowKey === undefined || origColIdx === -1) return null;
        return { rowIndex: actualRowKey, colIndex: origColIdx };
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
                edits.push({ ...indices, value });
              }
            }
          }
        }
      }

      if (!appliedToSelection) {
        const indices = getIndices(row, col);
        if (indices) edits.push({ ...indices, value });
      }

      if (edits.length > 0) {
        const firstEdit = edits[0];
        if (edits.length === 1 && firstEdit) {
          setCellEdit(
            activeTab.id,
            firstEdit.rowIndex,
            firstEdit.colIndex,
            value
          );
        } else {
          setBulkCellEdit(activeTab.id, edits);
        }
      }
    },
    [
      activeTab,
      result,
      sortedIndices,
      setCellEdit,
      setBulkCellEdit,
      columns,
      filteredRows,
      overrideColumns,
      gridSelection,
      isEditable,
    ]
  );

  // Column resize handler
  const onColumnResize = useCallback(
    (column: GridColumn, newSize: number) => {
      if (!activeTab || !column.id) return;
      setColumnWidth(activeTab.id, column.id, newSize);
    },
    [activeTab, setColumnWidth]
  );

  // Column move handler
  const onColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      if (!activeTab) return;

      const newOrder = [...columns]
        .map((c) => c.id || "")
        .filter(Boolean) as string[];
      const [moved] = newOrder.splice(startIndex, 1);
      if (moved) {
        newOrder.splice(endIndex, 0, moved);
        setColumnOrder(activeTab.id, newOrder);
      }
    },
    [activeTab, columns, setColumnOrder]
  );

  const visualColumnIndexToResultIndex = useCallback(
    (visualColumnIndex: number) => {
      if (!result) return -1;
      const visualColumn = columns[visualColumnIndex];
      if (!visualColumn) return -1;
      return result.columns.findIndex(
        (column) => column.name === visualColumn.id
      );
    },
    [columns, result]
  );

  const handleCopyAll = useCallback(async () => {
    if (!result || result.rows.length === 0) return;

    const rowIndexes = result.rows.map((_, index) => index);
    const columnIndexes = result.columns.map((_, index) => index);
    const text = serializeQueryResultSelectionToTsv(
      result,
      rowIndexes,
      columnIndexes,
      true
    );

    try {
      await navigator.clipboard.writeText(text);
      console.log("Copied query result to clipboard");
    } catch (err) {
      console.error("Failed to copy query result:", err);
    }
  }, [result]);

  const handleExportCsv = useCallback(() => {
    if (!result) return;
    exportToCsv(result, exportFilename(activeTab?.title, "csv"));
  }, [activeTab?.title, result]);

  const handleExportJson = useCallback(() => {
    if (!result) return;
    exportToJson(result, exportFilename(activeTab?.title, "json"));
  }, [activeTab?.title, result]);

  // Copy selected cells to clipboard
  const onCopy = useCallback(
    async (selection: GridSelection) => {
      if (!result) return;

      const range = selection.current?.range;
      let visualRows = selection.rows.toArray();
      let visualColumns = selection.columns.toArray();

      if (visualRows.length === 0 && range) {
        visualRows = rangeIndexes(range.y, range.height);
      }
      if (visualColumns.length === 0 && range) {
        visualColumns = rangeIndexes(range.x, range.width);
      }
      if (visualRows.length === 0 && visualColumns.length > 0) {
        visualRows = filteredRows.map((_, index) => index);
      }

      const rowIndexes = visualRows
        .map((row) => sortedIndices[row] ?? row)
        .filter((rowIndex) => rowIndex >= 0 && rowIndex < result.rows.length);
      const columnIndexes =
        visualColumns.length > 0
          ? visualColumns
              .map(visualColumnIndexToResultIndex)
              .filter((columnIndex) => columnIndex >= 0)
          : result.columns.map((_, index) => index);
      const text = serializeQueryResultSelectionToTsv(
        result,
        rowIndexes,
        columnIndexes
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
    [filteredRows, result, sortedIndices, visualColumnIndexToResultIndex]
  );

  const supplyEditor = useCallback((cell: GridCell) => {
    if (cell.kind !== GridCellKind.Text) return undefined;

    // Check if cell data looks like a date
    const isDate =
      typeof cell.data === "string" &&
      /^\d{4}-\d{2}-\d{2}([T\s]\d{2}:\d{2}:\d{2})?/.test(cell.data);

    if (isDate) {
      return {
        editor: (p: any) => (
          <input
            type="date"
            autoFocus
            className="w-full h-full p-2 bg-zinc-900 text-white border-none outline-none font-mono text-sm"
            // Start with just the date part for input type=date
            value={p.value.data.split("T")[0]}
            onChange={(e) =>
              p.onChange({
                ...p.value,
                data: e.target.value,
                displayData: e.target.value,
              })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") p.onFinishedEditing(p.value);
            }}
          />
        ),
      };
    }
    return undefined;
  }, []);

  // Handle right-click on grid overlay
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      console.log("Context menu triggered!", { x: e.clientX, y: e.clientY });

      if (!result || !gridContainerRef.current) return;

      const rect = gridContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      console.log("Position:", { x, y, rect });

      // Simple heuristic: if y < 40, it's likely a header
      const isHeader = y < 40;

      if (isHeader) {
        // Estimate column from x position
        const estimatedCol = Math.floor(x / 150); // Assume 150px width
        const columnName = result.columns[estimatedCol]?.name || "";
        console.log("Header menu:", { estimatedCol, columnName });
        setContextMenu({
          type: "header",
          x: e.clientX,
          y: e.clientY,
          col: estimatedCol,
          columnName,
        });
      } else {
        // Estimate row and column from position
        const estimatedRow = Math.floor((y - 40) / 34); // Header ~40px, row ~34px
        const estimatedCol = Math.floor(x / 150);
        console.log("Cell menu:", { estimatedRow, estimatedCol });
        setContextMenu({
          type: "cell",
          x: e.clientX,
          y: e.clientY,
          row: estimatedRow,
          col: estimatedCol,
        });
      }
    },
    [result]
  );

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu({ type: null, x: 0, y: 0 });
  }, []);

  // Context menu action handlers
  const handleCopyColumnName = useCallback(() => {
    if (contextMenu.columnName) {
      navigator.clipboard.writeText(contextMenu.columnName);
      console.log("Copied column name:", contextMenu.columnName);
    }
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

  const handleSortAsc = useCallback(() => {
    if (!activeTab || !result || contextMenu.col === undefined) return;
    const column = result.columns[contextMenu.col];
    if (column) {
      setGridSort(activeTab.id, column.name, "asc");
    }
    closeContextMenu();
  }, [activeTab, result, contextMenu, setGridSort, closeContextMenu]);

  const handleSortDesc = useCallback(() => {
    if (!activeTab || !result || contextMenu.col === undefined) return;
    const column = result.columns[contextMenu.col];
    if (column) {
      setGridSort(activeTab.id, column.name, "desc");
    }
    closeContextMenu();
  }, [activeTab, result, contextMenu, setGridSort, closeContextMenu]);

  const handleOpenColumnFilter = useCallback(() => {
    if (!activeTab || !contextMenu.columnName) return;

    const currentValue =
      activeTab.gridState?.columnFilters?.[contextMenu.columnName]?.value || "";
    const nextValue = window.prompt(
      `Filter "${contextMenu.columnName}" contains:`,
      currentValue
    );

    if (nextValue === null) {
      closeContextMenu();
      return;
    }

    const value = nextValue.trim();
    setGridFilter(
      activeTab.id,
      contextMenu.columnName,
      value ? { operator: "contains", value } : undefined
    );
    closeContextMenu();
  }, [activeTab, contextMenu.columnName, setGridFilter, closeContextMenu]);

  const handleDeleteSelectedRows = useCallback(async () => {
    if (!activeTab || selectedRowIndexes.length === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedRowIndexes.length} selected row${
        selectedRowIndexes.length === 1 ? "" : "s"
      }?`
    );
    if (!confirmed) return;

    await deleteRows(activeTab.id, selectedRowIndexes);
    setGridSelection({
      columns: CompactSelection.empty(),
      rows: CompactSelection.empty(),
    });
  }, [activeTab, deleteRows, selectedRowIndexes]);

  // Draw borders after cells are rendered

  const { mode } = useTheme();
  // Keep the canvas palette aligned with the workbench CSS tokens.
  const gridTheme: Partial<Theme> = useMemo(
    () => ({
      accentColor: cssHslVar(
        "--wb-accent",
        mode === "dark" ? "#75a7ff" : "#2f65d7"
      ),
      accentLight: cssHslVarAlpha(
        "--wb-accent",
        mode === "dark" ? 0.24 : 0.16,
        mode === "dark"
          ? "rgba(91, 137, 214, 0.24)"
          : "rgba(47, 101, 215, 0.16)"
      ),

      bgCell: cssHslVar("--wb-grid", mode === "dark" ? "#1e1f22" : "#ffffff"),
      bgCellMedium: cssHslVar(
        "--wb-editor",
        mode === "dark" ? "#1f2125" : "#f5f7fb"
      ),

      bgHeader: cssHslVar(
        "--wb-grid-header",
        mode === "dark" ? "#24272d" : "#eef2f8"
      ),
      bgHeaderHasFocus: cssHslVarAlpha(
        "--wb-active-strong",
        mode === "dark" ? 0.88 : 0.82,
        mode === "dark" ? "#2d3a56" : "#dfe8f7"
      ),
      bgHeaderHovered: cssHslVar(
        "--wb-hover",
        mode === "dark" ? "#303846" : "#d8e3f5"
      ),

      textHeader: cssHslVar(
        "--wb-text-muted",
        mode === "dark" ? "#aeb7c8" : "#4b5565"
      ),
      textGroupHeader: cssHslVar(
        "--wb-text-muted",
        mode === "dark" ? "#828b9b" : "#7a8393"
      ),
      textDark: cssHslVar("--wb-text", mode === "dark" ? "#d9dee8" : "#111827"),
      textMedium: cssHslVar(
        "--wb-text-muted",
        mode === "dark" ? "#a7afbd" : "#596274"
      ),
      textLight: cssHslVarAlpha(
        "--wb-text-muted",
        mode === "dark" ? 0.72 : 0.78,
        mode === "dark" ? "#7a8393" : "#8a93a3"
      ),
      textBubble: cssHslVar(
        "--wb-text",
        mode === "dark" ? "#d9dee8" : "#111827"
      ),

      borderColor: cssHslVar(
        "--wb-border-subtle",
        mode === "dark" ? "#343943" : "#dce3ee"
      ),
      drilldownBorder: cssHslVar(
        "--wb-border-subtle",
        mode === "dark" ? "#343943" : "#dce3ee"
      ),

      linkColor: cssHslVar(
        "--wb-accent",
        mode === "dark" ? "#75a7ff" : "#2f65d7"
      ),

      headerFontStyle: "600 13px",
      baseFontStyle: "13px",
      fontFamily: "Inter, system-ui, sans-serif",
      editorFontSize: "13px",
      lineHeight: 1.45,

      bgIconHeader: cssHslVar(
        "--wb-editor",
        mode === "dark" ? "#202328" : "#f7f9fc"
      ),
      fgIconHeader: cssHslVar(
        "--wb-text-muted",
        mode === "dark" ? "#aeb7c8" : "#596274"
      ),
      bgBubble: cssHslVar(
        "--wb-panel-raised",
        mode === "dark" ? "#1e1f22" : "#ffffff"
      ),
      bgBubbleSelected: "transparent",

      cellHorizontalPadding: 12,
      cellVerticalPadding: 6,
    }),
    [mode]
  );

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full wb-grid-surface">
      {activeTab?.type !== "table" && result && (
        <div className="h-9 shrink-0 border-b wb-data-toolbar flex items-center gap-2 px-3">
          <div className="text-xs text-muted-foreground">
            {result.rows.length.toLocaleString()} row
            {result.rows.length === 1 ? "" : "s"}
          </div>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={result.rows.length === 0}
            onClick={() => void handleCopyAll()}
            title="Copy result as TSV"
          >
            <Copy size={14} className="mr-1.5" />
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={result.rows.length === 0}
            onClick={handleExportCsv}
            title="Export result as CSV"
          >
            <Download size={14} className="mr-1.5" />
            CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={result.rows.length === 0}
            onClick={handleExportJson}
            title="Export result as JSON"
          >
            <FileJson size={14} className="mr-1.5" />
            JSON
          </Button>
        </div>
      )}

      {/* DataEditor container with overlay */}
      <div
        ref={gridContainerRef}
        className="flex-1 overflow-hidden relative"
        onContextMenu={handleContextMenu}
      >
        {!result && (!overrideColumns || overrideColumns.length === 0) ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            Run a query to see results
          </div>
        ) : (
          <>
            <DataEditor
              getCellContent={getCellContent}
              columns={columns}
              rows={filteredRows.length + newRowsCount}
              onHeaderClicked={onHeaderClicked}
              onHeaderMenuClick={onHeaderMenuClick}
              onCellEdited={isEditable ? onCellEdited : undefined}
              provideEditor={supplyEditor}
              onColumnResize={onColumnResize}
              onColumnMoved={onColumnMoved}
              smoothScrollX
              smoothScrollY
              width="100%"
              height="100%"
              theme={gridTheme}
              getCellsForSelection={true}
              rowMarkers="clickable-number"
              rowMarkerStartIndex={1}
              gridSelection={gridSelection}
              onGridSelectionChange={setGridSelection}
              keybindings={{ search: true }}
            />
            {filteredRows.length === 0 && newRowsCount === 0 && (
              <div className="absolute inset-x-0 top-12 bottom-0 flex items-center justify-center pointer-events-none">
                <div className="flex flex-col items-center gap-2 text-muted-foreground/50">
                  <span className="text-sm">
                    {result?.message || "No rows returned"}
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Backdrop for closing menu - only appears when menu is open */}
        {contextMenu.type && (
          <div
            className="absolute inset-0"
            style={{
              pointerEvents: "auto",
              zIndex: 40,
              backgroundColor: "transparent",
            }}
            onClick={closeContextMenu}
          />
        )}

        {/* Context Menu Portal */}
        {contextMenu.type === "header" && contextMenu.columnName && (
          <div
            className="fixed z-50"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="min-w-56 bg-popover border border-border rounded-md shadow-lg p-1">
              <button
                onClick={handleCopyColumnName}
                className="w-full text-left px-2 py-1.5 text-sm text-foreground hover:bg-accent rounded"
              >
                Copy Column Name
              </button>
              <div className="h-px bg-border my-1" />
              <button
                onClick={handleSortAsc}
                className="w-full text-left px-2 py-1.5 text-sm text-foreground hover:bg-accent rounded"
              >
                Sort ascending
              </button>
              <button
                onClick={handleSortDesc}
                className="w-full text-left px-2 py-1.5 text-sm text-foreground hover:bg-accent rounded"
              >
                Sort descending
              </button>
              <div className="h-px bg-border my-1" />
              <button
                onClick={handleOpenColumnFilter}
                className="w-full text-left px-2 py-1.5 text-sm text-foreground hover:bg-accent rounded"
              >
                Open Column Filter
              </button>
            </div>
          </div>
        )}

        {contextMenu.type === "cell" && (
          <div
            className="fixed z-50"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="min-w-56 bg-popover border border-border rounded-md shadow-lg p-1">
              <button
                onClick={() => {
                  onCopy(gridSelection);
                  closeContextMenu();
                }}
                className="w-full text-left px-2 py-1.5 text-sm text-foreground hover:bg-accent rounded"
              >
                Copy
                <span className="ml-auto text-xs text-muted-foreground">
                  ⌘C
                </span>
              </button>
              <button
                onClick={closeContextMenu}
                className="w-full text-left px-2 py-1.5 text-sm text-foreground hover:bg-accent rounded"
              >
                Quick Filter
              </button>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {activeTab?.isExecuting && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-[hsl(var(--wb-grid)/0.62)] backdrop-blur-sm animate-in fade-in duration-200">
            <div className="flex flex-col items-center gap-4 rounded-[8px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-8 py-6 shadow-[0_18px_48px_rgba(0,0,0,0.36),0_0_0_1px_hsl(var(--wb-accent)/0.08)]">
              <div className="relative">
                <Loader2
                  size={36}
                  className="animate-spin text-[hsl(var(--wb-accent))]"
                />
                <div className="absolute inset-0 animate-pulse blur-md text-[hsl(var(--wb-accent)/0.32)]">
                  <Loader2 size={36} />
                </div>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-base font-bold text-foreground tracking-tight">
                  {activeTab.type === "table"
                    ? "Fetching data..."
                    : "Executing Query..."}
                </span>
                <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">
                  Please wait
                </span>
              </div>
            </div>
          </div>
        )}
        {activeTab?.type === "table" && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-full border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised)/0.88)] p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.28),0_0_0_1px_hsl(var(--wb-accent)/0.06)] backdrop-blur-md transition-all animate-in slide-in-from-bottom-2">
            <div className="px-3 text-xs font-medium text-muted-foreground flex items-center gap-2">
              <span>{filteredRows.length + newRowsCount} rows</span>
            </div>

            {isEditable && (
              <>
                <div className="h-4 w-px bg-border/50" />

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => activeTab && addNewRow(activeTab.id)}
                  className="h-7 px-3 text-xs rounded-full hover:bg-accent"
                >
                  <Plus size={14} className="mr-1.5" /> Add Row
                </Button>
              </>
            )}

            {isEditable && selectedRowIndexes.length > 0 && (
              <>
                <div className="h-4 w-px bg-border/50" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleDeleteSelectedRows()}
                  className="h-7 px-3 text-xs rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 size={14} className="mr-1.5" /> Delete
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Status Bar Portal - Save/Cancel Actions */}
      <StatusBarPortal>
        {hasEdits && (
          <div className="flex items-center gap-2 text-xs h-full w-full justify-end animate-in fade-in slide-in-from-bottom-1">
            <span className="text-[10px] text-muted-foreground font-medium mr-2">
              {pendingEdits.size} unsaved changes
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => activeTab && cancelEdits(activeTab.id)}
              className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <XIcon size={13} className="mr-1.5" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => activeTab && commitEdits(activeTab.id)}
              className="h-6 px-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
            >
              <Check size={13} className="mr-1.5" />
              Save
            </Button>
          </div>
        )}
      </StatusBarPortal>
    </div>
  );
}
