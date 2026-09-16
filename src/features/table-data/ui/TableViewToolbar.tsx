import {
  type DataGridHandle,
  type DataGridSelectionSummary,
} from "@/components/workspace/DataGrid";
import { TableDataToolbar } from "@/components/workspace/TableDataToolbar";
import type { TabData } from "@/features/workspace-tabs/model/types";
import { normalizeDatabaseDriverName } from "@/lib/databaseDialect";
import type { DatabaseCapabilities } from "@/services/tauri/types";
import type {
  DatabaseDriver,
  DatabaseTableExportFormat,
} from "@/services/tauri/types/database";
import type { QueryResult } from "@/services/tauri/types/query";
import type {
  SqlInsertConflictPolicy,
  TableExportEncoding,
} from "@/services/tauri/types/tableExport";

interface TableViewToolbarProps {
  activeTab: TabData;
  isTableReadOnly: boolean;
  isTransposed: boolean;
  isCrossDatabasePreview: boolean;
  isNativeObjectPreview: boolean;
  tableExportFormats: DatabaseTableExportFormat[];
  exportMaxRows: number | undefined;
  setExportMaxRows: React.Dispatch<React.SetStateAction<number | undefined>>;
  supportsSqlConflictSkip: boolean;
  supportsSqlConflictUpdate: boolean;
  activeTableExport: { exportId: string; taskId: string } | null;
  activeCapabilities: DatabaseCapabilities;
  isEditingEnabled: boolean;
  hasEdits: boolean;
  gridSelectionSummary: DataGridSelectionSummary;
  handleRefresh: () => void;
  addNewRow: (tabId: string) => void;
  dataGridRef: React.RefObject<DataGridHandle | null>;
  isMongoDocumentPreview: boolean;
  openMongoDocumentAction: (
    mode: "clone" | "edit" | "delete",
    sourceRowIndex?: number | undefined,
  ) => void;
  result: QueryResult | undefined;
  commitEdits: (tabId: string) => Promise<void>;
  cancelEdits: (tabId: string) => void;
  resetColumnLayout: (tabId: string) => void;
  setIsEditingEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setTransposedTabIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  openCsvImportPicker: () => Promise<void>;
  openJsonImportPicker: () => Promise<void>;
  openXlsxImportPicker: () => Promise<void>;
  setIsTransferDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleExport: (
    format: DatabaseTableExportFormat,
    encoding?: TableExportEncoding,
    sqlInsertBatchSize?: number | undefined,
    sqlInsertConflictPolicy?: SqlInsertConflictPolicy,
    maxRows?: number | undefined,
    xlsxAutoFilter?: boolean | undefined,
  ) => Promise<void>;
  driver: DatabaseDriver;
  handleExportDatabaseSql: (
    scope: "all" | "structure" | "data",
  ) => Promise<void>;
  handleCancelExport: () => Promise<void>;
}

