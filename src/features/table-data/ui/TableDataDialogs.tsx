import { CsvImportDialog } from "@/components/workspace/CsvImportDialog";
import { JsonImportDialog } from "@/components/workspace/JsonImportDialog";
import { TableDataTransferDialog } from "@/components/workspace/TableDataTransferDialog";
import { Suspense, lazy } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useFileImportNavigation } from "@/features/table-import/fileImportNavigation";
import type { PrepareTableImportJobRequest } from "@/services/tauri/types/resumableImport";

const MongoDocumentCloneDialog = lazy(() =>
  import("@/features/data-grid/ui/MongoDocumentCloneDialog").then((module) => ({
    default: module.MongoDocumentCloneDialog,
  })),
);

const MongoDocumentMutationDialog = lazy(() =>
  import("@/features/data-grid/ui/MongoDocumentMutationDialog").then(
    (module) => ({ default: module.MongoDocumentMutationDialog }),
  ),
);

interface TableDataDialogsContext {
  isTableReadOnly: boolean;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  setCsvImportSource: React.Dispatch<
    React.SetStateAction<{
      file: File;
      nativePath?: string | undefined;
      previewTruncated?: boolean | undefined;
      contentDigest?: string | undefined;
    } | null>
  >;
  csvImportSource: {
    file: File;
    nativePath?: string | undefined;
    previewTruncated?: boolean | undefined;
    contentDigest?: string | undefined;
  } | null;
  activeTab: import("@/features/workspace-tabs/model/types").TabData;
  csvImportColumns: import("@/services/tauri/types").ColumnInfo[];
  isCsvImportSubmitting: boolean;
  isCsvImportCancelling: boolean;
  activeCsvImportId: string | null;
  handleCancelCsvImport: () => Promise<void>;
  handleImportCsvRows: (
    rows: Record<string, unknown>[],
    csvOptions: import("@/services/tauri/types").TableCsvImportOptions,
    _sourceEncoding: string,
    mode: import("@/services/tauri/types").TableImportMode,
  ) => Promise<void>;
  jsonImportSource: {
    nativePath: string;
    preview: import("@/services/tauri/types").TableJsonImportPreview;
  } | null;
  isJsonImportSubmitting: boolean;
  setJsonImportSource: React.Dispatch<
    React.SetStateAction<{
      nativePath: string;
      preview: import("@/services/tauri/types").TableJsonImportPreview;
    } | null>
  >;
  handleImportJsonRows: (
    mode: import("@/services/tauri/types").TableImportMode,
  ) => Promise<void>;
  xlsxImportSource: {
    nativePath: string;
    preview: import("@/services/tauri/types").TableXlsxImportPreview;
  } | null;
  isXlsxImportSubmitting: boolean;
  setXlsxImportSource: React.Dispatch<
    React.SetStateAction<{
      nativePath: string;
      preview: import("@/services/tauri/types").TableXlsxImportPreview;
    } | null>
  >;
  handleImportXlsxRows: (
    mode: import("@/services/tauri/types").TableImportMode,
  ) => Promise<void>;
  tabConnectionId: string | null;
  isTransferDialogOpen: boolean;
  activeProjectId: string;
  driver: import("@/services/tauri/types").DatabaseDriver;
  activeCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  connections: import("@/store/useConnectionStore").ConnectionConfig[];
  setIsTransferDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleRefresh: () => void;
  mongoDocumentAction: {
    mode: "clone" | "edit" | "delete";
    sourceId: unknown;
  } | null;
  setMongoDocumentAction: React.Dispatch<
    React.SetStateAction<{
      mode: "clone" | "edit" | "delete";
      sourceId: unknown;
    } | null>
  >;
  runTabQuery: (
    id: string,
    connectionId: string,
    sqlOverride?: string | undefined,
    transactionId?: string | undefined,
    sourceStartOffset?: number | undefined,
  ) => Promise<void>;
}

