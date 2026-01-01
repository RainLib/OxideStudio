import { useEffect, useState } from "react";
import { useTabStore } from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { schemaService } from "@/services/tauri";
import { DataGrid } from "./DataGrid";
import { GridFilterRow } from "./GridFilterRow";

export function TableDataView() {
  const {
    tabs,
    activeTabId,
    setFilterMode,
    setVisualFilters,
    setSqlFilter,
    updateTabSql,
    runTabQuery,
  } = useTabStore();
  const { activeConnectionId } = useConnectionStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [fallbackColumns, setFallbackColumns] = useState<
    Array<{ name: string; type?: string }>
  >([]);

  // Auto-fetch data on mount if no results
  useEffect(() => {
    if (
      activeTab &&
      activeTab.type === "table" &&
      !activeTab.results &&
      !activeTab.isExecuting &&
      !activeTab.error &&
      activeConnectionId &&
      activeTab.tableName &&
      activeTab.schemaName
    ) {
      const sql = `SELECT * FROM "${activeTab.schemaName}"."${activeTab.tableName}" LIMIT 500`;
      updateTabSql(activeTab.id, sql);
      runTabQuery(activeTab.id, activeConnectionId, sql);
    }
  }, [activeTab, activeConnectionId, runTabQuery, updateTabSql]);

  // Fetch columns metadata if results are missing (for empty state headers)
  useEffect(() => {
    if (
      activeTab?.type === "table" &&
      !activeTab.results &&
      activeConnectionId &&
      activeTab.schemaName &&
      activeTab.tableName
    ) {
      schemaService
        .getColumns(
          activeConnectionId,
          activeTab.schemaName,
          activeTab.tableName
        )
        .then((cols) => {
          if (cols) {
            setFallbackColumns(
              cols.map((c) => ({ name: c.name, type: c.data_type }))
            );
          }
        })
        .catch((err) =>
          console.error("Failed to fetch fallback columns:", err)
        );
    }
  }, [activeTab, activeConnectionId]);

  if (!activeTab || activeTab.type !== "table") return null;

  const result = activeTab?.results?.[0];

  // Get columns from result or fallback
  const columns =
    (result?.columns || fallbackColumns).map((col) => ({
      title: col.name,
      id: col.name,
      width: 150,
    })) || [];

  // Get filter state from active tab
  const filterMode = activeTab.filterMode || "visual";
  const visualFilters = activeTab.visualFilters || [];
  const sqlFilter = activeTab.sqlFilter || "";

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Query Builder Filter Row */}
      {(result || fallbackColumns.length > 0) && (
        <GridFilterRow
          columns={columns}
          mode={filterMode}
          visualFilters={visualFilters}
          sqlFilter={sqlFilter}
          onModeChange={(mode) => setFilterMode(activeTab.id, mode)}
          onVisualFiltersChange={(filters) =>
            setVisualFilters(activeTab.id, filters)
          }
          onSqlFilterChange={(sql) => setSqlFilter(activeTab.id, sql)}
        />
      )}

      {/* Main Grid View */}
      <div className="flex-1 min-h-0 bg-background-tertiary">
        <DataGrid
          columnFilters={visualFilters}
          overrideColumns={fallbackColumns}
        />
      </div>
    </div>
  );
}
