import { SourceIdentity } from "@/features/data-compare/ui/SourceIdentity";
import type { DataCompareSource } from "@/lib/dataCompare";
import { FileCode2, RefreshCw, Rows3, Square } from "lucide-react";

interface DataCompareHeaderContext {
  left: DataCompareSource;
  right: DataCompareSource;
  sourceTabsAvailable: boolean;
  openDataCompareTab: (leftTabId: string, rightTabId: string) => string | null;
  canCompareFull: boolean;
  isComparingFull: boolean;
  cancelFullComparison: () => Promise<void>;
  runFullComparison: () => Promise<void>;
  canPreviewSync: boolean;
  isPlanningSync: boolean;
  isExecutingSync: boolean;
  previewSync: () => Promise<void>;
}

export function DataCompareHeader({
  left,
  right,
  sourceTabsAvailable,
  openDataCompareTab,
  canCompareFull,
  isComparingFull,
  cancelFullComparison,
  runFullComparison,
  canPreviewSync,
  isPlanningSync,
  isExecutingSync,
  previewSync,
}: DataCompareHeaderContext) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] bg-[hsl(var(--wb-active-strong))] text-cyan-300">
        <Rows3 size={16} />
      </span>
      <SourceIdentity side="Left" source={left} />
      <span className="wb-muted">↔</span>
      <SourceIdentity side="Right" source={right} />
      <button
        type="button"
        className="wb-text-button ml-auto h-7 gap-1.5 px-2.5 text-[10px]"
        disabled={!sourceTabsAvailable || isExecutingSync}
        title={
          sourceTabsAvailable
            ? "Capture the currently loaded results again"
            : "Both source tabs must be open, idle, and free of staged table edits"
        }
        onClick={() => openDataCompareTab(left.tabId, right.tabId)}
      >
        <RefreshCw size={11} /> Refresh loaded data
      </button>
      <button
        type="button"
        className="wb-text-button h-7 gap-1.5 px-2.5 text-[10px]"
        disabled={isExecutingSync || (!canCompareFull && !isComparingFull)}
        title={
          isComparingFull
            ? "Cancel the active table comparison"
            : canCompareFull
              ? "Compare all rows up to 100,000 per table, then use a bounded extreme-key sample up to 10,000,000 rows"
              : "Table compare requires two table tabs, connections, and the complete shared primary key"
        }
        onClick={() =>
          void (isComparingFull ? cancelFullComparison() : runFullComparison())
        }
      >
        {isComparingFull ? <Square size={10} /> : <Rows3 size={11} />}
        {isComparingFull ? "Cancel comparison" : "Compare table data"}
      </button>
      <button
        type="button"
        className="wb-text-button h-7 gap-1.5 px-2.5 text-[10px]"
        disabled={
          !canPreviewSync ||
          isPlanningSync ||
          isComparingFull ||
          isExecutingSync
        }
        title={
          canPreviewSync
            ? "Freeze a short-lived parameterized synchronization plan and generate review SQL"
            : "Sync preview requires an exact, untruncated full-table comparison with differences"
        }
        onClick={() => void previewSync()}
      >
        <FileCode2 size={11} />{" "}
        {isExecutingSync
          ? "Applying sync…"
          : isPlanningSync
            ? "Planning sync…"
            : "Preview sync SQL"}
      </button>
    </header>
  );
}
