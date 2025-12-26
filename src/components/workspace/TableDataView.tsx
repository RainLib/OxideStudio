import { useTabStore } from "@/store/useTabStore";
import { DataGrid } from "./DataGrid";
import { GridFilterRow } from "./GridFilterRow";
import {
  ChevronDown,
  RefreshCw,
  Plus,
  Settings2,
  Table as TableIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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

      {/* Footer / Pagination Bar */}
      <div className="h-10 border-t border-[#333] bg-[#252525] flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button className="text-[10px] font-bold uppercase tracking-wider text-orange-500 hover:text-orange-400">
            Structure
          </button>
          <div className="h-3 w-px bg-[#444]" />
          <span className="text-[10px] text-gray-500">Just now</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-[#1a1a1a] border border-[#444] rounded px-2 h-6">
            <span className="text-xs text-gray-300">1</span>
            <ChevronDown size={14} className="text-gray-500" />
          </div>
          <div className="flex items-center gap-4 text-gray-500">
            <ChevronDown className="rotate-90" size={14} />
            <ChevronDown className="-rotate-90" size={14} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-500 hover:text-white"
          >
            <RefreshCw size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-500 hover:text-white"
          >
            <Plus size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-500 hover:text-white"
          >
            <Settings2 size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