export function TableDataDialogs({
  isTableReadOnly,
  importInputRef,
  setCsvImportSource,
  csvImportSource,
  activeTab,
  csvImportColumns,
  isCsvImportSubmitting,
  isCsvImportCancelling,
  activeCsvImportId,
  handleCancelCsvImport,
  handleImportCsvRows,
  jsonImportSource,
  isJsonImportSubmitting,
  setJsonImportSource,
  handleImportJsonRows,
  xlsxImportSource,
  isXlsxImportSubmitting,
  setXlsxImportSource,
  handleImportXlsxRows,
  tabConnectionId,
  isTransferDialogOpen,
  activeProjectId,
  driver,
  activeCapabilities,
  connections,
  setIsTransferDialogOpen,
  handleRefresh,
  mongoDocumentAction,
  setMongoDocumentAction,
  runTabQuery,
}: TableDataDialogsContext) {
  const connection = connections.find(item => item.id === tabConnectionId);
  const resumableTarget = isTauri() && driver === "sqlite" && !!connection &&
    connection.origin !== "managed" && !connection.driverPackageVersion && !connection.sshTunnel?.enabled &&
    !isTableReadOnly && !activeTab.isExecuting && !!activeTab.tableName && !!activeTab.schemaName;
  const prepare = (source: Pick<PrepareTableImportJobRequest, "filePath" | "format" | "expectedFileDigest" | "mode" | "csvOptions">) => {
    if (!resumableTarget || !tabConnectionId || !activeTab.tableName || !activeTab.schemaName) return;
    useFileImportNavigation.getState().show(activeProjectId, {
      ...source, projectId: activeProjectId, importId: crypto.randomUUID(),
      connectionId: tabConnectionId, driver: "sqlite", schema: activeTab.schemaName,
      table: activeTab.tableName, database: activeTab.databaseName,
      firstRowHeader: source.csvOptions?.firstRowHeader ?? true,
    });
    setCsvImportSource(null);
    setJsonImportSource(null);
    setXlsxImportSource(null);
  };
  return (
    <>
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) {
            setCsvImportSource({ file });
          }
        }}
      />

      <CsvImportDialog
        open={csvImportSource !== null}
        file={csvImportSource?.file || null}
        tableName={activeTab.tableName || "table"}
        columns={csvImportColumns}
        isSubmitting={isCsvImportSubmitting}
        isCancelling={isCsvImportCancelling}
        isNativeSource={Boolean(csvImportSource?.nativePath)}
        nativePreviewTruncated={csvImportSource?.previewTruncated}
        onClose={() => setCsvImportSource(null)}
        onCancelImport={activeCsvImportId ? handleCancelCsvImport : undefined}
        onImport={handleImportCsvRows}
        onPrepareResumable={resumableTarget && csvImportSource?.nativePath && csvImportSource.contentDigest ? (csvOptions, mode) => prepare({ filePath: csvImportSource.nativePath!, format: "csv", expectedFileDigest: csvImportSource.contentDigest!, csvOptions, mode }) : undefined}
      />

      <JsonImportDialog
        open={jsonImportSource !== null}
        preview={jsonImportSource?.preview || null}
        format="JSON"
        tableName={activeTab.tableName || "table"}
        columns={csvImportColumns}
        isSubmitting={isJsonImportSubmitting}
        onClose={() => setJsonImportSource(null)}
        onImport={handleImportJsonRows}
        onPrepareResumable={resumableTarget && jsonImportSource?.preview.contentDigest ? mode => prepare({ filePath: jsonImportSource.nativePath, format: "json", expectedFileDigest: jsonImportSource.preview.contentDigest, mode }) : undefined}
      />

      <JsonImportDialog
        open={xlsxImportSource !== null}
        preview={xlsxImportSource?.preview || null}
        format="XLSX"
        tableName={activeTab.tableName || "table"}
        columns={csvImportColumns}
        isSubmitting={isXlsxImportSubmitting}
        onClose={() => setXlsxImportSource(null)}
        onImport={handleImportXlsxRows}
        onPrepareResumable={resumableTarget && xlsxImportSource?.preview.contentDigest ? mode => prepare({ filePath: xlsxImportSource.nativePath, format: "xlsx", expectedFileDigest: xlsxImportSource.preview.contentDigest, mode, csvOptions: undefined }) : undefined}
      />

      {tabConnectionId && activeTab.schemaName && activeTab.tableName && (
        <TableDataTransferDialog
          open={isTransferDialogOpen}
          projectId={activeProjectId}
          source={{
            connectionId: tabConnectionId,
            driver,
            schema: activeTab.schemaName,
            table: activeTab.tableName,
            database: activeTab.databaseName || undefined,
          }}
          sourceCapabilities={activeCapabilities}
          connections={connections}
          onClose={() => setIsTransferDialogOpen(false)}
          onTransferred={handleRefresh}
        />
      )}

      {tabConnectionId &&
        activeTab.schemaName &&
        activeTab.tableName &&
        mongoDocumentAction?.mode === "clone" && (
          <Suspense fallback={null}>
            <MongoDocumentCloneDialog
              open
              connectionId={tabConnectionId}
              driver={driver}
              database={activeTab.schemaName}
              collection={activeTab.tableName}
              sourceId={mongoDocumentAction.sourceId}
              onOpenChange={(nextOpen) => {
                if (!nextOpen) setMongoDocumentAction(null);
              }}
              onCloned={async () => {
                if (tabConnectionId && activeTab.sql.trim()) {
                  await runTabQuery(
                    activeTab.id,
                    tabConnectionId,
                    activeTab.sql,
                  );
                }
              }}
            />
          </Suspense>
        )}

      {tabConnectionId &&
        activeTab.schemaName &&
        activeTab.tableName &&
        mongoDocumentAction &&
        mongoDocumentAction.mode !== "clone" && (
          <Suspense fallback={null}>
            <MongoDocumentMutationDialog
              open
              mode={mongoDocumentAction.mode}
              connectionId={tabConnectionId}
              driver={driver}
              database={activeTab.schemaName}
              collection={activeTab.tableName}
              sourceId={mongoDocumentAction.sourceId}
              onOpenChange={(nextOpen) => {
                if (!nextOpen) setMongoDocumentAction(null);
              }}
              onMutated={async () => {
                if (tabConnectionId && activeTab.sql.trim()) {
                  await runTabQuery(
                    activeTab.id,
                    tabConnectionId,
                    activeTab.sql,
                  );
                }
              }}
            />
          </Suspense>
        )}
    </>
  );
}
