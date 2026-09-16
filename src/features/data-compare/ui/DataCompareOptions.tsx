import type { FullComparisonMeta } from "@/features/data-compare/model/dataCompareSessionTypes";
import type { DataCompareResult, DataCompareSource } from "@/lib/dataCompare";

interface DataCompareOptionsContext {
  sharedColumns: string[];
  keyColumns: string[];
  toggleKey: (column: string) => void;
  left: DataCompareSource;
  right: DataCompareSource;
  ignoredColumns: Set<string>;
  toggleComparedColumn: (column: string) => void;
  absoluteTolerance: string;
  setAbsoluteTolerance: React.Dispatch<React.SetStateAction<string>>;
  relativeTolerancePercent: string;
  setRelativeTolerancePercent: React.Dispatch<React.SetStateAction<string>>;
  displayedComparison: DataCompareResult | null;
  fullComparisonMeta: FullComparisonMeta | null;
}

export function DataCompareOptions({
  sharedColumns,
  keyColumns,
  toggleKey,
  left,
  right,
  ignoredColumns,
  toggleComparedColumn,
  absoluteTolerance,
  setAbsoluteTolerance,
  relativeTolerancePercent,
  setRelativeTolerancePercent,
  displayedComparison,
  fullComparisonMeta,
}: DataCompareOptionsContext) {
  return (
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
                  <span className="ml-auto text-[7px] uppercase text-amber-300">
                    PK
                  </span>
                )}
            </label>
          ))}
          {sharedColumns.length === 0 && (
            <p className="px-3 py-2 text-[9px] leading-4 text-rose-300">
              The sources have no columns with matching names.
            </p>
          )}
          <p className="px-3 pt-1 text-[8px] leading-4 wb-muted">
            Full-table compare requires the complete shared primary key.
            Loaded-page compare can use any shared column.
          </p>
        </div>
      </section>

      <section className="border-b border-[hsl(var(--wb-border-subtle))]">
        <div className="px-3 pb-1 pt-3 text-[8px] font-semibold uppercase tracking-[0.12em] wb-muted">
          Compare values
        </div>
        <div className="pb-2">
          {sharedColumns
            .filter((column) => !keyColumns.includes(column))
            .map((column) => (
              <label
                key={column}
                className="flex h-7 cursor-pointer items-center gap-2 px-3 text-[9px] hover:bg-[hsl(var(--wb-hover))]"
              >
                <input
                  type="checkbox"
                  aria-label={`Compare value column ${column}`}
                  checked={!ignoredColumns.has(column)}
                  onChange={() => toggleComparedColumn(column)}
                />
                <span className="truncate font-mono">{column}</span>
              </label>
            ))}
          {sharedColumns.every((column) => keyColumns.includes(column)) && (
            <p className="px-3 py-2 text-[8px] leading-4 wb-muted">
              The selected key is the only shared column.
            </p>
          )}
          <p className="px-3 pt-1 text-[8px] leading-4 wb-muted">
            Clear volatile or intentionally ignored fields. Key columns stay
            included.
          </p>
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
            onChange={(event) =>
              setRelativeTolerancePercent(event.target.value)
            }
            className="h-6 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[9px] outline-none"
          />
        </label>
        <p className="mt-2 text-[8px] leading-3.5 wb-muted">
          Equal when Δ ≤ absolute + relative × max magnitude. Non-numeric values
          remain exact.
        </p>
      </section>

      {displayedComparison && (
        <section className="px-3 py-3 text-[8px] leading-4 wb-muted">
          <div>
            {displayedComparison.comparedColumns.length} shared value columns
          </div>
          {fullComparisonMeta ? (
            <>
              <div>
                {fullComparisonMeta.sourceRows.toLocaleString()} full left rows
              </div>
              <div>
                {fullComparisonMeta.targetRows.toLocaleString()} full right rows
              </div>
              {fullComparisonMeta.degradationLevel === "full" ? (
                <div>
                  Exact full-key comparison ·{" "}
                  {fullComparisonMeta.batchSize.toLocaleString()} rows per host
                  batch
                </div>
              ) : fullComparisonMeta.degradationLevel === "sample" ? (
                <>
                  <div>
                    {fullComparisonMeta.sampledKeyCount.toLocaleString()}{" "}
                    deterministic extreme keys inspected
                  </div>
                  <div>
                    {(fullComparisonMeta.samplingRate * 100).toFixed(2)}% key
                    coverage · sampled counts only
                  </div>
                </>
              ) : (
                <div className="text-amber-200">
                  Comparison skipped above the safe sampling ceiling
                </div>
              )}
              {fullComparisonMeta.checksumsMatch !== undefined ? (
                <div>
                  Inspected-column checksums{" "}
                  {fullComparisonMeta.checksumsMatch ? "match" : "differ"}
                </div>
              ) : null}
              {fullComparisonMeta.detailsTruncated && (
                <div className="mt-1 text-amber-200">
                  Showing up to{" "}
                  {fullComparisonMeta.detailLimitPerStatus.toLocaleString()}{" "}
                  details per status; totals remain exact.
                </div>
              )}
            </>
          ) : (
            <>
              <div>{left.rows.length.toLocaleString()} loaded left rows</div>
              <div>{right.rows.length.toLocaleString()} loaded right rows</div>
            </>
          )}
          <p className="px-3 pb-2 pt-1 text-[8px] leading-3.5 wb-muted">
            Full-table compare uses the complete shared primary key. Loaded-page
            compare can use any shared column.
          </p>
          {displayedComparison.leftOnlyColumns.length > 0 && (
            <div className="mt-2 break-words">
              Left-only columns:{" "}
              {displayedComparison.leftOnlyColumns.join(", ")}
            </div>
          )}
          {displayedComparison.rightOnlyColumns.length > 0 && (
            <div className="mt-1 break-words">
              Right-only columns:{" "}
              {displayedComparison.rightOnlyColumns.join(", ")}
            </div>
          )}
          {displayedComparison.typeMismatchColumns.length > 0 && (
            <div className="mt-1 break-words">
              Type mismatches:{" "}
              {displayedComparison.typeMismatchColumns
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
  );
}