export function TableViewToolbar({
  activeTab,
  isTableReadOnly,
  isTransposed,
  isCrossDatabasePreview,
  isNativeObjectPreview,
  tableExportFormats,
  exportMaxRows,
  setExportMaxRows,
  supportsSqlConflictSkip,
  supportsSqlConflictUpdate,
  activeTableExport,
  activeCapabilities,
  isEditingEnabled,
  hasEdits,
  gridSelectionSummary,
  handleRefresh,
  addNewRow,
  dataGridRef,
  isMongoDocumentPreview,
  openMongoDocumentAction,
  result,
  commitEdits,
  cancelEdits,
  resetColumnLayout,
  setIsEditingEnabled,
  setTransposedTabIds,
  openCsvImportPicker,
  openJsonImportPicker,
  openXlsxImportPicker,
  setIsTransferDialogOpen,
  handleExport,
  driver,
  handleExportDatabaseSql,
  handleCancelExport,
}: TableViewToolbarProps) {
  return (
    <TableDataToolbar
      isExecuting={activeTab.isExecuting}
      readOnly={isTableReadOnly}
      viewOnly={isTransposed}
      exportDisabled={isCrossDatabasePreview || isNativeObjectPreview}
      exportFormats={tableExportFormats}
      exportMaxRows={exportMaxRows}
      onExportMaxRowsChange={setExportMaxRows}
      supportsSqlConflictSkip={supportsSqlConflictSkip}
      supportsSqlConflictUpdate={supportsSqlConflictUpdate}
      isExporting={Boolean(activeTableExport)}
      transferDisabled={
        isCrossDatabasePreview ||
        isNativeObjectPreview ||
        !activeCapabilities.supportsTableDataTransfer
      }
      editingEnabled={isEditingEnabled}
      hasEdits={hasEdits}
      editedCellCount={activeTab.pendingEdits?.size || 0}
      newRowCount={activeTab.newRowsCount || 0}
      selectedRowCount={gridSelectionSummary.selectedRowCount}
      onRefresh={handleRefresh}
      onAddRow={() => addNewRow(activeTab.id)}
      onDeleteRows={() => void dataGridRef.current?.deleteSelectedRows()}
      onEditDocument={
        isMongoDocumentPreview
          ? () => openMongoDocumentAction("edit")
          : undefined
      }
      onDeleteDocument={
        isMongoDocumentPreview
          ? () => openMongoDocumentAction("delete")
          : undefined
      }
      onCloneDocument={
        isMongoDocumentPreview
          ? () => openMongoDocumentAction("clone")
          : undefined
      }
      cloneDocumentDisabled={
        isTransposed || !result?.columns.some((column) => column.name === "_id")
      }
      onSave={() => void commitEdits(activeTab.id)}
      onRevert={() => cancelEdits(activeTab.id)}
      onSearch={() => dataGridRef.current?.openSearch()}
      onGoToColumn={() => dataGridRef.current?.openColumnLookup()}
      onFitColumns={() => dataGridRef.current?.fitColumns()}
      onResetColumns={() => resetColumnLayout(activeTab.id)}
      onToggleEditing={() => setIsEditingEnabled((value) => !value)}
      transposed={isTransposed}
      transposeDisabled={!result || hasEdits}
      onToggleTranspose={() => {
        setTransposedTabIds((previous) => {
          const next = new Set(previous);
          if (next.has(activeTab.id)) next.delete(activeTab.id);
          else next.add(activeTab.id);
          return next;
        });
      }}
      onImportCsv={() => void openCsvImportPicker()}
      onImportJson={() => void openJsonImportPicker()}
      onImportXlsx={() => void openXlsxImportPicker()}
      onTransfer={() => setIsTransferDialogOpen(true)}
      onExportCsv={() =>
        void handleExport("csv", "utf8", undefined, "strict", exportMaxRows)
      }
      onExportCsvBom={() =>
        void handleExport("csv", "utf8Bom", undefined, "strict", exportMaxRows)
      }
      onExportJson={() =>
        void handleExport("json", "utf8", undefined, "strict", exportMaxRows)
      }
      onExportJsonl={() =>
        void handleExport("jsonl", "utf8", undefined, "strict", exportMaxRows)
      }
      onExportMarkdown={() =>
        void handleExport(
          "markdown",
          "utf8",
          undefined,
          "strict",
          exportMaxRows,
        )
      }
      onExportSql={(batchSize, conflictPolicy) =>
        void handleExport(
          "sql",
          "utf8",
          batchSize,
          conflictPolicy,
          exportMaxRows,
        )
      }
      onExportDatabaseSql={
        normalizeDatabaseDriverName(driver) === "postgres" &&
        !isCrossDatabasePreview &&
        !isNativeObjectPreview
          ? (scope) => void handleExportDatabaseSql(scope)
          : undefined
      }
      onExportTsv={() =>
        void handleExport("tsv", "utf8", undefined, "strict", exportMaxRows)
      }
      onExportXlsx={(autoFilter) =>
        void handleExport(
          "xlsx",
          "binary",
          undefined,
          "strict",
          exportMaxRows,
          autoFilter,
        )
      }
      onExportParquet={() =>
        void handleExport(
          "parquet",
          "binary",
          undefined,
          "strict",
          exportMaxRows,
        )
      }
      onExportArrow={() =>
        void handleExport("arrow", "binary", undefined, "strict", exportMaxRows)
      }
      onCancelExport={() => void handleCancelExport()}
    />
  );
}
