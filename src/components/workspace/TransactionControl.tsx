import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TransactionMode = "auto" | "manual";
type TransactionState = "idle" | "active";

interface TransactionControlProps {
  mode: TransactionMode;
  state: TransactionState;
  onModeChange: (mode: TransactionMode) => void;
  onBegin: () => void;
  onCommit: () => void;
  onRollback: () => void;
}

export function TransactionControl({
  mode,
  state,
  onModeChange,
  onBegin,
  onCommit,
  onRollback,
}: TransactionControlProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-background-secondary/80 backdrop-blur-sm rounded-md border border-border">
      {/* Mode Toggle */}
      <div className="flex items-center gap-0.5 bg-background-primary rounded p-0.5">
        <button
          onClick={() => onModeChange("auto")}
          className={cn(
            "px-2.5 py-0.5 text-[11px] font-medium rounded transition-all",
            mode === "auto"
              ? "bg-background-elevated text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Auto
        </button>
        <button
          onClick={() => onModeChange("manual")}
          className={cn(
            "px-2.5 py-0.5 text-[11px] font-medium rounded transition-all",
            mode === "manual"
              ? "bg-background-elevated text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Manual Commit
        </button>
      </div>

      {/* Manual Controls */}
      {mode === "manual" && (
        <>
          <div className="h-4 w-px bg-border mx-1" />
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={onBegin}
              disabled={state === "active"}
              className={cn(
                "h-6 px-2 text-[11px] font-medium transition-all",
                state === "active"
                  ? "text-green-500 bg-green-500/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-background-elevated"
              )}
            >
              {state === "active" ? "● Begin" : "Begin"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onCommit}
              disabled={state !== "active"}
              className="h-6 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-background-elevated disabled:opacity-40"
            >
              Commit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onRollback}
              disabled={state !== "active"}
              className="h-6 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-background-elevated disabled:opacity-40"
            >
              Rollback
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
