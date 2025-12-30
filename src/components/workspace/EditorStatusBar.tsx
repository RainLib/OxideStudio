import {
  Download,
  AlignJustify,
  ChevronDown,
  RefreshCw,
  Plus,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EditorStatusBarProps {
  type?: "editor" | "table";
  rowCount?: number;
  executionTime?: number; // in ms
  lastRefresh?: string;
  onRefresh?: () => void;
  onAdd?: () => void;
  onSettings?: () => void;
  onStructure?: () => void;
}

export function EditorStatusBar({
  type = "editor",
  rowCount,
  executionTime,
  lastRefresh = "Just now",
  onRefresh,
  onAdd,
  onSettings,
  onStructure,
}: EditorStatusBarProps) {
  const isTable = type === "table";

  return (
    <div
      className={cn(
        "h-[28px] px-3 flex items-center gap-4 text-[10px] select-none shrink-0 transition-colors duration-200"
      )}
    >
      {isTable ? (
        <>
          {/* Table Left Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={onStructure}
              className="font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              Structure
            </button>
            <div className="h-3 w-px bg-border" />
            <span className="text-muted-foreground/70 font-medium">
              {lastRefresh}
            </span>
          </div>

          <div className="h-3 w-px bg-border" />

          {/* Row Count */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlignJustify size={12} strokeWidth={2} />
            <span>
              {rowCount !== undefined ? `${rowCount} rows` : "No results"}
            </span>
          </div>

          {/* Table Pagination Placeholder (Can be expanded) */}
          <div className="flex-1 flex justify-center">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 bg-muted border border-border/60 rounded px-2 h-5 text-muted-foreground">
                <span className="text-[10px] font-medium">1</span>
                <ChevronDown size={10} className="opacity-50" />
              </div>
              <div className="flex items-center gap-3 text-muted-foreground/50">
                <button className="hover:text-foreground transition-colors">
                  <ChevronDown className="rotate-90" size={10} />
                </button>
                <button className="hover:text-foreground transition-colors">
                  <ChevronDown className="-rotate-90" size={10} />
                </button>
              </div>
            </div>
          </div>

          {/* Table Right Actions */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/50"
            >
              <RefreshCw size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onAdd}
              className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/50"
            >
              <Plus size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onSettings}
              className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/50"
            >
              <Settings2 size={12} />
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* Editor Execution Info */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <div
              className={cn(
                "w-2 h-2 rounded-full",
                executionTime ? "bg-green-500/50" : "bg-muted-foreground/30"
              )}
            />
            <span className="font-mono">
              {executionTime ? `${executionTime}ms` : "Ready"}
            </span>
          </div>

          <div className="h-3 w-px bg-border" />

          {/* Editor Row Count */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlignJustify size={12} strokeWidth={2} />
            <span>
              {rowCount !== undefined ? `${rowCount} rows` : "0 rows"}
            </span>
          </div>

          <div className="flex-1" />

          {/* Editor Right Actions */}
          <div className="flex items-center gap-3 text-muted-foreground/70">
            <button className="flex items-center gap-1.5 hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted/50">
              <Download size={12} />
              <span className="text-[10px] font-medium">CSV</span>
            </button>
            <button className="flex items-center gap-1.5 hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted/50">
              <Download size={12} />
              <span className="text-[10px] font-medium">JSON</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
