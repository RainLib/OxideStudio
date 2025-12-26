import { useCallback, useMemo, useState } from "react";
import {
  DataEditor,
  GridCell,
  GridColumn,
  Item,
  Theme,
  GridCellKind,
  HeaderClickedEventArgs,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { useTabStore } from "@/store/useTabStore";
import { GridToolbar } from "./GridToolbar";
import { GridFilterMenu } from "./GridFilterMenu";
import {
  createTypedCell,
  applyFilter,
  compareValues,
  FilterState,
} from "@/lib/gridUtils";
import { ArrowUp, ArrowDown } from "lucide-react";

export function DataGrid() {
  const { tabs, activeTabId, setGridFilter, setGridSort } = useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [globalFilter, setGlobalFilter] = useState("");

  const result = activeTab?.results?.[0];
  const error = activeTab?.error;
  const gridState = activeTab?.gridState;

  // Apply filters and sorting
  const { filteredRows, sortedIndices } = useMemo(() => {
    if (!result) return { filteredRows: [], sortedIndices: [] };

    let indices = result.rows.map((_, i) => i);

    // Apply column filters
    if (gridState?.columnFilters) {
      Object.entries(gridState.columnFilters).forEach(([column, filter]) => {
        const colIndex = result.columns.findIndex((c) => c.name === column);
        if (colIndex >= 0) {
          indices = indices.filter((i) =>
            applyFilter(result.rows[i][colIndex], filter as FilterState)
          );
        }
      });
    }

    // Apply global filter
    if (globalFilter) {
      const searchLower = globalFilter.toLowerCase();
      indices = indices.filter((i) =>
        result.rows[i].some((cell) =>
          String(cell).toLowerCase().includes(searchLower)
        )
      );
    }

    // Apply sorting
    if (gridState?.sortColumn && gridState?.sortDirection) {
      const colIndex = result.columns.findIndex(
        (c) => c.name === gridState.sortColumn
      );
      if (colIndex >= 0) {
        indices.sort((a, b) =>
          compareValues(
            result.rows[a][colIndex],
            result.rows[b][colIndex],
            gridState.sortDirection!
          )
        );
      }
    }

    return {
      filteredRows: indices.map((i) => result.rows[i]),
      sortedIndices: indices,
    };
  }, [result, gridState, globalFilter]);

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
            ? "headerRowID"
            : "headerCode"
          : undefined,
        hasMenu: true,
      };
    });
  }, [result, gridState]);

  // Cell content with type styling
  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      if (!result || filteredRows.length === 0)
        return { kind: GridCellKind.Text, displayData: "", data: "" };

      const [col, row] = cell;
      const actualRowIndex = sortedIndices[row];
      const val = result.rows[actualRowIndex][col];

      return createTypedCell(val);
    },
    [result, filteredRows, sortedIndices]
  );

  // Handle header click for sorting
  const onHeaderClicked = useCallback(
    (col: number, args: HeaderClickedEventArgs) => {
      if (!activeTab || !result) return;

      const column = result.columns[col];
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

  // Handle column filter
  const handleFilterChange = useCallback(
    (column: string, filter: FilterState | undefined) => {
      if (!activeTab) return;
      setGridFilter(activeTab.id, column, filter);
    },
    [activeTab, setGridFilter]
  );

  // Modern dark theme
  const gridTheme: Partial<Theme> = {
    accentColor: "#f97316", // orange-500
    accentLight: "rgba(249, 115, 22, 0.1)",
    accentFg: "#ffffff",

    bgCell: "#1e1e1e",
    bgCellMedium: "#252525",
    bgHeader: "#2a2a2a",
    bgHeaderHasFocus: "#333333",
    bgHeaderHovered: "#303030",

    textDark: "#e5e7eb", // gray-200
    textMedium: "#9ca3af", // gray-400
    textLight: "#6b7280", // gray-500
    textBubble: "#ffffff",
    textHeader: "#d1d5db", // gray-300
    textHeaderSelected: "#ffffff",

    borderColor: "#3a3a3a",
    horizontalBorderColor: "#2a2a2a",

    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',

    headerFontStyle: "600 11px",
    baseFontStyle: "11px",
    editorFontSize: "11px",
    lineHeight: 1.4,
  };

  if (!activeTab) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        No active tab
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full p-4 text-red-400 overflow-auto whitespace-pre-wrap font-mono text-xs bg-[#1e1e1e]">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* Toolbar */}
      <GridToolbar
        result={result || null}
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
      />

      {/* Grid Area */}
      <div className="flex-1 min-h-0 relative">
        {!result ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
            Run a query to see results
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
            {globalFilter ||
            Object.keys(gridState?.columnFilters || {}).length > 0
              ? "No rows match the current filters"
              : "No rows returned"}
          </div>
        ) : (
          <DataEditor
            getCellContent={getCellContent}
            columns={columns}
            rows={filteredRows.length}
            onHeaderClicked={onHeaderClicked}
            smoothScrollX
            smoothScrollY
            width="100%"
            height="100%"
            theme={gridTheme}
            getCellsForSelection={true}
            rowMarkers="none"
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
            headerMenus={result.columns.map((col, idx) => ({
              col: idx,
              menu: () => (
                <GridFilterMenu
                  column={col.name}
                  filter={gridState?.columnFilters?.[col.name] as FilterState}
                  onFilterChange={(filter) =>
                    handleFilterChange(col.name, filter)
                  }
                />
              ),
            }))}
          />
        )}
      </div>
    </div>
  );
}
