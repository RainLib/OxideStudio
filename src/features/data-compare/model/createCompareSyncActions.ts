import type { ConnectionConfig } from "@/features/connections/model/types";
import { allSyncRowIds } from "@/features/data-compare/model/syncSelection";
import type { CompareRequestScope } from "@/features/data-compare/runtime/compareRequestScope";
import type { DataCompareSource } from "@/lib/dataCompare";
import { tableService } from "@/services/tauri";
import type {
  TableDataCompareResult,
  TableDataCompareSyncPreview,
  TableDataCompareSyncReceipt,
} from "@/services/tauri/types/tableCompare";

interface CreateCompareSyncActionsContext {
  requestScope: CompareRequestScope;
  invalidateSyncPlan: () => void;
  invalidateComparison: () => void;
  activeCompareIdRef: React.RefObject<string | null>;
  setSyncPreview: React.Dispatch<
    React.SetStateAction<TableDataCompareSyncPreview | null>
  >;
  setSyncPreviewError: React.Dispatch<React.SetStateAction<string | null>>;
  setSyncConfirmation: React.Dispatch<React.SetStateAction<string>>;
  setSyncReceipt: React.Dispatch<
    React.SetStateAction<TableDataCompareSyncReceipt | null>
  >;
  setSelectedSyncRows: React.Dispatch<React.SetStateAction<Set<string>>>;
  fullComparisonPayload: TableDataCompareResult | null;
  canPreviewSync: boolean;
  selectedComparisonPayload: TableDataCompareResult | null;
  rightConnection: Pick<ConnectionConfig, "driver"> | undefined;
  setIsPlanningSync: React.Dispatch<React.SetStateAction<boolean>>;
  right: DataCompareSource;
  effectiveColumns: string[];
  keyColumns: string[];
  syncPreview: TableDataCompareSyncPreview | null;
  syncConfirmation: string;
  isExecutingSync: boolean;
  setIsExecutingSync: React.Dispatch<React.SetStateAction<boolean>>;
}

export function createCompareSyncActions({
  requestScope,
  invalidateSyncPlan,
  invalidateComparison,
  activeCompareIdRef,
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
}: CreateCompareSyncActionsContext) {
  const revision = requestScope.revision();
  const toggleSyncRow = (rowId: string) => {
    invalidateSyncPlan();
    setSelectedSyncRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };
  const selectAllSyncRows = () => {
    if (!fullComparisonPayload) return;
    invalidateSyncPlan();
    setSelectedSyncRows(allSyncRowIds(fullComparisonPayload));
  };
  const clearSyncRows = () => {
    invalidateSyncPlan();
    setSelectedSyncRows(new Set());
  };
  const previewSync = async () => {
    if (
      !canPreviewSync ||
      !selectedComparisonPayload ||
      !rightConnection ||
      !requestScope.isCurrentRevision(revision) ||
      activeCompareIdRef.current !== null ||
      requestScope.isPending("execute")
    )
      return;
    invalidateSyncPlan();
    const operation = requestScope.begin("preview");
    if (!operation) return;
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
        columns: effectiveColumns,
        keyColumns,
        comparison: selectedComparisonPayload,
      });
      if (!requestScope.isCurrent(operation)) return;
      setSyncPreview(preview);
      setSyncConfirmation("");
      setSyncReceipt(null);
    } catch (error) {
      if (!requestScope.isCurrent(operation)) return;
      setSyncPreview(null);
      setSyncPreviewError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (requestScope.isCurrent(operation)) {
        setIsPlanningSync(false);
        requestScope.finish(operation);
      }
    }
  };
  const copySyncSql = async () => {
    if (!syncPreview?.sql || !requestScope.isCurrentRevision(revision)) return;
    const operation = requestScope.begin("copy");
    if (!operation) return;
    try {
      await navigator.clipboard.writeText(syncPreview.sql);
      if (!requestScope.isCurrent(operation)) return;
      setSyncPreviewError(null);
    } catch (error) {
      if (!requestScope.isCurrent(operation)) return;
      setSyncPreviewError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      requestScope.finish(operation);
    }
  };
  const executeSync = async () => {
    if (
      !requestScope.isCurrentRevision(revision) ||
      activeCompareIdRef.current !== null ||
      !syncPreview?.canExecute ||
      syncConfirmation !== syncPreview.confirmationText ||
      isExecutingSync
    )
      return;
    const operation = requestScope.begin("execute");
    if (!operation) return;
    requestScope.invalidatePreview();
    setIsPlanningSync(false);
    setIsExecutingSync(true);
    setSyncPreviewError(null);
    try {
      const receipt = await tableService.executeTableDataCompareSync({
        planToken: syncPreview.planToken,
        planDigest: syncPreview.planDigest,
        confirmationText: syncConfirmation,
      });
      if (!requestScope.isCurrent(operation)) return;
      invalidateComparison();
      setSyncReceipt(receipt);
    } catch (error) {
      if (!requestScope.isCurrent(operation)) return;
      invalidateComparison();
      setSyncPreviewError(
        `${error instanceof Error ? error.message : String(error)} Compare and preview again before retrying.`,
      );
    } finally {
      if (requestScope.isCurrent(operation)) {
        setIsExecutingSync(false);
        requestScope.finish(operation);
      }
    }
  };

  return {
    toggleSyncRow,
    selectAllSyncRows,
    clearSyncRows,
    previewSync,
    copySyncSql,
    executeSync,
  };
}
