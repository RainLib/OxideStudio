import React from "react";
import { Search, Download, FileJson, RefreshCw, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryResult } from "@/services/tauri";

interface GridToolbarProps {
  result?: QueryResult;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onExportCsv?: () => void;
  onExportJson?: () => void;
  onRefresh?: () => void;
  showFilters?: boolean;
  onToggleFilters?: () => void;
}

export const GridToolbar: React.FC<GridToolbarProps> = ({
  result,
  searchTerm,
  onSearchChange,
  onExportCsv,
  onExportJson,
  onRefresh,
  showFilters = false,
  onToggleFilters,
}) => {
  const rowCount = result?.rows.length || 0;
  const resultSummary =
    result?.message ||
    (typeof result?.rowsAffected === "number"
      ? `${result.rowsAffected.toLocaleString()} row${
          result.rowsAffected === 1 ? "" : "s"
        } affected`
      : `${rowCount.toLocaleString()} row${rowCount !== 1 ? "s" : ""}`);

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b bg-background">
      {/* Row count */}
      {result && (
        <div className="text-xs text-muted-foreground min-w-fit">
          {resultSummary}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Filter toggle */}
      {result && rowCount > 0 && onToggleFilters && (
        <Button
          variant={showFilters ? "secondary" : "ghost"}
          size="sm"
          onClick={onToggleFilters}
          className="h-8 px-2.5 text-xs"
          title="Toggle filters"
        >
          <Filter className="h-3.5 w-3.5 mr-1.5" />
          <span className="hidden sm:inline">Filter</span>
        </Button>
      )}

      {/* Search */}
      {result && rowCount > 0 && (
        <div className="relative w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search in results..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      )}

      {/* Refresh */}
      {onRefresh && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="h-8 px-2.5 text-xs"
          title="Refresh data"
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      )}

      {/* Export buttons */}
      {result && rowCount > 0 && (
        <>
          <div className="h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            onClick={onExportCsv}
            className="h-8 px-2.5 text-xs"
            title="Export as CSV"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            <span className="hidden sm:inline">CSV</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onExportJson}
            className="h-8 px-2.5 text-xs"
            title="Export as JSON"
          >
            <FileJson className="h-3.5 w-3.5 mr-1.5" />
            <span className="hidden sm:inline">JSON</span>
          </Button>
        </>
      )}
    </div>
  );
};
