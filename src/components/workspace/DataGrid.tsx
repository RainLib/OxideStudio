import { useCallback, useMemo, useState, useRef } from "react";
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
import { createTypedCell, applyFilter, compareValues } from "@/lib/gridUtils";
import { ArrowUp, ArrowDown, Check, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColumnFilter } from "./GridFilterRow";

interface DataGridProps {
  globalFilter?: string;
  columnFilters?: ColumnFilter[];
}

export function DataGrid({
  globalFilter = "",
  columnFilters = [],
}: DataGridProps) {
  const {
    tabs,
    activeTabId,
    setGridSort,
    setCellEdit,
    commitEdits,
    cancelEdits,
    setColumnWidth,
  } = useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const result = activeTab?.results?.[0];
  const error = activeTab?.error;
  const gridState = activeTab?.gridState;
  const pendingEdits = activeTab?.pendingEdits || new Map();
  const hasEdits = pendingEdits.size > 0;
  const columnWidths = activeTab?.columnWidths || {};

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

    // Apply sorting
    if (gridState?.sortColumn && gridState?.sortDirection && result) {
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
  }, [result, gridState, globalFilter, columnFilters]);

  // Column definitions with custom widths and sorting indicators
  const columns = useMemo<GridColumn[]>(() => {
    if (!result) return [];
    return result.columns.map((col) => {
      const isSorted = gridState?.sortColumn === col.name;
      const sortDir = gridState?.sortDirection;
      const customWidth = columnWidths[col.name];
      return {
        title: col.name,
        id: col.name,
        width: customWidth || 150, // Use custom width or default
        icon: isSorted
          ? sortDir === "asc"
            ? "headerSortAsc"
            : "headerSortDesc"
          : undefined,
        hasMenu: true, // Show arrow/menu indicator
      };
    });
  }, [result, gridState, columnWidths]);

  // Cell content with type styling and edit support
  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      if (!result || filteredRows.length === 0)
        return {
          kind: GridCellKind.Text,
          displayData: "",
          data: "",
          allowOverlay: false,
        };

      const [col, row] = cell;
      const actualRowIndex = sortedIndices[row];

      // Check if this cell has a pending edit
      const editKey = `${actualRowIndex}:${col}`;
      const val = pendingEdits.has(editKey)
        ? pendingEdits.get(editKey)
        : result.rows[actualRowIndex][col];

      return createTypedCell(val, true); // allowOverlay = true for editing
    },
    [result, filteredRows, sortedIndices, pendingEdits]
  );

  // Handle header click - no sorting, just for future actions
  const onHeaderClicked = useCallback((col: number) => {
    // Clicking header name doesn't sort anymore
    console.log("Header clicked (no sort):", col);
  }, []);

  // Handle header menu/arrow click for sorting
  const onHeaderMenuClick = useCallback(
    (
      col: number,
      bounds: { x: number; y: number; width: number; height: number }
    ) => {
      if (!activeTab || !result) return;

      const column = result.columns[col];
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
    [activeTab, result, gridState, setGridSort]
  );

  // Handle cell edit
  const onCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell): void => {
      if (!activeTab || !result) return;

      const [col, row] = cell;
      const actualRowIndex = sortedIndices[row];
      if (actualRowIndex === undefined) return;

      // Extract the actual value from the edited cell based on its type
      let value: any;
      if ("data" in newValue) {
        value = newValue.data;
      } else {
        value = null;
      }

      setCellEdit(activeTab.id, actualRowIndex, col, value);
    },
    [activeTab, result, sortedIndices, setCellEdit]
  );

  // Column resize handler
  const onColumnResize = useCallback(
    (column: GridColumn, newSize: number) => {
      if (!activeTab || !column.id) return;
      setColumnWidth(activeTab.id, column.id, newSize);
    },
    [activeTab, setColumnWidth]
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
    closeContextMenu();
  }, [activeTab, result, contextMenu, setGridSort, closeContextMenu]);

  // Draw borders after cells are rendered
  const drawCustomCell = useCallback(
    (args: any) => {
      const { ctx, rect, col, row } = args;
      const { x, y, width, height } = rect;

      const isColumnSelected = gridSelection.columns.hasIndex(col);
      const isRowSelected = gridSelection.rows.hasIndex(row);

      // Draw column selection borders (left and right)
      if (isColumnSelected) {
        ctx.save();
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 3;

        // Left border
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + height);
        ctx.stroke();

        // Right border
        ctx.beginPath();
        ctx.moveTo(x + width, y);
        ctx.lineTo(x + width, y + height);
        ctx.stroke();

        ctx.restore();
      }

      // Draw row selection borders (top and bottom)
      if (isRowSelected) {
        ctx.save();
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 3;

        // Top border
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + width, y);
        ctx.stroke();

        // Bottom border
        ctx.beginPath();
        ctx.moveTo(x, y + height);
        ctx.lineTo(x + width, y + height);
        ctx.stroke();

        ctx.restore();
      }

      return false;
    },
    [gridSelection]
  );

  const gridTheme: Partial<Theme> = {
    accentColor: "#f97316",
    accentLight: "rgba(249, 115, 22, 0.1)",
    bgCell: "#1a1a1a",
    bgCellMedium: "#1a1a1a",
    bgHeader: "#0f0f0f",
    bgHeaderHasFocus: "#0f0f0f",
    bgHeaderHovered: "#1a1a1a",
    textHeader: "#e5e5e5",
    textGroupHeader: "#a3a3a3",
    textDark: "#e5e5e5",
    textMedium: "#a3a3a3",
    textLight: "#737373",
    textBubble: "#e5e5e5",
    borderColor: "#333333",
    drilldownBorder: "#404040",
    linkColor: "#f97316",
    headerFontStyle: "600 13px",
    baseFontStyle: "13px",
    fontFamily: "Inter, system-ui, sans-serif",
    editorFontSize: "13px",
    lineHeight: 1.4,

    // Row marker (row number) styling when selected
    bgIconHeader: "#0f0f0f",
    fgIconHeader: "#e5e5e5",

    // Remove selection background, use only borders
    bgBubble: "transparent",
    bgBubbleSelected: "transparent",

    // Border width for selections
    cellHorizontalPadding: 8,
    cellVerticalPadding: 3,
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* Commit/Cancel Bar */}
      {hasEdits && (
        <div className="h-10 border-b border-orange-500/30 bg-orange-500/10 flex items-center px-3 gap-2 shrink-0">
          <div className="flex-1 text-[11px] text-orange-200 font-medium">
            {pendingEdits.size} cell{pendingEdits.size > 1 ? "s" : ""} modified
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => activeTab && cancelEdits(activeTab.id)}
            className="h-7 px-3 text-xs text-gray-400 hover:text-white hover:bg-[#333]"
          >
            <XIcon size={14} className="mr-1.5" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => activeTab && commitEdits(activeTab.id)}
            className="h-7 px-3 text-xs bg-orange-600 hover:bg-orange-700 text-white"
          >
            <Check size={14} className="mr-1.5" />
            Commit Changes
          </Button>
        </div>
      )}

      {/* DataEditor container with overlay */}
      <div
        ref={gridContainerRef}
        className="flex-1 overflow-hidden relative"
        onContextMenu={handleContextMenu}
      >
        {!result ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
            Run a query to see results
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
            {columnFilters.length > 0 || globalFilter
              ? "No rows match the current filters"
              : "No rows returned"}
          </div>
        ) : (
          <DataEditor
            getCellContent={getCellContent}
            columns={columns}
            rows={filteredRows.length}
            onHeaderClicked={onHeaderClicked}
            onHeaderMenuClick={onHeaderMenuClick}
            onCellEdited={onCellEdited}
            onColumnResize={onColumnResize}
            onCopy={() => onCopy(gridSelection)}
            drawCustomCell={drawCustomCell}
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
            headerIcons={{
              headerSortAsc: () => (
                <div className="flex items-center justify-center w-full h-full">
                  <ArrowUp size={12} className="text-orange-500" />
                </div>
              ),
              headerSortDesc: () => (
                <div className="flex items-center justify-center w-full h-full">
                  <ArrowDown size={12} className="text-orange-500" />
                </div>
              ),
            }}
          />
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
            <div className="min-w-56 bg-[#1a1a1a] border border-[#333] rounded-md shadow-lg p-1">
              <button
                onClick={handleCopyColumnName}
                className="w-full text-left px-2 py-1.5 text-sm text-gray-300 hover:bg-[#2a2a2a] rounded"
              >
                Copy Column Name
              </button>
              <div className="h-px bg-[#333] my-1" />
              <button
                onClick={handleSortAsc}
                className="w-full text-left px-2 py-1.5 text-sm text-gray-300 hover:bg-[#2a2a2a] rounded"
              >
                Sort ascending
              </button>
              <button
                onClick={handleSortDesc}
                className="w-full text-left px-2 py-1.5 text-sm text-gray-300 hover:bg-[#2a2a2a] rounded"
              >
                Sort descending
              </button>
              <div className="h-px bg-[#333] my-1" />
              <button
                onClick={() => {
                  // TODO: Implement column filter
                  console.log(
                    "Open filter for column:",
                    contextMenu.columnName
                  );
                  closeContextMenu();
                }}
                className="w-full text-left px-2 py-1.5 text-sm text-gray-300 hover:bg-[#2a2a2a] rounded"
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
            <div className="min-w-56 bg-[#1a1a1a] border border-[#333] rounded-md shadow-lg p-1">
              <button
                onClick={() => {
                  onCopy(gridSelection);
                  closeContextMenu();
                }}
                className="w-full text-left px-2 py-1.5 text-sm text-gray-300 hover:bg-[#2a2a2a] rounded"
              >
                Copy
                <span className="ml-auto text-xs text-gray-500">⌘C</span>
              </button>
              <button
                onClick={closeContextMenu}
                className="w-full text-left px-2 py-1.5 text-sm text-gray-300 hover:bg-[#2a2a2a] rounded"
              >
                Quick Filter
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
