import { useTabStore } from "@/store/useTabStore";
import { DataGrid } from "./DataGrid";
import {
  Search,
  ChevronDown,
  Filter,
  RefreshCw,
  Plus,
  Settings2,
  Table as TableIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TableDataView() {
  const { tabs, activeTabId } = useTabStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab || activeTab.type !== "table") return null;

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* Filter Bar (Beekeeper Style) */}
      <div className="flex items-center gap-2 p-2 border-b border-[#333] bg-[#252525] shrink-0">
        <div className="flex items-center gap-1 bg-[#1a1a1a] rounded px-2 py-1 border border-[#444] min-w-[150px]">
          <TableIcon size={14} className="text-gray-500" />
          <span className="text-xs text-gray-300 font-medium truncate">
            {activeTab.tableName}
          </span>
          <ChevronDown size={14} className="text-gray-500 ml-auto" />
        </div>

        <div className="h-6 w-px bg-[#444] mx-1" />

        {/* Filter Input Group */}
        <div className="flex items-center flex-1 gap-1">
          <select className="h-8 w-[140px] bg-[#1a1a1a] border border-[#444] rounded text-xs px-2 text-gray-300 focus:outline-none focus:border-orange-500/50">
            <option value="all">All Columns</option>
          </select>

          <select className="h-8 w-[100px] bg-[#1a1a1a] border border-[#444] rounded text-xs px-2 text-gray-300 font-mono focus:outline-none focus:border-orange-500/50">
            <option value="equals">=</option>
            <option value="contains">contains</option>
            <option value="starts">starts</option>
          </select>

          <div className="relative flex-1">
            <Input
              placeholder="Enter value..."
              className="h-8 bg-[#1a1a1a] border-[#444] text-xs pl-8 focus-visible:ring-1 focus-visible:ring-orange-500/50"
            />
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-400 hover:text-white hover:bg-[#333]"
          >
            <Plus size={16} />
          </Button>
        </div>

        <div className="h-6 w-px bg-[#444] mx-1" />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-400 hover:text-white"
          >
            <RefreshCw size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-400 hover:text-white"
          >
            <Filter size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-400 hover:text-white"
          >
            <Settings2 size={14} />
          </Button>
        </div>
      </div>

      {/* Main Grid View */}
      <div className="flex-1 min-h-0 bg-[#1e1e1e]">
        <DataGrid />
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
