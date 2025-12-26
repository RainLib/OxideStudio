import { useCallback, useMemo } from "react";
import {
  DataEditor,
  GridCell,
  GridColumn,
  Item,
  Theme,
  GridCellKind,
  EditableGridCell,
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
  } = useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const result = activeTab?.results?.[0];
  const error = activeTab?.error;
  const gridState = activeTab?.gridState;
  const pendingEdits = activeTab?.pendingEdits || new Map();
  const hasEdits = pendingEdits.size > 0;

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

  // Column definitions with sorting indicators
  const columns = useMemo<GridColumn[]>(() => {
    if (!result) return [];
    return result.columns.map((col) => {
      const isSorted = gridState?.sortColumn === col.name;
      const sortDir = gridState?.sortDirection;
      return {
        title: col.name,
        id: col.name,
        width: 150,
        icon: isSorted
          ? sortDir === "asc"
            ? ("headerRowID" as any)
            : ("headerCode" as any)
          : undefined,
        hasMenu: false,
      };
    });
  }, [result, gridState]);

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

  // Handle header click for sorting
  const onHeaderClicked = useCallback(
    (col: number) => {
      if (!activeTab || !result) return;

      const column = result.columns[col];
      if (!column) return;

      const currentSort = gridState?.sortColumn;
      const currentDir = gridState?.sortDirection;

      let newDirection: "asc" | "desc" | null = "asc";
      if (currentSort === column.name) {
        if (currentDir === "asc") newDirection = "desc";
        else if (currentDir === "desc") newDirection = null;
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

  const gridTheme: Partial<Theme> = {
    accentColor: "#f97316",
    accentLight: "rgba(249, 115, 22, 0.1)",
    textDark: "#e5e5e5",
    textMedium: "#a3a3a3",
    textLight: "#737373",
    textBubble: "#e5e5e5",
    bgIconHeader: "#404040",
    fgIconHeader: "#a3a3a3",
    textHeader: "#e5e5e5",
    textGroupHeader: "#a3a3a3",
    bgCell: "#1e1e1e",
    bgCellMedium: "#262626",
    bgHeader: "#252525",
    bgHeaderHasFocus: "#2a2a2a",
    bgHeaderHovered: "#2a2a2a",
    bgBubble: "#262626",
    bgBubbleSelected: "#2a2a2a",
    bgSearchResult: "rgba(249, 115, 22, 0.15)",
    borderColor: "#333",
    drilldownBorder: "rgba(249, 115, 22, 0.3)",
    linkColor: "#60a5fa",
    headerFontStyle: "600 12px",
    baseFontStyle: "12px",
    fontFamily: "Inter, system-ui, sans-serif",
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

      {/* DataEditor container */}
      <div className="flex-1 overflow-hidden relative">
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
            onCellEdited={onCellEdited}
            smoothScrollX
            smoothScrollY
            width="100%"
            height="100%"
            theme={gridTheme}
            getCellsForSelection={true}
            rowMarkers="number"
            rowMarkerStartIndex={1}
            keybindings={{ search: true }}
            headerIcons={{
              headerRowID: () => (
                <div className="flex items-center justify-center w-full h-full">
                  <ArrowUp size={10} className="text-orange-500" />
                </div>
              ),
              headerCode: () => (
                <div className="flex items-center justify-center w-full h-full">
                  <ArrowDown size={10} className="text-orange-500" />
                </div>
              ),
            }}
          />
        )}
      </div>
    </div>
  );
}
