import { SummaryBadge } from "@/features/data-compare/ui/SummaryBadge";
import type { DataCompareResult } from "@/lib/dataCompare";
import { Search } from "lucide-react";

interface DataCompareToolbarContext {
  displayedComparison: DataCompareResult | null;
  canSelectSyncRows: boolean;
  selectedSyncRows: Set<string>;
  selectAllSyncRows: () => void;
  clearSyncRows: () => void;
  showEqual: boolean;
  setShowEqual: React.Dispatch<React.SetStateAction<boolean>>;
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
}

export function DataCompareToolbar({
  displayedComparison,
  canSelectSyncRows,
  selectedSyncRows,
  selectAllSyncRows,
  clearSyncRows,
  showEqual,
  setShowEqual,
  query,
  setQuery,
}: DataCompareToolbarContext) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.62)] px-3">
      {displayedComparison && (
        <>
          <SummaryBadge
            label="Changed"
            value={displayedComparison.counts.changed}
            tone="warning"
          />
          <SummaryBadge
            label="Left only"
            value={displayedComparison.counts.leftOnly}
            tone="danger"
          />
          <SummaryBadge
            label="Right only"
            value={displayedComparison.counts.rightOnly}
            tone="success"
          />
          <SummaryBadge
            label="Duplicate"
            value={displayedComparison.counts.duplicate}
            tone="warning"
          />
          <SummaryBadge
            label="Equal"
            value={displayedComparison.counts.equal}
          />
        </>
      )}
      {canSelectSyncRows && (
        <div className="flex items-center gap-1.5 text-[9px] wb-muted">
          <span>
            {selectedSyncRows.size.toLocaleString()} selected for sync
          </span>
          <button
            type="button"
            className="wb-text-button h-6 px-1.5 text-[8px]"
            onClick={selectAllSyncRows}
          >
            Select all
          </button>
          <button
            type="button"
            className="wb-text-button h-6 px-1.5 text-[8px]"
            onClick={clearSyncRows}
          >
            Clear
          </button>
        </div>
      )}
      <label className="ml-auto flex items-center gap-1.5 text-[9px] wb-muted">
        <input
          type="checkbox"
          checked={showEqual}
          onChange={(event) => setShowEqual(event.target.checked)}
        />
        Show equal
      </label>
      <label className="relative block w-48">
        <Search
          size={10}
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 wb-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find key, column, or value"
          className="h-6 w-full rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] pl-6 pr-2 text-[9px] outline-none focus:border-[hsl(var(--wb-accent)/0.55)]"
        />
      </label>
    </div>
  );
}
