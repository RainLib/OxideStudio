import {
  Check,
  ChevronDown,
  CirclePlay,
  RotateCcw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const menuClass =
  "min-w-[176px] rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_16px_40px_rgba(0,0,0,0.42)]";
const itemClass =
  "h-7 cursor-default rounded-[3px] text-[12px] focus:bg-[hsl(var(--wb-active-strong))] focus:text-[hsl(var(--wb-text))]";

export function TransactionControl({
  mode,
  state,
  onModeChange,
  onBegin,
  onCommit,
  onRollback,
}: TransactionControlProps) {
  return (
    <div className="flex h-full items-center gap-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="wb-text-button h-6 gap-1 px-1.5 font-normal"
            title="Transaction Mode"
          >
            <span className="wb-muted">Tx:</span>
            <span>{mode === "auto" ? "Auto" : "Manual"}</span>
            <ChevronDown size={11} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={menuClass}>
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(value) => onModeChange(value as TransactionMode)}
          >
            <DropdownMenuRadioItem value="auto" className={itemClass}>
              Auto-commit
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="manual" className={itemClass}>
              Manual commit
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {mode === "manual" && (
            <>
              <DropdownMenuSeparator className="bg-[hsl(var(--wb-border-subtle))]" />
              <DropdownMenuItem
                className={itemClass}
                onClick={onBegin}
                disabled={state === "active"}
              >
                <CirclePlay size={13} className="mr-2" />
                Begin Transaction
              </DropdownMenuItem>
              <DropdownMenuItem
                className={itemClass}
                onClick={onCommit}
                disabled={state !== "active"}
              >
                <Check size={13} className="mr-2" />
                Commit
              </DropdownMenuItem>
              <DropdownMenuItem
                className={itemClass}
                onClick={onRollback}
                disabled={state !== "active"}
              >
                <RotateCcw size={13} className="mr-2" />
                Rollback
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {mode === "manual" && (
        <>
          <span
            className={cn(
              "mx-1 h-1.5 w-1.5 rounded-full",
              state === "active"
                ? "bg-emerald-400"
                : "bg-[hsl(var(--wb-text-muted))] opacity-45"
            )}
            title={state === "active" ? "Transaction active" : "No transaction"}
          />
          <button
            type="button"
            className="wb-icon-button"
            onClick={state === "active" ? onCommit : onBegin}
            title={state === "active" ? "Commit" : "Begin Transaction"}
          >
            {state === "active" ? <Check size={13} /> : <CirclePlay size={13} />}
          </button>
          <button
            type="button"
            className="wb-icon-button"
            onClick={onRollback}
            disabled={state !== "active"}
            title="Rollback"
          >
            <RotateCcw size={13} />
          </button>
        </>
      )}
    </div>
  );
}
