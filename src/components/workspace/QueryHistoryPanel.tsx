import { confirmAction } from "@/lib/appDialogs";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CircleAlert,
  FilePlus2,
  LoaderCircle,
  Play,
  Search,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { QueryHistoryItem, QueryHistoryStatus } from "@/lib/queryHistory";
import { useHistoryStore } from "@/store/useHistoryStore";

const PAGE_SIZE = 60;

interface QueryHistoryPanelProps {
  onOpenInEditor: (item: QueryHistoryItem) => void;
  onRerun: (item: QueryHistoryItem) => Promise<boolean>;
}

type StatusFilter = "all" | QueryHistoryStatus;

function durationLabel(durationMs: number) {
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 2 : 1)} s`;
}

function itemContext(item: QueryHistoryItem) {
  const namespace = [item.databaseName, item.schemaName]
    .filter(Boolean)
    .join(".");
  return [
    item.connectionName || item.driver || "Unknown data source",
    namespace,
  ]
    .filter(Boolean)
    .join(" · ");
}

function statusLabel(status: QueryHistoryStatus) {
  if (status === "success") return "Succeeded";
  if (status === "cancelled") return "Cancelled";
  return "Failed";
}

export function QueryHistoryPanel({
  onOpenInEditor,
  onRerun,
}: QueryHistoryPanelProps) {
  const history = useHistoryStore((state) => state.history);
  const isLoading = useHistoryStore((state) => state.isLoading);
  const persistenceError = useHistoryStore((state) => state.error);
  const removeHistory = useHistoryStore((state) => state.removeHistory);
  const clearHistory = useHistoryStore((state) => state.clearHistory);
  const clearError = useHistoryStore((state) => state.clearError);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [status, setStatus] = useState<StatusFilter>("all");
  const [connectionId, setConnectionId] = useState("all");
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const connections = useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of history) {
      if (!item.connectionId) continue;
      byId.set(
        item.connectionId,
        item.connectionName || item.driver || item.connectionId
      );
    }
    return [...byId.entries()].sort((left, right) =>
      left[1].localeCompare(right[1])
    );
  }, [history]);

  const filteredHistory = useMemo(
    () =>
      history.filter((item) => {
        if (status !== "all" && item.status !== status) return false;
        if (connectionId !== "all" && item.connectionId !== connectionId) {
          return false;
        }
        if (!deferredQuery) return true;
        return [
          item.sql,
          item.connectionName,
          item.driver,
          item.databaseName,
          item.schemaName,
          item.errorMessage,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(deferredQuery));
      }),
    [connectionId, deferredQuery, history, status]
  );
  const visibleHistory = filteredHistory.slice(0, visibleLimit);

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [connectionId, deferredQuery, status]);

  const handleRerun = async (item: QueryHistoryItem) => {
    setActionError(null);
    setRunningId(item.id);
    try {
      await onRerun(item);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunningId(null);
    }
  };

  const handleClear = async () => {
    if (
      !(await confirmAction(
        `Delete all ${history.length.toLocaleString()} query history entries for this project?`
      ))
    ) {
      return;
    }
    setActionError(null);
    try {
      await clearHistory();
    } catch {
      // The store restores the optimistic update and exposes a durable error.
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[hsl(var(--wb-border-subtle))] p-2">
        <label className="relative min-w-[220px] flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 wb-muted"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-7 w-full rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] pl-7 pr-2 text-[11px] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
            placeholder="Search SQL, data source, schema, or error"
            aria-label="Search query history"
          />
        </label>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          className="h-7 max-w-32 rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] px-2 text-[11px] outline-none focus:border-[hsl(var(--wb-accent))]"
          aria-label="Filter query history by status"
        >
          <option value="all">All statuses</option>
          <option value="success">Succeeded</option>
          <option value="error">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={connectionId}
          onChange={(event) => setConnectionId(event.target.value)}
          className="h-7 max-w-44 rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] px-2 text-[11px] outline-none focus:border-[hsl(var(--wb-accent))]"
          aria-label="Filter query history by data source"
        >
          <option value="all">All data sources</option>
          {connections.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="wb-icon-button h-7 w-7 text-red-300"
          onClick={() => void handleClear()}
          disabled={history.length === 0 || isLoading}
          title="Clear project query history"
          aria-label="Clear project query history"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {(persistenceError || actionError) && (
        <div
          className="flex items-start gap-2 border-b border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200"
          role="alert"
        >
          <CircleAlert size={13} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {actionError || persistenceError}
          </span>
          {persistenceError && (
            <button
              type="button"
              className="shrink-0 underline underline-offset-2"
              onClick={clearError}
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-[11px] wb-muted">
            <LoaderCircle size={14} className="animate-spin" />
            Loading project history…
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="px-4 py-12 text-center text-[11px] wb-muted">
            {history.length === 0
              ? "Run a query to create project history."
              : "No history matches these filters."}
          </div>
        ) : (
          <div className="divide-y divide-[hsl(var(--wb-border-subtle))]">
            {visibleHistory.map((item) => (
              <article
                key={item.id}
                className="group px-3 py-2 hover:bg-[hsl(var(--wb-hover))]"
              >
                <div className="flex items-start gap-2">
                  <span
                    role="img"
                    aria-label={statusLabel(item.status)}
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      item.status === "success" && "bg-emerald-400",
                      item.status === "error" && "bg-red-400",
                      item.status === "cancelled" && "bg-amber-400"
                    )}
                    title={statusLabel(item.status)}
                  />
                  <div className="min-w-0 flex-1">
                    <pre className="max-h-[54px] overflow-hidden whitespace-pre-wrap break-words font-mono text-[11px] leading-[18px] text-[hsl(var(--wb-text))]">
                      {item.sql}
                    </pre>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] wb-muted">
                      <span
                        className="max-w-64 truncate"
                        title={itemContext(item)}
                      >
                        {itemContext(item)}
                      </span>
                      <span>{durationLabel(item.durationMs)}</span>
                      {item.rowCount !== null && (
                        <span>{item.rowCount.toLocaleString()} rows</span>
                      )}
                      <span>{format(item.startedAt, "MMM d, HH:mm:ss")}</span>
                      <span>{item.executionMode}</span>
                    </div>
                    {item.errorMessage && (
                      <div
                        className="mt-1 truncate text-[10px] text-red-300"
                        title={item.errorMessage}
                      >
                        {item.errorMessage}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      className="wb-icon-button h-6 w-6"
                      onClick={() => onOpenInEditor(item)}
                      title="Open in new query"
                      aria-label="Open history entry in new query"
                    >
                      <FilePlus2 size={12} />
                    </button>
                    <button
                      type="button"
                      className="wb-icon-button h-6 w-6 text-emerald-400"
                      onClick={() => void handleRerun(item)}
                      disabled={runningId !== null}
                      title="Run again with its saved context"
                      aria-label="Run history entry again"
                    >
                      {runningId === item.id ? (
                        <LoaderCircle size={12} className="animate-spin" />
                      ) : (
                        <Play size={12} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="wb-icon-button h-6 w-6 text-red-300"
                      onClick={() =>
                        void removeHistory(item.id).catch(() => undefined)
                      }
                      title="Delete history entry"
                      aria-label="Delete history entry"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {!isLoading && filteredHistory.length > 0 && (
        <div className="flex h-8 shrink-0 items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] px-3 text-[10px] wb-muted">
          <span>
            Showing {Math.min(visibleLimit, filteredHistory.length)} of{" "}
            {filteredHistory.length}
          </span>
          {visibleLimit < filteredHistory.length && (
            <button
              type="button"
              className="wb-text-button h-6 px-2 text-[10px]"
              onClick={() => setVisibleLimit((limit) => limit + PAGE_SIZE)}
            >
              Show more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
