import {
  Download,
  Clock,
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
        "h-[28px] px-3 flex items-center gap-4 text-[11px] font-bold select-none shrink-0 shadow-[0_-1px_2px_rgba(0,0,0,0.1)] z-50 transition-colors duration-200 bg-primary text-primary-foreground"
      )}
    >
      {isTable ? (
        <>
          {/* Table Left Actions */}
          <div className="flex items-center gap-4">
            <button
              onClick={onStructure}
              className="text-[10px] font-bold uppercase tracking-wider text-primary-foreground hover:opacity-70 transition-opacity"
            >
              Structure
            </button>
            <div className="h-3 w-px bg-primary-foreground/20" />
            <span className="text-[10px] text-primary-foreground/60 font-medium">
              {lastRefresh}
            </span>
          </div>

          <div className="h-3 w-px bg-primary-foreground/20" />

          {/* Row Count */}
          <div className="flex items-center gap-2 opacity-80">
            <AlignJustify size={12} strokeWidth={2.5} />
            <span>
              {rowCount !== undefined ? `${rowCount} rows` : "No results"}
            </span>
          </div>

          {/* Table Pagination Placeholder (Can be expanded) */}
          <div className="flex-1 flex justify-center">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 bg-primary-foreground/10 border border-primary-foreground/20 rounded px-2 h-5">
                <span className="text-[10px] text-primary-foreground">1</span>
                <ChevronDown size={12} className="text-primary-foreground/60" />
              </div>
              <div className="flex items-center gap-4 text-primary-foreground/60">
                <ChevronDown className="rotate-90" size={12} />
                <ChevronDown className="-rotate-90" size={12} />
              </div>
            </div>
          </div>

          {/* Table Right Actions */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              className="h-6 w-6 text-primary-foreground/60 hover:text-primary-foreground hover:bg-primary-foreground/10"
            >
              <RefreshCw size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onAdd}
              className="h-6 w-6 text-primary-foreground/60 hover:text-primary-foreground hover:bg-primary-foreground/10"
            >
              <Plus size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onSettings}
              className="h-6 w-6 text-primary-foreground/60 hover:text-primary-foreground hover:bg-primary-foreground/10"
            >
              <Settings2 size={12} />
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* Editor Execution Info */}
          <div className="flex items-center gap-2 opacity-80">
            <Clock size={12} strokeWidth={2.5} />
            <span>{executionTime ? `${executionTime}ms` : "Ready"}</span>
          </div>

          <div className="h-3 w-[1px] bg-primary-foreground/20" />

          {/* Editor Row Count */}
          <div className="flex items-center gap-2 opacity-80">
            <AlignJustify size={12} strokeWidth={2.5} />
            <span>
              {rowCount !== undefined ? `${rowCount} rows` : "No results"}
            </span>
          </div>

          {/* Editor Right Actions */}
          <div className="ml-auto flex items-center gap-3 opacity-70">
            <div className="flex items-center gap-1 cursor-pointer hover:opacity-100 transition-opacity">
              <Download size={12} />
              <span className="text-[10px]">Download CSV</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
