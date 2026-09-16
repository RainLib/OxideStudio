import type { FullComparisonMeta } from "@/features/data-compare/model/dataCompareSessionTypes";
import { createCompareRequestScope } from "@/features/data-compare/runtime/compareRequestScope";
import type { DataCompareSource } from "@/lib/dataCompare";
import {
  compareDataSources,
  sharedDataCompareColumns,
  suggestedDataCompareKeys,
  type DataCompareResult,
} from "@/lib/dataCompare";
import {
  tableService,
  type TableDataCompareProgress,
  type TableDataCompareResult,
  type TableDataCompareSyncPreview,
  type TableDataCompareSyncReceipt,
} from "@/services/tauri";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface UseDataCompareSessionContext {
  scopeId?: string;
  left: DataCompareSource | undefined;
  right: DataCompareSource | undefined;
}

export function useDataCompareSession({
  scopeId,
  left,
  right,
}: UseDataCompareSessionContext) {
  const [keyColumns, setKeyColumns] = useState<string[]>([]);
  const [ignoredColumns, setIgnoredColumns] = useState<Set<string>>(
    () => new Set(),
  );
  const [absoluteTolerance, setAbsoluteTolerance] = useState("0");
  const [relativeTolerancePercent, setRelativeTolerancePercent] = useState("0");
  const [showEqual, setShowEqual] = useState(false);
  const [query, setQuery] = useState("");
  const [fullComparison, setFullComparison] =
    useState<DataCompareResult | null>(null);
  const [fullComparisonPayload, setFullComparisonPayload] =
    useState<TableDataCompareResult | null>(null);
  const [fullComparisonMeta, setFullComparisonMeta] =
    useState<FullComparisonMeta | null>(null);
  const [isComparingFull, setIsComparingFull] = useState(false);
  const [fullComparisonProgress, setFullComparisonProgress] =
    useState<TableDataCompareProgress | null>(null);
  const [fullComparisonError, setFullComparisonError] = useState<string | null>(
    null,
  );
  const [syncPreview, setSyncPreview] =
    useState<TableDataCompareSyncPreview | null>(null);
  const [syncPreviewError, setSyncPreviewError] = useState<string | null>(null);
  const [isPlanningSync, setIsPlanningSync] = useState(false);
  const [syncConfirmation, setSyncConfirmation] = useState("");
  const [isExecutingSync, setIsExecutingSync] = useState(false);
  const [syncReceipt, setSyncReceipt] =
    useState<TableDataCompareSyncReceipt | null>(null);
  const [selectedSyncRows, setSelectedSyncRows] = useState<Set<string>>(
    () => new Set(),
  );
  const activeCompareIdRef = useRef<string | null>(null);

  const requestScopeRef = useRef<ReturnType<
    typeof createCompareRequestScope
  > | null>(null);
  if (!requestScopeRef.current)
    requestScopeRef.current = createCompareRequestScope();
  const requestScope = requestScopeRef.current;
  const invalidateSyncPlan = useCallback(() => {
    requestScope.invalidatePreview();
    setIsPlanningSync(false);
    setSyncPreview(null);
    setSyncPreviewError(null);
    setSyncConfirmation("");
    setSyncReceipt(null);
  }, [requestScope]);
  const cancelActiveComparison = useCallback(() => {
    const compareId = activeCompareIdRef.current;
    activeCompareIdRef.current = null;
    if (compareId)
      void tableService
        .cancelTableDataCompare(compareId)
        .catch(() => undefined);
  }, []);
  const invalidateComparison = useCallback(() => {
    cancelActiveComparison();
    setFullComparison(null);
    setFullComparisonPayload(null);
    setFullComparisonMeta(null);
    setFullComparisonProgress(null);
    setIsComparingFull(false);
    setFullComparisonError(null);
    setSelectedSyncRows(new Set());
    invalidateSyncPlan();
  }, [cancelActiveComparison, invalidateSyncPlan]);

  useLayoutEffect(() => {
    requestScope.activate();
    return () => {
      requestScope.dispose();
      cancelActiveComparison();
    };
  }, [requestScope, cancelActiveComparison]);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void tableService
      .listenTableDataCompareProgress((progress) => {
        if (
          !requestScope.isActive() ||
          progress.compareId !== activeCompareIdRef.current
        )
          return;
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
    };
  }, [requestScope]);

  useLayoutEffect(() => {
    requestScope.reset();
    setIsExecutingSync(false);
    invalidateComparison();
    setKeyColumns(left && right ? suggestedDataCompareKeys(left, right) : []);
    setIgnoredColumns(new Set());
  }, [scopeId, left, right, requestScope, invalidateComparison]);

  const reviewedValueColumns = useMemo(
    () =>
      left && right
        ? sharedDataCompareColumns(left, right).filter(
            (column) =>
              !keyColumns.includes(column) && !ignoredColumns.has(column),
          )
        : [],
    [ignoredColumns, keyColumns, left, right],
  );
  const comparison = useMemo(() => {
    if (!left || !right) return { result: null, error: null };
    try {
      return {
        result: compareDataSources(left, right, {
          keyColumns,
          comparedColumns: reviewedValueColumns,
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
  }, [
    absoluteTolerance,
    keyColumns,
    left,
    relativeTolerancePercent,
    reviewedValueColumns,
    right,
  ]);

  return {
    requestScope,
    invalidateSyncPlan,
    invalidateComparison,
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
  };
}
