import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Equal,
  RefreshCw,
  Rows3,
  Search,
} from "lucide-react";
import {
  compareDataSources,
  sharedDataCompareColumns,
  suggestedDataCompareKeys,
  type DataCompareFieldDifference,
  type DataCompareRow,
  type DataCompareRowStatus,
  type DataCompareSource,
} from "@/lib/dataCompare";
import { cn } from "@/lib/utils";
import {
  canCreateDataCompareSource,
  useTabStore,
} from "@/store/useTabStore";

const DISPLAY_LIMIT = 2_000;

export function DataCompareView() {
  const { tabs, activeTabId, openDataCompareTab } = useTabStore();
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const left = activeTab?.dataCompareLeft;
  const right = activeTab?.dataCompareRight;
  const [keyColumns, setKeyColumns] = useState<string[]>([]);
  const [absoluteTolerance, setAbsoluteTolerance] = useState("0");
  const [relativeTolerancePercent, setRelativeTolerancePercent] = useState("0");
  const [showEqual, setShowEqual] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!left || !right) return;
    setKeyColumns(suggestedDataCompareKeys(left, right));
  }, [left, right]);

  const comparison = useMemo(() => {
    if (!left || !right) return { result: null, error: null };
    try {
      return {
        result: compareDataSources(left, right, {
          keyColumns,
          absoluteTolerance: Number(absoluteTolerance),
          relativeTolerance: Number(relativeTolerancePercent) / 100,
        }),
        error: null,
      };
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [absoluteTolerance, keyColumns, left, relativeTolerancePercent, right]);

  if (
    !activeTab ||
    activeTab.type !== "data_compare" ||
    !left ||
    !right
  ) {
    return null;
  }

  const leftSourceTab = tabs.find((tab) => tab.id === left.tabId);
  const rightSourceTab = tabs.find((tab) => tab.id === right.tabId);
  const sourceTabsAvailable = Boolean(
    leftSourceTab &&
      rightSourceTab &&
      canCreateDataCompareSource(leftSourceTab) &&
      canCreateDataCompareSource(rightSourceTab),
  );
  const sharedColumns = sharedDataCompareColumns(left, right);
  const rows = comparison.result
    ? flattenRows(comparison.result.rows, left, right, showEqual, query)
    : [];
  const displayedRows = rows.slice(0, DISPLAY_LIMIT);

  const toggleKey = (column: string) => {
    setKeyColumns((current) =>
      current.includes(column)
        ? current.filter((candidate) => candidate !== column)
        : [...current, column],
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--wb-editor))] text-[hsl(var(--wb-text))]">
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
          disabled={!sourceTabsAvailable}
          title={
            sourceTabsAvailable
              ? "Capture the currently loaded results again"
              : "Both source tabs must be open, idle, and free of staged table edits"
          }
          onClick={() => openDataCompareTab(left.tabId, right.tabId)}
        >
          <RefreshCw size={11} /> Refresh loaded data
        </button>
      </header>

      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.62)] px-3">
        {comparison.result && (
          <>
            <SummaryBadge label="Changed" value={comparison.result.counts.changed} tone="warning" />
            <SummaryBadge label="Left only" value={comparison.result.counts.leftOnly} tone="danger" />
            <SummaryBadge label="Right only" value={comparison.result.counts.rightOnly} tone="success" />
            <SummaryBadge label="Duplicate" value={comparison.result.counts.duplicate} tone="warning" />
            <SummaryBadge label="Equal" value={comparison.result.counts.equal} />
          </>
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
          <Search size={10} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 wb-muted" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find key, column, or value"
            className="h-6 w-full rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] pl-6 pr-2 text-[9px] outline-none focus:border-[hsl(var(--wb-accent)/0.55)]"
          />
        </label>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-auto border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel)/0.72)]">
          <section className="border-b border-[hsl(var(--wb-border-subtle))]">
            <div className="px-3 pb-1 pt-3 text-[8px] font-semibold uppercase tracking-[0.12em] wb-muted">
              Match rows by
            </div>
            <div className="pb-2">
              {sharedColumns.map((column) => (
                <label
                  key={column}
                  className="flex h-7 cursor-pointer items-center gap-2 px-3 text-[9px] hover:bg-[hsl(var(--wb-hover))]"
                >
                  <input
                    type="checkbox"
                    checked={keyColumns.includes(column)}
                    onChange={() => toggleKey(column)}
                  />
                  <span className="truncate font-mono">{column}</span>
                  {left.suggestedKeyColumns.includes(column) &&
                    right.suggestedKeyColumns.includes(column) && (
                      <span className="ml-auto text-[7px] uppercase text-amber-300">PK</span>
                    )}
                </label>
              ))}
              {sharedColumns.length === 0 && (
                <p className="px-3 py-2 text-[9px] leading-4 text-rose-300">
                  The sources have no columns with matching names.
                </p>
              )}
            </div>
          </section>

          <section className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-3">
            <div className="text-[8px] font-semibold uppercase tracking-[0.12em] wb-muted">
              Numeric tolerance
            </div>
            <label className="mt-2 grid grid-cols-[1fr_72px] items-center gap-2 text-[9px]">
              <span>Absolute</span>
              <input
                aria-label="Absolute tolerance"
                type="number"
                min="0"
                step="any"
                value={absoluteTolerance}
                onChange={(event) => setAbsoluteTolerance(event.target.value)}
                className="h-6 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[9px] outline-none"
              />
            </label>
            <label className="mt-1.5 grid grid-cols-[1fr_72px] items-center gap-2 text-[9px]">
              <span>Relative %</span>
              <input
                aria-label="Relative tolerance percent"
                type="number"
                min="0"
                step="any"
                value={relativeTolerancePercent}
                onChange={(event) => setRelativeTolerancePercent(event.target.value)}
                className="h-6 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[9px] outline-none"
              />
            </label>
            <p className="mt-2 text-[8px] leading-3.5 wb-muted">
              Equal when Δ ≤ absolute + relative × max magnitude. Non-numeric values remain exact.
            </p>
          </section>

          {comparison.result && (
            <section className="px-3 py-3 text-[8px] leading-4 wb-muted">
              <div>{comparison.result.comparedColumns.length} shared value columns</div>
              <div>{left.rows.length.toLocaleString()} loaded left rows</div>
              <div>{right.rows.length.toLocaleString()} loaded right rows</div>
              {comparison.result.leftOnlyColumns.length > 0 && (
                <div className="mt-2 break-words">
                  Left-only columns: {comparison.result.leftOnlyColumns.join(", ")}
                </div>
              )}
              {comparison.result.rightOnlyColumns.length > 0 && (
                <div className="mt-1 break-words">
                  Right-only columns: {comparison.result.rightOnlyColumns.join(", ")}
                </div>
              )}
              {comparison.result.typeMismatchColumns.length > 0 && (
                <div className="mt-1 break-words">
                  Type mismatches: {comparison.result.typeMismatchColumns
                    .map(
                      (item) =>
                        `${item.column} (${item.leftDataType} ↔ ${item.rightDataType})`,
                    )
                    .join(", ")}
                </div>
              )}
            </section>
          )}
        </aside>

        <main className="min-h-0 overflow-auto">
          {comparison.error ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-[10px] text-rose-300">
              {comparison.error}
            </div>
          ) : comparison.result ? (
            <>
              {comparison.result.warnings.length > 0 && (
                <div className="border-b border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[9px] text-amber-200">
                  {comparison.result.warnings.map((warning) => (
                    <div key={warning} className="flex items-start gap-1.5 leading-4">
                      <AlertTriangle size={10} className="mt-0.5 shrink-0" /> {warning}
                    </div>
                  ))}
                </div>
              )}
              <table className="w-full table-fixed border-collapse text-[9px]">
                <thead className="sticky top-0 z-10 bg-[hsl(var(--wb-toolbar))] text-left wb-muted">
                  <tr>
                    <th className="w-24 border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 font-medium">Status</th>
                    <th className="w-52 border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 font-medium">Key</th>
                    <th className="w-36 border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 font-medium">Column</th>
                    <th className="border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 font-medium">{left.label}</th>
                    <th className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 font-medium">{right.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.map((row) => (
                    <CompareLine key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <div className="flex h-48 items-center justify-center text-[10px] wb-muted">
                  No rows match the current view.
                </div>
              )}
              {rows.length > DISPLAY_LIMIT && (
                <div className="border-t border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-[9px] text-amber-200">
                  Showing the first {DISPLAY_LIMIT.toLocaleString()} of {rows.length.toLocaleString()} comparison lines.
                </div>
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}

interface FlatCompareLine {
  id: string;
  status: DataCompareRowStatus;
  key: string;
  column: string;
  left: string;
  right: string;
  toleranceMatched: boolean;
}

function flattenRows(
  rows: DataCompareRow[],
  left: DataCompareSource,
  right: DataCompareSource,
  showEqual: boolean,
  query: string,
) {
  const lines = rows.flatMap<FlatCompareLine>((row) => {
    if (row.status === "equal" && !showEqual) return [];
    const key = row.key
      .map((item) => `${item.column}=${formatValue(item.value)}`)
      .join(" · ");
    if (row.status === "changed") {
      return row.fields
        .filter((field) => !field.equal)
        .map((field) => fieldLine(row, key, field));
    }
    if (row.status === "equal") {
      const tolerant = row.fields.filter((field) => field.toleranceMatched);
      return [{
        id: `${row.id}:equal`,
        status: row.status,
        key,
        column: tolerant.length > 0 ? `${tolerant.length} within tolerance` : "All shared fields",
        left: "Equal",
        right: "Equal",
        toleranceMatched: tolerant.length > 0,
      }];
    }
    if (row.status === "duplicate") {
      return [{
        id: `${row.id}:duplicate`,
        status: row.status,
        key,
        column: "Ambiguous key",
        left: `${row.leftMatchCount} matching rows`,
        right: `${row.rightMatchCount} matching rows`,
        toleranceMatched: false,
      }];
    }
    return [{
      id: `${row.id}:${row.status}`,
      status: row.status,
      key,
      column: "Loaded row",
      left: row.leftRow ? formatRow(left, row.leftRow) : "—",
      right: row.rightRow ? formatRow(right, row.rightRow) : "—",
      toleranceMatched: false,
    }];
  });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return normalizedQuery
    ? lines.filter((line) =>
        [line.key, line.column, line.left, line.right].some((value) =>
          value.toLocaleLowerCase().includes(normalizedQuery),
        ),
      )
    : lines;
}

function fieldLine(
  row: DataCompareRow,
  key: string,
  field: DataCompareFieldDifference,
): FlatCompareLine {
  return {
    id: `${row.id}:${field.column}`,
    status: row.status,
    key,
    column: field.column,
    left: formatValue(field.left),
    right: formatValue(field.right),
    toleranceMatched: field.toleranceMatched,
  };
}

function CompareLine({ row }: { row: FlatCompareLine }) {
  return (
    <tr className="hover:bg-[hsl(var(--wb-hover)/0.72)]">
      <td className="border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 align-top">
        <StatusLabel status={row.status} />
      </td>
      <td className="break-all border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 align-top font-mono text-[8px]">{row.key}</td>
      <td className="border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 align-top font-mono">{row.column}</td>
      <td className={cn("break-all border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 align-top font-mono", row.status === "changed" && "bg-rose-400/[0.055]")}>{row.left}</td>
      <td className={cn("break-all border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 align-top font-mono", row.status === "changed" && "bg-emerald-400/[0.055]")}>{row.right}</td>
    </tr>
  );
}

function StatusLabel({ status }: { status: DataCompareRowStatus }) {
  const labels: Record<DataCompareRowStatus, string> = {
    changed: "Changed",
    leftOnly: "Left only",
    rightOnly: "Right only",
    duplicate: "Duplicate",
    equal: "Equal",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        status === "changed" && "text-amber-300",
        status === "leftOnly" && "text-rose-300",
        status === "rightOnly" && "text-emerald-300",
        status === "duplicate" && "text-orange-300",
        status === "equal" && "wb-muted",
      )}
    >
      {status === "equal" ? <Equal size={9} /> : <span aria-hidden>●</span>}
      {labels[status]}
    </span>
  );
}

