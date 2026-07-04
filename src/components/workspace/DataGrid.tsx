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
import { Check, X as XIcon, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColumnFilter } from "./GridFilterRow";
import { StatusBarPortal } from "./StatusBarPortal";

// In DataGridProps
interface DataGridProps {
  globalFilter?: string;
  columnFilters?: ColumnFilter[];
  overrideColumns?: Array<{ name: string; type?: string }>;
  readOnly?: boolean;
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
      !activeTab.tableColumns &&
      !activeTab.isFetchingColumns
    ) {
      fetchTableColumns(activeTabId);
    }
  }, [
    activeTabId,
    activeTab?.type,
    activeTab?.tableColumns,
    activeTab?.isFetchingColumns,
    fetchTableColumns,
  ]);

  const result = activeTab?.results?.[0];
  const error = activeTab?.error;
  const gridState = activeTab?.gridState;
  const pendingEdits = activeTab?.pendingEdits || new Map();
  const hasEdits = !readOnly && pendingEdits.size > 0;
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

      const baseCell = createTypedCell(val !== null ? val : "", !readOnly);
      const gridCell = { ...baseCell };

      // Force editable for compatible types
      if (gridCell.kind !== GridCellKind.Boolean) {
        (gridCell as any).allowOverlay = !readOnly;
        (gridCell as any).readonly = readOnly;
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
      readOnly,
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
      if (!activeTab || readOnly) return;

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
      readOnly,
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

  // Copy selected cells to clipboard
  const onCopy = useCallback(
    async (selection: GridSelection) => {
      if (!result) return;

      const rows = selection.rows.toArray();
      const cols = selection.columns.toArray();

      let text = "";

      // If specific cells are selected
      if (cols.length > 0 && rows.length > 0) {
        for (const row of rows) {
          const rowData: string[] = [];
          for (const col of cols) {
            const actualRowIndex = sortedIndices[row] ?? row;
            const value = result.rows[actualRowIndex]?.[col];
            rowData.push(value != null ? String(value) : "");
          }
          text += rowData.join("\t") + "\n";
        }
      }
      // If only rows are selected (clicked row markers)
      else if (rows.length > 0) {
        for (const row of rows) {
          const actualRowIndex = sortedIndices[row] ?? row;
          const rowData = result.rows[actualRowIndex];
          if (rowData) {
            text +=
              rowData.map((v) => (v != null ? String(v) : "")).join("\t") +
              "\n";
          }
        }
      }

      if (text) {
        try {
          await navigator.clipboard.writeText(text.trim());
          console.log("Copied to clipboard");
        } catch (err) {
          console.error("Failed to copy:", err);
        }
      }
    },
    [result, sortedIndices]
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
  // Create a dynamic grid theme that pulls from CSS variables
  const gridTheme: Partial<Theme> = useMemo(
    () => ({
      // Premium Dark Palette (Zinc based)
      accentColor: "#3b82f6", // Bright Blue for selection border
      accentLight: "rgba(59, 130, 246, 0.2)", // Blue tint (Used for selected Row/Column Headers)

      // Deep background for cells
      bgCell: mode === "dark" ? "#09090b" : "#ffffff",
      bgCellMedium: mode === "dark" ? "#18181b" : "#f4f4f5", // Zinc-900 / Zinc-100

      // Slightly lighter headers
      bgHeader: mode === "dark" ? "#18181b" : "#f4f4f5",
      bgHeaderHasFocus: mode === "dark" ? "#27272a" : "#e4e4e7",
      bgHeaderHovered: mode === "dark" ? "#3f3f46" : "#d4d4d8", // Lighter (Zinc 700/300) for distinct hover effect

      // Text Colors - High Contrast
      textHeader: mode === "dark" ? "#a1a1aa" : "#52525b", // Zinc-400 / Zinc-600
      textGroupHeader: mode === "dark" ? "#71717a" : "#a1a1aa",

      // Main data text - pure white in dark mode for pop
      textDark: mode === "dark" ? "#ffffff" : "#09090b",

      textMedium: mode === "dark" ? "#a1a1aa" : "#71717a",
      textLight: mode === "dark" ? "#71717a" : "#a1a1aa",
      textBubble: mode === "dark" ? "#ffffff" : "#09090b",

      // Subtle Borders
      borderColor: mode === "dark" ? "#27272a" : "#e4e4e7", // Zinc-800 / Zinc-200
      drilldownBorder: mode === "dark" ? "#27272a" : "#e4e4e7",

      linkColor: "hsl(var(--primary))",

      // Typography
      headerFontStyle: "600 13px",
      baseFontStyle: "13px",
      fontFamily: "Inter, system-ui, sans-serif",
      editorFontSize: "13px",
      lineHeight: 1.5, // Slightly more breathing room

      // Row marker styling
      bgIconHeader: mode === "dark" ? "#09090b" : "#ffffff", // Blend with bgCell
      fgIconHeader: mode === "dark" ? "#a1a1aa" : "#71717a",

      // Selection STYLING
      // bgBubble: The background of non-selected cells in specific contexts? Usually transparent or match bgCell.
      bgBubble: mode === "dark" ? "#09090b" : "#ffffff",

      // bgBubbleSelected: The background of SELECTED cells.
      // User Req: "background is original color" -> Transparent fill.
      bgBubbleSelected: "transparent",

      // Note: Row Header highlight typically derives from 'accentLight' in GDG.
      // By setting accentLight to blue tint and bgBubbleSelected to transparent, we hope to achieve:
      // - Cells: Transparent fill (no blue tint).
      // - Cells: Transparent fill (no blue tint).
      // - Row Header: Blue tint (from accentLight).

      cellHorizontalPadding: 12, // More padding for premium feel
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
    <div className="flex flex-col h-full bg-background">
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
              onCellEdited={readOnly ? undefined : onCellEdited}
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
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-background-elevated border border-border px-8 py-6 rounded-xl shadow-2xl flex flex-col items-center gap-4">
              <div className="relative">
                <Loader2 size={36} className="text-primary animate-spin" />
                <div className="absolute inset-0 text-primary/30 animate-pulse blur-md">
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
        {/* Floating Action Bar - Stats & Add Row */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 p-1.5 bg-background/80 backdrop-blur-md border border-border rounded-full shadow-xl transition-all animate-in slide-in-from-bottom-2">
          <div className="px-3 text-xs font-medium text-muted-foreground flex items-center gap-2">
            <span>{filteredRows.length + newRowsCount} rows</span>
          </div>

          {!readOnly && (
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

          {!readOnly && selectedRowIndexes.length > 0 && (
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
