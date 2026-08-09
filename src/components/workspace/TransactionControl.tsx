import {
  Check,
  ChevronDown,
  CirclePlay,
  LoaderCircle,
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
type TransactionOperation = "begin" | "commit" | "rollback" | null;

interface TransactionControlProps {
  mode: TransactionMode;
  state: TransactionState;
  operation: TransactionOperation;
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
  operation,
  onModeChange,
  onBegin,
  onCommit,
  onRollback,
}: TransactionControlProps) {
  const operationLabel = operation
    ? `${operation === "begin" ? "Beginning" : operation === "commit" ? "Committing" : "Rolling back"} transaction…`
    : null;
  const isBusy = operation !== null;

  return (
    <div
      className="flex h-full items-center gap-0.5"
      aria-busy={isBusy}
      aria-label={operationLabel || "Transaction controls"}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="wb-text-button h-6 gap-1 px-1.5 font-normal"
            title={operationLabel || "Transaction Mode"}
            disabled={isBusy}
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
            <DropdownMenuRadioItem
              value="auto"
              className={itemClass}
              disabled={isBusy}
            >
              Auto-commit
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="manual"
              className={itemClass}
              disabled={isBusy}
            >
              Manual commit
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {mode === "manual" && (
            <>
              <DropdownMenuSeparator className="bg-[hsl(var(--wb-border-subtle))]" />
              <DropdownMenuItem
                className={itemClass}
                onClick={onBegin}
                disabled={isBusy || state === "active"}
              >
                <CirclePlay size={13} className="mr-2" />
                Begin Transaction
              </DropdownMenuItem>
              <DropdownMenuItem
                className={itemClass}
                onClick={onCommit}
                disabled={isBusy || state !== "active"}
              >
                <Check size={13} className="mr-2" />
                Commit
              </DropdownMenuItem>
              <DropdownMenuItem
                className={itemClass}
                onClick={onRollback}
                disabled={isBusy || state !== "active"}
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
              isBusy
                ? "animate-pulse bg-amber-400"
                : state === "active"
                  ? "bg-emerald-400"
                  : "bg-[hsl(var(--wb-text-muted))] opacity-45",
            )}
            title={
              operationLabel ||
              (state === "active" ? "Transaction active" : "No transaction")
            }
          />
          <button
            type="button"
            className="wb-icon-button"
            onClick={state === "active" ? onCommit : onBegin}
            disabled={isBusy}
            title={
              operationLabel ||
              (state === "active" ? "Commit" : "Begin Transaction")
            }
          >
            {isBusy ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : state === "active" ? (
              <Check size={13} />
            ) : (
              <CirclePlay size={13} />
            )}
          </button>
          <button
            type="button"
            className="wb-icon-button"
            onClick={onRollback}
            disabled={isBusy || state !== "active"}
            title={operationLabel || "Rollback"}
          >
            <RotateCcw size={13} />
          </button>
        </>
      )}
    </div>
  );
}
