import { useDataCompareSession } from "@/features/data-compare/hooks/useDataCompareSession";
import {
  DISPLAY_LIMIT,
  flattenRows,
} from "@/features/data-compare/model/compareRows";
import { createCompareFilterActions } from "@/features/data-compare/model/createCompareFilterActions";
import { createCompareSyncActions } from "@/features/data-compare/model/createCompareSyncActions";
import { createFullComparisonActions } from "@/features/data-compare/model/createFullComparisonActions";
import { selectSyncRows } from "@/features/data-compare/model/syncSelection";
import { CompareLine } from "@/features/data-compare/ui/CompareLine";
import { DataCompareHeader } from "@/features/data-compare/ui/DataCompareHeader";
import { DataCompareOptions } from "@/features/data-compare/ui/DataCompareOptions";
import { DataCompareSyncPlan } from "@/features/data-compare/ui/DataCompareSyncPlan";
import { DataCompareToolbar } from "@/features/data-compare/ui/DataCompareToolbar";
import { sharedDataCompareColumns } from "@/lib/dataCompare";
import { useConnectionStore } from "@/store/useConnectionStore";
import { canCreateDataCompareSource, useTabStore } from "@/store/useTabStore";
import { AlertTriangle, RefreshCw } from "lucide-react";

export function DataCompareView() {
  const { tabs, activeTabId, openDataCompareTab } = useTabStore();
  const connections = useConnectionStore((state) => state.connections);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const left = activeTab?.dataCompareLeft;
  const right = activeTab?.dataCompareRight;
  const {
    requestScope,
    invalidateComparison,
    invalidateSyncPlan,
    keyColumns,
    setKeyColumns,
    ignoredColumns,
    setIgnoredColumns,
    absoluteTolerance,
    setAbsoluteTolerance,
    relativeTolerancePercent,
    setRelativeTolerancePercent,
    showEqual,
    setShowEqual,
    query,
    setQuery,
    fullComparison,
    setFullComparison,
    fullComparisonPayload,
    setFullComparisonPayload,
    fullComparisonMeta,
    setFullComparisonMeta,
    isComparingFull,
    setIsComparingFull,
    fullComparisonProgress,
    setFullComparisonProgress,
    fullComparisonError,
    setFullComparisonError,
    syncPreview,
    setSyncPreview,
    syncPreviewError,
    setSyncPreviewError,
    isPlanningSync,
    setIsPlanningSync,
    syncConfirmation,
    setSyncConfirmation,
    isExecutingSync,
    setIsExecutingSync,
    syncReceipt,
    setSyncReceipt,
    selectedSyncRows,
    setSelectedSyncRows,
    activeCompareIdRef,
    comparison,
  } = useDataCompareSession({
    scopeId: activeTab?.id,
    left,
    right,
  });

  if (!activeTab || activeTab.type !== "data_compare" || !left || !right) {
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
  const effectiveColumns = sharedColumns.filter(
    (column) => keyColumns.includes(column) || !ignoredColumns.has(column),
  );
  const displayedComparison = fullComparison || comparison.result;
  const rows = displayedComparison
    ? flattenRows(displayedComparison.rows, left, right, showEqual, query)
    : [];
  const displayedRows = rows.slice(0, DISPLAY_LIMIT);

  const { toggleKey, toggleComparedColumn } = createCompareFilterActions({
    invalidateComparison,
    setKeyColumns,
    setIgnoredColumns,
  });

  const leftConnection = connections.find(
    (connection) => connection.id === left.connectionId,
  );
  const rightConnection = connections.find(
    (connection) => connection.id === right.connectionId,
  );
  const selectedKeysMatchSuggested =
    keyColumns.length > 0 &&
    keyColumns.length === left.suggestedKeyColumns.length &&
    keyColumns.length === right.suggestedKeyColumns.length &&
    keyColumns.every((key) => left.suggestedKeyColumns.includes(key)) &&
    keyColumns.every((key) => right.suggestedKeyColumns.includes(key));
  const canCompareFull = Boolean(
    left.sourceKind === "table" &&
      right.sourceKind === "table" &&
      left.connectionId &&
      right.connectionId &&
      left.objectName &&
      right.objectName &&
      leftConnection?.driver &&
      rightConnection?.driver &&
      selectedKeysMatchSuggested,
  );
  const { runFullComparison, cancelFullComparison } =
    createFullComparisonActions({
      requestScope,
      invalidateComparison,
      canCompareFull,
      leftConnection,
      rightConnection,
      activeCompareIdRef,
      setIsComparingFull,
      setFullComparisonProgress,
      setFullComparisonError,
      left,
      right,
      effectiveColumns,
      keyColumns,
      setFullComparisonPayload,
      setSelectedSyncRows,
      setFullComparison,
      setFullComparisonMeta,
    });

  const canSelectSyncRows = Boolean(
    fullComparisonPayload &&
      fullComparisonPayload.degradationLevel === "full" &&
      fullComparisonPayload.countsExact &&
      !fullComparisonPayload.detailsTruncated,
  );
  const canPreviewSync = Boolean(
    canSelectSyncRows && selectedSyncRows.size > 0 && rightConnection,
  );
  const selectedComparisonPayload = fullComparisonPayload
    ? selectSyncRows(fullComparisonPayload, selectedSyncRows)
    : null;
  const {
    toggleSyncRow,
    selectAllSyncRows,
    clearSyncRows,
    previewSync,
    copySyncSql,
    executeSync,
  } = createCompareSyncActions({
    requestScope,
    activeCompareIdRef,
    invalidateComparison,
    invalidateSyncPlan,
    setSyncPreview,
    setSyncPreviewError,
    setSyncConfirmation,
    setSyncReceipt,
    setSelectedSyncRows,
    fullComparisonPayload,
    canPreviewSync,
    selectedComparisonPayload,
    rightConnection,
    setIsPlanningSync,
    right,
    effectiveColumns,
    keyColumns,
    syncPreview,
    syncConfirmation,
    isExecutingSync,
    setIsExecutingSync,
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--wb-editor))] text-[hsl(var(--wb-text))]">
      <DataCompareHeader
        left={left}
        right={right}
        sourceTabsAvailable={sourceTabsAvailable}
        openDataCompareTab={openDataCompareTab}
        canCompareFull={canCompareFull}
        isComparingFull={isComparingFull}
        cancelFullComparison={cancelFullComparison}
        runFullComparison={runFullComparison}
        canPreviewSync={canPreviewSync}
        isPlanningSync={isPlanningSync}
        isExecutingSync={isExecutingSync}
        previewSync={previewSync}
      />

      {isComparingFull && fullComparisonProgress?.message && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.46)] px-4 text-[10px] wb-muted">
          <RefreshCw className="animate-spin text-cyan-300" size={11} />
          <span>{fullComparisonProgress.message}</span>
          {fullComparisonProgress.endpoint && (
            <span className="ml-auto tabular-nums">
              {fullComparisonProgress.endpoint} ·{" "}
              {fullComparisonProgress.processedRows.toLocaleString()} rows
            </span>
          )}
        </div>
      )}

      <DataCompareToolbar
        displayedComparison={displayedComparison}
        canSelectSyncRows={canSelectSyncRows}
        selectedSyncRows={selectedSyncRows}
        selectAllSyncRows={selectAllSyncRows}
        clearSyncRows={clearSyncRows}
        showEqual={showEqual}
        setShowEqual={setShowEqual}
        query={query}
        setQuery={setQuery}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
        <DataCompareOptions
          sharedColumns={sharedColumns}
          keyColumns={keyColumns}
          toggleKey={toggleKey}
          left={left}
          right={right}
          ignoredColumns={ignoredColumns}
          toggleComparedColumn={toggleComparedColumn}
          absoluteTolerance={absoluteTolerance}
          setAbsoluteTolerance={setAbsoluteTolerance}
          relativeTolerancePercent={relativeTolerancePercent}
          setRelativeTolerancePercent={setRelativeTolerancePercent}
          displayedComparison={displayedComparison}
          fullComparisonMeta={fullComparisonMeta}
        />

        <main className="min-h-0 overflow-auto">
          {(
            fullComparison
              ? fullComparisonError
              : comparison.error || fullComparisonError
          ) ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-[10px] text-rose-300">
              {fullComparisonError || comparison.error}
            </div>
          ) : displayedComparison ? (
            <>
              {(syncPreview || syncPreviewError || syncReceipt) && (
                <DataCompareSyncPlan
                  syncPreview={syncPreview}
                  copySyncSql={copySyncSql}
                  syncPreviewError={syncPreviewError}
                  syncReceipt={syncReceipt}
                  syncConfirmation={syncConfirmation}
                  setSyncConfirmation={setSyncConfirmation}
                  isExecutingSync={isExecutingSync}
                  executeSync={executeSync}
                />
              )}
              {displayedComparison.warnings.length > 0 && (
                <div className="border-b border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[9px] text-amber-200">
                  {displayedComparison.warnings.map((warning) => (
                    <div
                      key={warning}
                      className="flex items-start gap-1.5 leading-4"
                    >
                      <AlertTriangle size={10} className="mt-0.5 shrink-0" />{" "}
                      {warning}
                    </div>
                  ))}
                </div>
              )}
              <table className="w-full table-fixed border-collapse text-[9px]">
                <thead className="sticky top-0 z-10 bg-[hsl(var(--wb-toolbar))] text-left wb-muted">
                  <tr>
                    {canSelectSyncRows && (
                      <th className="w-14 border-b border-r border-[hsl(var(--wb-border-subtle))] px-2 py-2 text-center font-medium">
                        Sync
                      </th>
                    )}
                    <th className="w-24 border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 font-medium">
                      Status
                    </th>
                    <th className="w-52 border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 font-medium">
                      Key
                    </th>
                    <th className="w-36 border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 font-medium">
                      Column
                    </th>
                    <th className="border-b border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 font-medium">
                      {left.label}
                    </th>
                    <th className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 font-medium">
                      {right.label}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.map((row) => (
                    <CompareLine
                      key={row.id}
                      row={row}
                      showSyncSelection={canSelectSyncRows}
                      selected={selectedSyncRows.has(row.logicalRowId)}
                      onToggleSync={toggleSyncRow}
                    />
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
                  Showing the first {DISPLAY_LIMIT.toLocaleString()} of{" "}
                  {rows.length.toLocaleString()} comparison lines.
                </div>
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