function SourceIdentity({
  side,
  source,
}: {
  side: string;
  source: DataCompareSource;
}) {
  return (
    <div className="min-w-0 max-w-[34%] flex-1">
      <div className="flex items-center gap-1.5 text-[8px] uppercase tracking-[0.11em] wb-muted">
        {side} · {source.sourceKind === "table" ? `page ${source.page || 1} · ` : `result ${source.resultIndex + 1} · `}
        {source.rows.length.toLocaleString()} rows
        {source.truncated && <span className="text-amber-300">truncated</span>}
      </div>
      <div className="mt-0.5 truncate text-[10px] font-semibold" title={source.label}>
        {source.label}
      </div>
    </div>
  );
}

function SummaryBadge({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "muted" | "warning" | "danger" | "success";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-[3px] border px-1.5 text-[8px]",
        tone === "muted" && "border-[hsl(var(--wb-border-subtle))] wb-muted",
        tone === "warning" && "border-amber-400/20 text-amber-300",
        tone === "danger" && "border-rose-400/20 text-rose-300",
        tone === "success" && "border-emerald-400/20 text-emerald-300",
      )}
    >
      {value === 0 ? <Check size={8} /> : null}
      {label} {value.toLocaleString()}
    </span>
  );
}

function formatRow(source: DataCompareSource, row: unknown[]) {
  return formatValue(
    Object.fromEntries(
      source.columns.map((column, index) => [column.name, row[index]]),
    ),
  );
}

function formatValue(value: unknown) {
  if (value === null) return "NULL";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value === "" ? '""' : bound(value);
  if (typeof value === "object") {
    try {
      return bound(JSON.stringify(value));
    } catch {
      return "[unserializable value]";
    }
  }
  return bound(String(value));
}

function bound(value: string) {
  return value.length > 320 ? `${value.slice(0, 317)}…` : value;
}
