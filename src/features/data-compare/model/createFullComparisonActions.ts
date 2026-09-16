import type { ConnectionConfig } from "@/features/connections/model/types";
import type { FullComparisonMeta } from "@/features/data-compare/model/dataCompareSessionTypes";
import { fullComparisonFromServer } from "@/features/data-compare/model/fullComparisonFromServer";
import { allSyncRowIds } from "@/features/data-compare/model/syncSelection";
import type { CompareRequestScope } from "@/features/data-compare/runtime/compareRequestScope";
import type { DataCompareResult, DataCompareSource } from "@/lib/dataCompare";
import { tableService } from "@/services/tauri";
import type {
  TableDataCompareProgress,
  TableDataCompareResult,
} from "@/services/tauri/types/tableCompare";

interface CreateFullComparisonActionsContext {
  requestScope: CompareRequestScope;
  invalidateComparison: () => void;
  canCompareFull: boolean;
  leftConnection: Pick<ConnectionConfig, "driver"> | undefined;
  rightConnection: Pick<ConnectionConfig, "driver"> | undefined;
  activeCompareIdRef: React.RefObject<string | null>;
  setIsComparingFull: React.Dispatch<React.SetStateAction<boolean>>;
  setFullComparisonProgress: React.Dispatch<
    React.SetStateAction<TableDataCompareProgress | null>
  >;
  setFullComparisonError: React.Dispatch<React.SetStateAction<string | null>>;
  left: DataCompareSource;
  right: DataCompareSource;
  effectiveColumns: string[];
  keyColumns: string[];
  setFullComparisonPayload: React.Dispatch<
    React.SetStateAction<TableDataCompareResult | null>
  >;
  setSelectedSyncRows: React.Dispatch<React.SetStateAction<Set<string>>>;
  setFullComparison: React.Dispatch<
    React.SetStateAction<DataCompareResult | null>
  >;
  setFullComparisonMeta: React.Dispatch<
    React.SetStateAction<FullComparisonMeta | null>
  >;
}

export function createFullComparisonActions({
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
}: CreateFullComparisonActionsContext) {
  const revision = requestScope.revision();
  const runFullComparison = async () => {
    if (
      !canCompareFull ||
      !leftConnection ||
      !rightConnection ||
      !requestScope.isCurrentRevision(revision) ||
      requestScope.isPending("execute")
    )
      return;
    invalidateComparison();
    const compareId = tableService.createTableDataCompareId();
    activeCompareIdRef.current = compareId;
    setIsComparingFull(true);
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
        columns: effectiveColumns,
        keyColumns,
      });
      if (activeCompareIdRef.current !== compareId) return;
      setFullComparisonPayload(result);
      setSelectedSyncRows(allSyncRowIds(result));
      setFullComparison(
        fullComparisonFromServer(
          result,
          left,
          right,
          keyColumns,
          effectiveColumns,
        ),
      );
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
        if (!message.toLowerCase().includes("cancel"))
          setFullComparisonError(message);
      }
    } finally {
      if (activeCompareIdRef.current === compareId) {
        activeCompareIdRef.current = null;
        setIsComparingFull(false);
      }
    }
  };
  const cancelFullComparison = async () => {
    if (!requestScope.isCurrentRevision(revision)) return;
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
        setFullComparisonError(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  };

  return { runFullComparison, cancelFullComparison };
}
