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
    <div className="flex items-center gap-1 px-2 py-1 bg-[#1a1a1a]/80 backdrop-blur-sm rounded-md border border-[#333]">
      {/* Mode Toggle */}
      <div className="flex items-center gap-0.5 bg-[#0f0f0f] rounded p-0.5">
        <button
          onClick={() => onModeChange("auto")}
          className={cn(
            "px-2.5 py-0.5 text-[11px] font-medium rounded transition-all",
            mode === "auto"
              ? "bg-[#2a2a2a] text-gray-200 shadow-sm"
              : "text-gray-500 hover:text-gray-300"
          )}
        >
          Auto
        </button>
        <button
          onClick={() => onModeChange("manual")}
          className={cn(
            "px-2.5 py-0.5 text-[11px] font-medium rounded transition-all",
            mode === "manual"
              ? "bg-[#2a2a2a] text-gray-200 shadow-sm"
              : "text-gray-500 hover:text-gray-300"
          )}
        >
          Manual Commit
        </button>
      </div>

      {/* Manual Controls */}
      {mode === "manual" && (
        <>
          <div className="h-4 w-px bg-[#333] mx-1" />
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
                  : "text-gray-400 hover:text-gray-200 hover:bg-[#2a2a2a]"
              )}
            >
              {state === "active" ? "● Begin" : "Begin"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onCommit}
              disabled={state !== "active"}
              className="h-6 px-2 text-[11px] font-medium text-gray-400 hover:text-gray-200 hover:bg-[#2a2a2a] disabled:opacity-40"
            >
              Commit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onRollback}
              disabled={state !== "active"}
              className="h-6 px-2 text-[11px] font-medium text-gray-400 hover:text-gray-200 hover:bg-[#2a2a2a] disabled:opacity-40"
            >
              Rollback
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
