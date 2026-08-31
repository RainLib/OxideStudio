import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Equal,
  FileCode2,
  RefreshCw,
  Rows3,
  Search,
  Square,
} from "lucide-react";
import {
  compareDataSources,
  sharedDataCompareColumns,
  suggestedDataCompareKeys,
  type DataCompareFieldDifference,
  type DataCompareRow,
  type DataCompareRowStatus,
  type DataCompareResult,
  type DataCompareSource,
} from "@/lib/dataCompare";
import { cn } from "@/lib/utils";
import {
  tableService,
  type TableDataCompareProgress,
  type TableDataCompareResult,
  type TableDataCompareSyncReceipt,
  type TableDataCompareSyncPreview,
} from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";
import {
  canCreateDataCompareSource,
  useTabStore,
} from "@/store/useTabStore";

const DISPLAY_LIMIT = 2_000;

export function DataCompareView() {
  const { tabs, activeTabId, openDataCompareTab } = useTabStore();
  const connections = useConnectionStore((state) => state.connections);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const left = activeTab?.dataCompareLeft;
  const right = activeTab?.dataCompareRight;
  const [keyColumns, setKeyColumns] = useState<string[]>([]);
  const [absoluteTolerance, setAbsoluteTolerance] = useState("0");
  const [relativeTolerancePercent, setRelativeTolerancePercent] = useState("0");
  const [showEqual, setShowEqual] = useState(false);
  const [query, setQuery] = useState("");
  const [fullComparison, setFullComparison] = useState<DataCompareResult | null>(null);
  const [fullComparisonPayload, setFullComparisonPayload] =
    useState<TableDataCompareResult | null>(null);
  const [fullComparisonMeta, setFullComparisonMeta] = useState<{
    sourceRows: number;
    targetRows: number;
    batchSize: number;
    detailLimitPerStatus: number;
    detailsTruncated: boolean;
    degradationLevel: TableDataCompareResult["degradationLevel"];
    samplingRate: number;
    verificationMethod: TableDataCompareResult["verificationMethod"];
    countsExact: boolean;
    sampledKeyCount: number;
    checksumsMatch?: boolean;
  } | null>(null);
  const [isComparingFull, setIsComparingFull] = useState(false);
  const [fullComparisonProgress, setFullComparisonProgress] =
    useState<TableDataCompareProgress | null>(null);
  const [fullComparisonError, setFullComparisonError] = useState<string | null>(null);
  const [syncPreview, setSyncPreview] = useState<TableDataCompareSyncPreview | null>(null);
  const [syncPreviewError, setSyncPreviewError] = useState<string | null>(null);
  const [isPlanningSync, setIsPlanningSync] = useState(false);
  const [syncConfirmation, setSyncConfirmation] = useState("");
  const [isExecutingSync, setIsExecutingSync] = useState(false);
  const [syncReceipt, setSyncReceipt] = useState<TableDataCompareSyncReceipt | null>(null);
  const activeCompareIdRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void tableService
      .listenTableDataCompareProgress((progress) => {
        if (progress.compareId !== activeCompareIdRef.current) return;
        setFullComparisonProgress(progress);
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stopListening = unlisten;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stopListening?.();
      const compareId = activeCompareIdRef.current;
      activeCompareIdRef.current = null;
      if (compareId) void tableService.cancelTableDataCompare(compareId).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!left || !right) return;
    const compareId = activeCompareIdRef.current;
    activeCompareIdRef.current = null;
    if (compareId) void tableService.cancelTableDataCompare(compareId).catch(() => undefined);
    setKeyColumns(suggestedDataCompareKeys(left, right));
    setFullComparison(null);
    setFullComparisonPayload(null);
    setFullComparisonMeta(null);
    setFullComparisonProgress(null);
    setIsComparingFull(false);
    setFullComparisonError(null);
    setSyncPreview(null);
    setSyncPreviewError(null);
    setSyncConfirmation("");
    setSyncReceipt(null);
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
  const displayedComparison = fullComparison || comparison.result;
  const rows = displayedComparison
    ? flattenRows(displayedComparison.rows, left, right, showEqual, query)
    : [];
  const displayedRows = rows.slice(0, DISPLAY_LIMIT);

  const toggleKey = (column: string) => {
    setFullComparison(null);
    setFullComparisonPayload(null);
    setFullComparisonMeta(null);
    setFullComparisonError(null);
    setSyncPreview(null);
    setSyncPreviewError(null);
    setSyncConfirmation("");
    setSyncReceipt(null);
    setKeyColumns((current) =>
      current.includes(column)
        ? current.filter((candidate) => candidate !== column)
        : [...current, column],
    );
  };
  const leftConnection = connections.find((connection) => connection.id === left.connectionId);
  const rightConnection = connections.find((connection) => connection.id === right.connectionId);
  const selectedKeysMatchSuggested = keyColumns.length > 0
    && keyColumns.length === left.suggestedKeyColumns.length
    && keyColumns.length === right.suggestedKeyColumns.length
    && keyColumns.every((key) => left.suggestedKeyColumns.includes(key))
    && keyColumns.every((key) => right.suggestedKeyColumns.includes(key));
  const canCompareFull = Boolean(
    left.sourceKind === "table" &&
      right.sourceKind === "table" &&
      left.connectionId && right.connectionId &&
      left.objectName && right.objectName &&
      leftConnection?.driver && rightConnection?.driver &&
      selectedKeysMatchSuggested,
  );
  const runFullComparison = async () => {
    if (!canCompareFull || !leftConnection || !rightConnection) return;
    const compareId = tableService.createTableDataCompareId();
    activeCompareIdRef.current = compareId;
    setIsComparingFull(true);
    setFullComparisonProgress(null);
    setFullComparisonError(null);
    setSyncPreview(null);
    setSyncPreviewError(null);
    setSyncConfirmation("");
    setSyncReceipt(null);
    try {
      const result = await tableService.compareTableDataFull({
        compareId,
        source: {
          connectionId: left.connectionId!,
          driver: leftConnection.driver,
          database: left.databaseName,
          schema: left.schemaName || "",
          table: left.objectName!,
        },
        target: {
          connectionId: right.connectionId!,
          driver: rightConnection.driver,
          database: right.databaseName,
          schema: right.schemaName || "",
          table: right.objectName!,
        },
        columns: sharedColumns,
        keyColumns,
      });
      if (activeCompareIdRef.current !== compareId) return;
      setFullComparisonPayload(result);
      setFullComparison(fullComparisonFromServer(result, left, right, keyColumns, sharedColumns));
      setFullComparisonMeta({
        sourceRows: result.sourceRowCount,
        targetRows: result.targetRowCount,
        batchSize: result.batchSize,
        detailLimitPerStatus: result.detailLimitPerStatus,
        detailsTruncated: result.detailsTruncated,
        degradationLevel: result.degradationLevel,
        samplingRate: result.samplingRate,
        verificationMethod: result.verificationMethod,
        countsExact: result.countsExact,
        sampledKeyCount: result.sampledKeyCount,
        checksumsMatch: result.checksumsMatch,
      });
    } catch (error) {
      if (activeCompareIdRef.current === compareId) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes("cancel")) setFullComparisonError(message);
      }
    } finally {
      if (activeCompareIdRef.current === compareId) {
        activeCompareIdRef.current = null;
        setIsComparingFull(false);
      }
    }
  };
  const cancelFullComparison = async () => {
    const compareId = activeCompareIdRef.current;
    if (!compareId) return;
    setFullComparisonProgress((current) =>
      current
        ? { ...current, message: "Cancelling table comparison…" }
        : current,
    );
    try {
      await tableService.cancelTableDataCompare(compareId);
    } catch (error) {
      if (activeCompareIdRef.current === compareId) {
        setFullComparisonError(error instanceof Error ? error.message : String(error));
      }
    }
  };
  const canPreviewSync = Boolean(
    fullComparisonPayload &&
      fullComparisonPayload.degradationLevel === "full" &&
      fullComparisonPayload.countsExact &&
      !fullComparisonPayload.detailsTruncated &&
      fullComparisonPayload.addedCount +
        fullComparisonPayload.removedCount +
        fullComparisonPayload.modifiedCount >
        0 &&
      rightConnection,
  );
  const previewSync = async () => {
    if (!canPreviewSync || !fullComparisonPayload || !rightConnection) return;
    setIsPlanningSync(true);
    setSyncPreviewError(null);
    try {
      const preview = await tableService.previewTableDataCompareSync({
        target: {
          connectionId: right.connectionId!,
          driver: rightConnection.driver,
          database: right.databaseName,
          schema: right.schemaName || "",
          table: right.objectName!,
        },
        columns: sharedColumns,
        keyColumns,
        comparison: fullComparisonPayload,
      });
      setSyncPreview(preview);
      setSyncConfirmation("");
      setSyncReceipt(null);
    } catch (error) {
      setSyncPreview(null);
      setSyncPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsPlanningSync(false);
    }
  };
  const copySyncSql = async () => {
    if (!syncPreview?.sql) return;
    try {
      await navigator.clipboard.writeText(syncPreview.sql);
      setSyncPreviewError(null);
    } catch (error) {
      setSyncPreviewError(error instanceof Error ? error.message : String(error));
    }
  };
  const executeSync = async () => {
    if (
      !syncPreview?.canExecute ||
      syncConfirmation !== syncPreview.confirmationText ||
      isExecutingSync
    ) return;
    setIsExecutingSync(true);
    setSyncPreviewError(null);
    try {
      const receipt = await tableService.executeTableDataCompareSync({
        planToken: syncPreview.planToken,
        planDigest: syncPreview.planDigest,
        confirmationText: syncConfirmation,
      });
      setSyncReceipt(receipt);
      setSyncPreview(null);
      setSyncConfirmation("");
      setFullComparison(null);
      setFullComparisonPayload(null);
      setFullComparisonMeta(null);
      setFullComparisonProgress(null);
    } catch (error) {
      setSyncPreview(null);
      setSyncConfirmation("");
      setSyncPreviewError(
        `${error instanceof Error ? error.message : String(error)} Compare and preview again before retrying.`,
      );
    } finally {
      setIsExecutingSync(false);
    }
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
        <button
          type="button"
          className="wb-text-button h-7 gap-1.5 px-2.5 text-[10px]"
          disabled={!canCompareFull && !isComparingFull}
          title={
            isComparingFull
              ? "Cancel the active table comparison"
              : canCompareFull
              ? "Compare all rows up to 100,000 per table, then use a bounded extreme-key sample up to 10,000,000 rows"
              : "Table compare requires two table tabs, connections, and the complete shared primary key"
          }
          onClick={() => void (isComparingFull ? cancelFullComparison() : runFullComparison())}
        >
          {isComparingFull ? <Square size={10} /> : <Rows3 size={11} />}
          {isComparingFull ? "Cancel comparison" : "Compare table data"}
        </button>
        <button
          type="button"
          className="wb-text-button h-7 gap-1.5 px-2.5 text-[10px]"
          disabled={!canPreviewSync || isPlanningSync || isComparingFull}
          title={
            canPreviewSync
              ? "Freeze a short-lived parameterized synchronization plan and generate review SQL"
              : "Sync preview requires an exact, untruncated full-table comparison with differences"
          }
          onClick={() => void previewSync()}
        >
          <FileCode2 size={11} /> {isPlanningSync ? "Planning sync…" : "Preview sync SQL"}
        </button>
      </header>

      {isComparingFull && fullComparisonProgress?.message && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.46)] px-4 text-[10px] wb-muted">
          <RefreshCw className="animate-spin text-cyan-300" size={11} />
          <span>{fullComparisonProgress.message}</span>
          {fullComparisonProgress.endpoint && (
            <span className="ml-auto tabular-nums">
              {fullComparisonProgress.endpoint} · {fullComparisonProgress.processedRows.toLocaleString()} rows
            </span>
          )}
        </div>
      )}

      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.62)] px-3">
        {displayedComparison && (
          <>
            <SummaryBadge label="Changed" value={displayedComparison.counts.changed} tone="warning" />
            <SummaryBadge label="Left only" value={displayedComparison.counts.leftOnly} tone="danger" />
            <SummaryBadge label="Right only" value={displayedComparison.counts.rightOnly} tone="success" />
            <SummaryBadge label="Duplicate" value={displayedComparison.counts.duplicate} tone="warning" />
            <SummaryBadge label="Equal" value={displayedComparison.counts.equal} />
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
              <p className="px-3 pt-1 text-[8px] leading-4 wb-muted">
                Full-table compare requires the complete shared primary key. Loaded-page compare can use any shared column.
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
                onChange={(event) => setRelativeTolerancePercent(event.target.value)}
                className="h-6 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[9px] outline-none"
              />
            </label>
            <p className="mt-2 text-[8px] leading-3.5 wb-muted">
              Equal when Δ ≤ absolute + relative × max magnitude. Non-numeric values remain exact.
            </p>
          </section>

          {displayedComparison && (
            <section className="px-3 py-3 text-[8px] leading-4 wb-muted">
              <div>{displayedComparison.comparedColumns.length} shared value columns</div>
              {fullComparisonMeta ? (
                <>
                  <div>{fullComparisonMeta.sourceRows.toLocaleString()} full left rows</div>
                  <div>{fullComparisonMeta.targetRows.toLocaleString()} full right rows</div>
                  {fullComparisonMeta.degradationLevel === "full" ? (
                    <div>Exact full-key comparison · {fullComparisonMeta.batchSize.toLocaleString()} rows per host batch</div>
                  ) : fullComparisonMeta.degradationLevel === "sample" ? (
                    <>
                      <div>
                        {fullComparisonMeta.sampledKeyCount.toLocaleString()} deterministic extreme keys inspected
                      </div>
                      <div>
                        {(fullComparisonMeta.samplingRate * 100).toFixed(2)}% key coverage · sampled counts only
                      </div>
                    </>
                  ) : (
                    <div className="text-amber-200">Comparison skipped above the safe sampling ceiling</div>
                  )}
                  {fullComparisonMeta.checksumsMatch !== undefined ? (
                    <div>
                      Inspected-column checksums {fullComparisonMeta.checksumsMatch ? "match" : "differ"}
                    </div>
                  ) : null}
                  {fullComparisonMeta.detailsTruncated && (
                    <div className="mt-1 text-amber-200">
                      Showing up to {fullComparisonMeta.detailLimitPerStatus.toLocaleString()} details per status; totals remain exact.
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
                Full-table compare uses the complete shared primary key. Loaded-page compare can use any shared column.
              </p>
              {displayedComparison.leftOnlyColumns.length > 0 && (
                <div className="mt-2 break-words">
                  Left-only columns: {displayedComparison.leftOnlyColumns.join(", ")}
                </div>
              )}
              {displayedComparison.rightOnlyColumns.length > 0 && (
                <div className="mt-1 break-words">
                  Right-only columns: {displayedComparison.rightOnlyColumns.join(", ")}
                </div>
              )}
              {displayedComparison.typeMismatchColumns.length > 0 && (
                <div className="mt-1 break-words">
                  Type mismatches: {displayedComparison.typeMismatchColumns
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
          {(fullComparison ? fullComparisonError : comparison.error || fullComparisonError) ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-[10px] text-rose-300">
              {fullComparisonError || comparison.error}
            </div>
          ) : displayedComparison ? (
            <>
              {(syncPreview || syncPreviewError || syncReceipt) && (
                <section className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel)/0.76)] p-3">
                  <div className="mb-2 flex items-center gap-2 text-[10px]">
                    <FileCode2 size={12} className="text-cyan-300" />
                    <span className="font-medium">Synchronization plan</span>
                    {syncPreview && (
                      <span className="wb-muted">
                        {syncPreview.insertCount.toLocaleString()} inserts · {syncPreview.updateCount.toLocaleString()} updates · {syncPreview.deleteCount.toLocaleString()} deletes
                      </span>
                    )}
                    {syncPreview && (
                      <button
                        type="button"
                        className="wb-text-button ml-auto h-6 gap-1 px-2 text-[9px]"
                        onClick={() => void copySyncSql()}
                      >
                        <Copy size={10} /> Copy SQL
                      </button>
                    )}
                  </div>
                  {syncPreviewError && (
                    <div className="mb-2 text-[9px] leading-4 text-rose-300">{syncPreviewError}</div>
                  )}
                  {syncReceipt && (
                    <div className="flex items-center gap-2 rounded-[5px] border border-emerald-400/25 bg-emerald-400/[0.07] px-3 py-2 text-[9px] text-emerald-200">
                      <Check size={11} />
                      Applied {syncReceipt.rowsAffected.toLocaleString()} frozen operation(s) atomically. Run the comparison again to refresh both sides.
                    </div>
                  )}
                  {syncPreview && (
                    <>
                      <textarea
                        readOnly
                        aria-label="Data compare synchronization SQL"
                        value={syncPreview.sql}
                        className="h-44 w-full resize-y rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 font-mono text-[9px] leading-4 outline-none"
                      />
                      <div className="mt-2 space-y-1 text-[8px] leading-4 text-amber-200">
                        {syncPreview.warnings.map((warning) => (
                          <div key={warning} className="flex items-start gap-1.5">
                            <AlertTriangle size={9} className="mt-0.5 shrink-0" /> {warning}
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2.5">
                        <div className="text-[8px] leading-4 wb-muted">
                          Type <span className="select-all font-mono text-[hsl(var(--wb-text))]">{syncPreview.confirmationText}</span> to consume this single-use plan. It expires at {new Date(syncPreview.expiresAt).toLocaleTimeString()}.
                        </div>
                        <div className="mt-2 flex gap-2">
                          <input
                            aria-label="Synchronization confirmation phrase"
                            value={syncConfirmation}
                            onChange={(event) => setSyncConfirmation(event.target.value)}
                            className="h-7 min-w-0 flex-1 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2 font-mono text-[9px] outline-none focus:border-[hsl(var(--wb-accent)/0.55)]"
                            placeholder={syncPreview.confirmationText}
                          />
                          <button
                            type="button"
                            className="wb-text-button h-7 px-3 text-[9px]"
                            disabled={
                              !syncPreview.canExecute ||
                              syncConfirmation !== syncPreview.confirmationText ||
                              isExecutingSync
                            }
                            onClick={() => void executeSync()}
                          >
                            {isExecutingSync ? "Applying…" : "Apply atomically"}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </section>
              )}
              {displayedComparison.warnings.length > 0 && (
                <div className="border-b border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[9px] text-amber-200">
                  {displayedComparison.warnings.map((warning) => (
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

function fullComparisonFromServer(
  result: TableDataCompareResult,
  left: DataCompareSource,
  right: DataCompareSource,
  keyColumns: string[],
  sharedColumns: string[],
): DataCompareResult {
  const leftIndexes = new Map(left.columns.map((column, index) => [column.name, index]));
  const rightIndexes = new Map(right.columns.map((column, index) => [column.name, index]));
  const toRow = (values: Record<string, unknown>, source: DataCompareSource) =>
    source.columns.map((column) => values[column.name]);
  const keyFor = (values: Record<string, unknown>) =>
    keyColumns.map((column) => ({ column, value: values[column] }));
  const rows: DataCompareRow[] = [
    ...result.added.map((row) => ({
      id: `full:left:${row.key}`,
      status: "leftOnly" as const,
      key: keyFor(row.values),
      leftRow: toRow(row.values, left),
      fields: [],
      leftMatchCount: 1,
      rightMatchCount: 0,
    })),
    ...result.removed.map((row) => ({
      id: `full:right:${row.key}`,
      status: "rightOnly" as const,
      key: keyFor(row.values),
      rightRow: toRow(row.values, right),
      fields: [],
      leftMatchCount: 0,
      rightMatchCount: 1,
    })),
    ...result.modified.map((row) => ({
      id: `full:changed:${row.key}`,
      status: "changed" as const,
      key: keyFor(row.sourceValues),
      leftRow: toRow(row.sourceValues, left),
      rightRow: toRow(row.targetValues, right),
      fields: row.changedColumns.map((column) => ({
        column,
        left: row.sourceValues[column],
        right: row.targetValues[column],
        equal: false,
        toleranceMatched: false,
      })),
      leftMatchCount: 1,
      rightMatchCount: 1,
    })),
  ];
  const leftOnlyColumns = left.columns
    .map((column) => column.name)
    .filter((column) => !rightIndexes.has(column));
  const rightOnlyColumns = right.columns
    .map((column) => column.name)
    .filter((column) => !leftIndexes.has(column));
  return {
    rows,
    keyColumns,
    comparedColumns: sharedColumns.filter((column) => !keyColumns.includes(column)),
    leftOnlyColumns,
    rightOnlyColumns,
    typeMismatchColumns: [],
    counts: {
      equal: result.equalCount,
      changed: result.modifiedCount,
      leftOnly: result.addedCount,
      rightOnly: result.removedCount,
      duplicate: 0,
    },
    comparedKeyCount: result.comparedKeyCount,
    warnings: [
      ...(result.degradationLevel === "full"
        ? ["Full table comparison ran in the host process. Counts are exact; equal rows are counted but not materialized in the result list."]
        : result.degradationLevel === "sample"
          ? [
              `The tables exceeded the full-compare ceiling. Oxide inspected ${result.sampledKeyCount.toLocaleString()} deterministic first/last keys (${(result.samplingRate * 100).toFixed(2)}% coverage); difference counts and checksums describe only that sampled key universe.`,
              "Extreme-key sampling is deterministic but not random, so Oxide does not claim a statistical confidence score or whole-table equality.",
            ]
          : [
              "The tables exceed the safe sampling ceiling. Only exact row counts were read; no row-level comparison or equality claim was produced.",
            ]),
      ...(result.detailsTruncated
        ? [`Difference details are limited to ${result.detailLimitPerStatus.toLocaleString()} rows per status. ${result.countsExact ? "Counts above remain exact." : "Sample-local counts above remain complete for the inspected keys."}`]
        : []),
    ],
  };
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
