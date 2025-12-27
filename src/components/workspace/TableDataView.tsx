import { useTabStore } from "@/store/useTabStore";
import { DataGrid } from "./DataGrid";
import { GridFilterRow } from "./GridFilterRow";

export function TableDataView() {
  const { tabs, activeTabId, setFilterMode, setVisualFilters, setSqlFilter } =
    useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab || activeTab.type !== "table") return null;

  const result = activeTab?.results?.[0];

  // Get columns from result
  const columns =
    result?.columns.map((col) => ({
      title: col.name,
      id: col.name,
      width: 150,
    })) || [];

  // Get filter state from active tab
  const filterMode = activeTab.filterMode || "visual";
  const visualFilters = activeTab.visualFilters || [];
  const sqlFilter = activeTab.sqlFilter || "";

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* Query Builder Filter Row */}
      {result && (
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
      <div className="flex-1 min-h-0 bg-[#1e1e1e]">
        <DataGrid columnFilters={visualFilters} />
      </div>
    </div>
  );
}
