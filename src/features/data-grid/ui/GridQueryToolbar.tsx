import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GridTabSnapshot } from "@/features/data-grid/model/gridTypes";
import type { TabState } from "@/features/workspace-tabs/model/types";
import type { QueryResultExportFormat } from "@/lib/exportUtils";
import type { QueryResult } from "@/services/tauri/types/query";

import {
  ChevronDown,
  CircleAlert,
  Copy,
  Download,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  Rows3,
} from "lucide-react";

interface GridQueryToolbarProps {
  queryToolbarRef: React.RefObject<HTMLDivElement | null>;
  queryToolbarCompact: boolean;
  isTransposed: boolean;
  sourceResult: QueryResult | undefined;
  result: QueryResult;
  activeTab: GridTabSnapshot | null;
  isActiveResultExecuting: boolean;
  loadMoreNativeQueryPage: TabState["loadMoreNativeQueryPage"];
  setQueryResultTransposed: React.Dispatch<React.SetStateAction<boolean>>;
  handleCopyAll: () => Promise<void>;
  handleExport: (
    format: QueryResultExportFormat,
    extension: "csv" | "json" | "jsonl" | "tsv" | "sql" | "md",
  ) => void;
}

export function GridQueryToolbar({
  queryToolbarRef,
  queryToolbarCompact,
  isTransposed,
  sourceResult,
  result,
  activeTab,
  isActiveResultExecuting,
  loadMoreNativeQueryPage,
  setQueryResultTransposed,
  handleCopyAll,
  handleExport,
}: GridQueryToolbarProps) {
  return (
    <div
      ref={queryToolbarRef}
      data-compact={queryToolbarCompact || undefined}
      className="h-9 shrink-0 overflow-hidden border-b wb-data-toolbar flex items-center gap-2 px-3"
    >
      <div className="shrink-0 text-xs text-muted-foreground">
        {isTransposed && sourceResult
          ? `${sourceResult.columns.length.toLocaleString()} fields × ${sourceResult.rows.length.toLocaleString()} rows`
          : `${result.truncated ? "First " : ""}${result.rows.length.toLocaleString()} row${result.rows.length === 1 ? "" : "s"}`}
      </div>
      {result.truncated && (
        <div
          className="flex min-w-0 items-center gap-1 text-[10px] text-[hsl(var(--wb-accent))]"
          role="status"
          title={`Result limited to ${(result.rowLimit || result.rows.length).toLocaleString()} rows. Add a LIMIT clause or narrow the query to retrieve a smaller, complete result.`}
        >
          <CircleAlert size={12} className="shrink-0" aria-hidden="true" />
          {!queryToolbarCompact && (
            <span className="truncate">Result truncated</span>
          )}
        </div>
      )}
      {activeTab && activeTab.nativeQueryHasMore && !isTransposed && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={isActiveResultExecuting}
          onClick={() => void loadMoreNativeQueryPage(activeTab.id)}
          title="Load the next page from the native query cursor"
          aria-label="Load more query rows"
        >
          <ChevronDown
            size={14}
            className={queryToolbarCompact ? undefined : "mr-1.5"}
          />
          {!queryToolbarCompact && "Load more"}
        </Button>
      )}
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={!sourceResult || sourceResult.rows.length === 0}
        onClick={() => setQueryResultTransposed((current) => !current)}
        title={
          isTransposed
            ? "Show standard result grid"
            : "Transpose rows and columns"
        }
        aria-pressed={isTransposed}
        aria-label={
          isTransposed ? "Show standard result grid" : "Transpose result"
        }
      >
        <Rows3
          size={14}
          className={queryToolbarCompact ? undefined : "mr-1.5"}
        />
        {!queryToolbarCompact && (isTransposed ? "Standard" : "Transpose")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={result.rows.length === 0}
        onClick={() => void handleCopyAll()}
        title="Copy result as TSV"
        aria-label="Copy result as TSV"
      >
        <Copy
          size={14}
          className={queryToolbarCompact ? undefined : "mr-1.5"}
        />
        {!queryToolbarCompact && "Copy"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={result.rows.length === 0}
            title="Export query result"
            aria-label="Export query result"
          >
            <Download
              size={14}
              className={queryToolbarCompact ? undefined : "mr-1.5"}
            />
            {!queryToolbarCompact && "Export"}
            <ChevronDown size={11} className="ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="wb-menu-content min-w-52">
          <DropdownMenuItem
            className="wb-menu-item"
            onSelect={() => handleExport("csv", "csv")}
          >
            <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
            CSV (UTF-8)
          </DropdownMenuItem>
          <DropdownMenuItem
            className="wb-menu-item"
            onSelect={() => handleExport("csvBom", "csv")}
          >
            <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
            CSV (UTF-8 BOM / Excel)
          </DropdownMenuItem>
          <DropdownMenuItem
            className="wb-menu-item"
            onSelect={() => handleExport("json", "json")}
          >
            <FileJson className="mr-2 h-3.5 w-3.5" />
            JSON array
          </DropdownMenuItem>
          <DropdownMenuItem
            className="wb-menu-item"
            onSelect={() => handleExport("jsonl", "jsonl")}
          >
            <FileJson className="mr-2 h-3.5 w-3.5" />
            JSON Lines (JSONL)
          </DropdownMenuItem>
          <DropdownMenuItem
            className="wb-menu-item"
            onSelect={() => handleExport("markdown", "md")}
          >
            <FileCode2 className="mr-2 h-3.5 w-3.5" />
            Markdown table
          </DropdownMenuItem>
          <DropdownMenuItem
            className="wb-menu-item"
            onSelect={() => handleExport("tsv", "tsv")}
          >
            <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
            TSV (Excel)
          </DropdownMenuItem>
          <DropdownMenuItem
            className="wb-menu-item"
            onSelect={() => handleExport("sql", "sql")}
          >
            <FileCode2 className="mr-2 h-3.5 w-3.5" />
            SQL INSERT template
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
