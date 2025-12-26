import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, FileJson, Search, RefreshCw, Columns3 } from "lucide-react";
import { QueryResult } from "@/types/protocol";
import { exportToCsv, exportToJson } from "@/lib/exportUtils";

interface GridToolbarProps {
  result: QueryResult | null;
  onRefresh?: () => void;
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
}

export function GridToolbar({
  result,
  onRefresh,
  globalFilter,
  onGlobalFilterChange,
}: GridToolbarProps) {
  return (
    <div className="h-10 border-b border-[#333] bg-[#252525] flex items-center px-3 gap-2 shrink-0">
      {/* Row count */}
      <div className="text-[11px] text-gray-500 font-medium">
        {result ? (
          <>
            <span className="text-gray-400">
              {result.rows.length.toLocaleString()}
            </span>{" "}
            rows
          </>
        ) : (
          "No results"
        )}
      </div>

      {/* Global search */}
      <div className="relative flex-1 max-w-xs">
        <Input
          placeholder="Search in results..."
          value={globalFilter || ""}
          onChange={(e) => onGlobalFilterChange?.(e.target.value)}
          className="h-7 bg-[#1a1a1a] border-[#444] text-xs pl-7 placeholder:text-gray-600 focus-visible:ring-1 focus-visible:ring-orange-500/50"
        />
        <Search
          size={12}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600"
        />
      </div>

      <div className="flex-1" />

      {/* Action buttons */}
      <div className="flex items-center gap-1">
        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-gray-500 hover:text-white hover:bg-[#333]"
            onClick={onRefresh}
            title="Refresh"
          >
            <RefreshCw size={14} />
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-gray-500 hover:text-white hover:bg-[#333]"
          title="Column visibility"
        >
          <Columns3 size={14} />
        </Button>

        <div className="h-4 w-px bg-[#444] mx-1" />

        {result && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1.5 text-gray-400 hover:text-white hover:bg-[#333]"
              onClick={() => exportToCsv(result)}
            >
              <Download size={12} />
              CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1.5 text-gray-400 hover:text-white hover:bg-[#333]"
              onClick={() => exportToJson(result)}
            >
              <FileJson size={12} />
              JSON
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
