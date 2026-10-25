import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { DatabaseSearchDialogController } from "@/features/database-search/hooks/useDatabaseSearchDialogController";
import {
  DATABASE_SEARCH_MAX_TABLES,
  databaseSearchNextBatchSize,
} from "@/features/database-search/model/databaseSearch";
import { databaseSearchRelationLabel } from "@/features/database-search/model/databaseSearchDialog";
import {
  AlertTriangle,
  ArrowUpRight,
  Database,
  LoaderCircle,
  Search,
  Square,
  Table2,
} from "lucide-react";

interface DatabaseSearchDialogViewProps {
  controller: DatabaseSearchDialogController;
}

export function DatabaseSearchDialogView({
  controller,
}: DatabaseSearchDialogViewProps) {
  const {
    open,
    closeDialog,
    scopeLabel,
    term,
    setTerm,
    limit,
    setLimit,
    scope,
    isPlanning,
    isScanning,
    stopSearch,
    startSearch,
    statusMessage,
    hits,
    totalFailures,
    progress,
    visibleHits,
    openHit,
    visibleResultCount,
    setVisibleResultCount,
    plan,
    resultsTruncated,
    failures,
    hasRemaining,
    continuationMatchesInput,
    runPlanBatch,
  } = controller;
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && closeDialog()}>
      <DialogContent layout="custom" className="grid h-[min(760px,calc(100vh-32px))] w-[min(960px,calc(100vw-32px))] max-w-none grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 [&>button]:right-3 [&>button]:top-3">
        <DialogHeader className="space-y-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 pr-11 text-left">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-[hsl(var(--wb-accent))]" />
            <DialogTitle className="text-[13px] font-semibold">
              Search Database Rows
            </DialogTitle>
          </div>
          <DialogDescription className="mt-1 truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
            {scopeLabel}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid grid-cols-[minmax(0,1fr)_112px_auto] gap-2 border-b border-[hsl(var(--wb-border-subtle))] p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void startSearch();
          }}
        >
          <Input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Value to find across table rows"
            className="h-8 rounded-[4px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2.5 text-[12px] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] focus-visible:ring-offset-0"
            disabled={!scope || isPlanning || isScanning}
          />
          <label className="relative">
            <span className="sr-only">Rows per table</span>
            <Input
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(event) =>
                setLimit(
                  Math.min(100, Math.max(1, Number(event.target.value) || 1)),
                )
              }
              className="h-8 rounded-[4px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] pr-12 text-[12px] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] focus-visible:ring-offset-0"
              disabled={isPlanning || isScanning}
            />
            <span className="pointer-events-none absolute right-2 top-2 text-[9px] uppercase text-[hsl(var(--wb-text-muted))]">
              / table
            </span>
          </label>
          {isPlanning || isScanning ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 rounded-[4px] border-[hsl(var(--wb-border))] px-3 text-[11px]"
              onClick={stopSearch}
            >
              <Square size={11} /> Stop
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              className="h-8 gap-1.5 rounded-[4px] px-3 text-[11px]"
              disabled={!scope || !term.trim()}
            >
              <Search size={12} /> Search
            </Button>
          )}
        </form>

        <div className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-2">
          <div className="flex min-h-5 items-center gap-3 text-[10px] text-[hsl(var(--wb-text-muted))]">
            {(isPlanning || isScanning) && (
              <LoaderCircle
                size={12}
                className="animate-spin text-[hsl(var(--wb-accent))] motion-reduce:animate-none"
              />
            )}
            <span className="min-w-0 flex-1 truncate">
              {statusMessage || "Enter a value to search the selected database scope."}
            </span>
            <span>{hits.length.toLocaleString()} matches</span>
            {totalFailures > 0 && (
              <span className="text-amber-500">
                {totalFailures.toLocaleString()} failed
              </span>
            )}
          </div>
          <div className="mt-1.5 h-0.5 overflow-hidden bg-[hsl(var(--wb-border-subtle))]">
            <div
              className="h-full bg-[hsl(var(--wb-accent))] transition-[width] duration-200 motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="min-h-0 overflow-auto bg-[hsl(var(--wb-editor))]">
          {visibleHits.length === 0 ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-6 text-center">
              <Database size={24} className="text-[hsl(var(--wb-text-muted))]" />
              <p className="text-[12px] text-[hsl(var(--wb-text))]">
                {isPlanning || isScanning
                  ? "Scanning live table data…"
                  : "No matching rows yet"}
              </p>
              <p className="max-w-md text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                Search runs one bounded table query at a time. Views, binary
                values, and system schemas are excluded.
              </p>
            </div>
          ) : (
            <div role="list" aria-label="Database search results">
              {visibleHits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  role="listitem"
                  className="group grid w-full grid-cols-[minmax(170px,0.7fr)_minmax(0,1.3fr)_auto] items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-left hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]"
                  onClick={() => void openHit(hit)}
                  disabled={!hit.whereInput}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Table2 size={12} className="shrink-0 text-[hsl(var(--wb-accent))]" />
                    <span className="truncate font-mono text-[11px] text-[hsl(var(--wb-text))]">
                      {databaseSearchRelationLabel(hit.schema, hit.table)}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] text-[hsl(var(--wb-text))]">
                      {hit.preview || "Matching row"}
                    </span>
                    <span className="mt-0.5 flex gap-1 overflow-hidden text-[9px] text-[hsl(var(--wb-text-muted))]">
                      {hit.matchedColumns.slice(0, 4).map((column) => (
                        <span
                          key={column}
                          className="rounded-[3px] border border-[hsl(var(--wb-border-subtle))] px-1 py-0.5"
                        >
                          {column}
                        </span>
                      ))}
                    </span>
                  </span>
                  <ArrowUpRight
                    size={12}
                    className="text-[hsl(var(--wb-text-muted))] group-hover:text-[hsl(var(--wb-text))]"
                  />
                </button>
              ))}
              {visibleResultCount < hits.length && (
                <button
                  type="button"
                  className="h-8 w-full text-[10px] text-[hsl(var(--wb-accent))] hover:bg-[hsl(var(--wb-hover))]"
                  onClick={() =>
                    setVisibleResultCount((count) =>
                      Math.min(hits.length, count + 200),
                    )
                  }
                >
                  Show next {Math.min(200, hits.length - visibleResultCount)} results
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex min-h-11 items-center gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3 py-2">
          <div className="min-w-0 flex-1 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
            {plan?.metadataTruncated && (
              <span className="mr-3 text-amber-500">
                Table plan limited to {DATABASE_SEARCH_MAX_TABLES.toLocaleString()} entries.
              </span>
            )}
            {resultsTruncated && (
              <span className="mr-3 text-amber-500">
                Stored results reached the 5,000-row / 8 MiB safety budget.
              </span>
            )}
            {failures.length > 0 && (
              <span title={failures.slice(0, 20).map((failure) => `${databaseSearchRelationLabel(failure.schema, failure.table)}: ${failure.message}`).join("\n")}>
                <AlertTriangle size={10} className="mr-1 inline text-amber-500" />
                Hover for the first {Math.min(20, failures.length)} table errors.
              </span>
            )}
          </div>
          {hasRemaining && !isPlanning && !isScanning && continuationMatchesInput && plan && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-[4px] border-[hsl(var(--wb-border))] px-2.5 text-[10px]"
                onClick={() => void runPlanBatch(plan, false)}
              >
                Next {databaseSearchNextBatchSize(plan.nextIndex, plan.tasks.length)} tables
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-[4px] px-2.5 text-[10px]"
                onClick={() => void runPlanBatch(plan, true)}
              >
                Scan all remaining
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
