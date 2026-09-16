import { AgentFileDiffReviewBar } from "@/components/workspace/AgentFileDiffReviewBar";
import { EditorActionBar } from "@/components/workspace/EditorActionBar";
import { GitFileDiffReviewBar } from "@/components/workspace/GitFileDiffReviewBar";
import { captureQueryExecutionSnapshot } from "@/features/query-editor/hooks/useQueryExecutionController";
import type {
  QueryTransactionMode,
  QueryTransactionState,
} from "@/features/query-editor/hooks/useQueryTransactionController";
import type { QueryExecutionSnapshot } from "@/features/query-editor/model/queryExecutionTarget";
import type {
  QueryLanguage,
  TabData,
} from "@/features/workspace-tabs/model/types";
import type { PostgresDatabaseDiscoveryState } from "@/hooks/usePostgresDatabaseDiscovery";
import { saveEditorFileTab } from "@/lib/editorFileSave";
import type { ProjectFileLanguage } from "@/lib/projectFileLanguage";
import type { QueryHistoryItem } from "@/lib/queryHistory";
import { stripSqlExtension } from "@/lib/savedSqlLibrary";
import { cn } from "@/lib/utils";
import { type DatabaseCapabilities } from "@/services/tauri";
import type { SavedSqlFile } from "@/services/tauri/saved-sql.service";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import type { SavedQueryTarget } from "@/store/useSavedQueryStore";
import { useTabStore } from "@/store/useTabStore";
import { Image as ImageIcon, Save } from "lucide-react";

interface QueryEditorCommandBarProps {
  activeTab: TabData;
  isProjectFilePreview: boolean;
  activeProjectFileLanguage: ProjectFileLanguage | null;
  canExecuteDocument: boolean;
  effectiveConnectionId: string | null;
  currentSchema: string | null;
  handleSchemaChange: (schema: string) => void;
  canBrowseDatabaseCatalogs: boolean;
  catalogDatabases: string[];
  configuredCatalogDatabase: string | null;
  handleDatabaseChange: (database: string) => void;
  postgresDatabaseDiscovery: PostgresDatabaseDiscoveryState;
  activeTransactionState: QueryTransactionState;
  transactionMode: QueryTransactionMode;
  transactionOperation: "begin" | "commit" | "rollback" | null;
  handleTransactionModeChange: (mode: QueryTransactionMode) => void;
  handleBeginTransaction: () => Promise<void>;
  handleCommitTransaction: () => Promise<boolean>;
  handleRollbackTransaction: () => Promise<void>;
  handleFormat: () => void;
  handleRun: () => void;
  pendingToolbarExecutionSnapshotRef: React.RefObject<QueryExecutionSnapshot | null>;
  editorRef: React.RefObject<any>;
  handleRunCurrent: (
    capturedSnapshot?: QueryExecutionSnapshot | null | undefined,
  ) => Promise<void>;
  canPreviewChanges: boolean;
  isPreviewingChanges: boolean;
  handlePreviewChanges: () => Promise<void>;
  handleExplain: (mode: "estimate" | "analyze") => void;
  handleCancelRun: () => void;
  capabilities: DatabaseCapabilities;
  handleImportSqlScript: () => void;
  isElasticsearchConsole: boolean;
  handleImportConsoleRequests: () => Promise<void>;
  handleExportConsoleRequests: () => Promise<void>;
  editorFileOperation:
    | "sql-review"
    | "sql-import"
    | "console-import"
    | "console-export"
    | null;
  savedQueries: SavedSqlFile[];
  openHistoryInEditor: (item: QueryHistoryItem) => void;
  rerunHistory: (item: QueryHistoryItem) => Promise<boolean>;
  activeProjectId: string;
  openSavedSqlFile: (id: string) => Promise<SavedSqlFile | undefined>;
  updateSavedSqlFile: (
    id: string,
    name: string,
    sql: string,
    target?: SavedQueryTarget | undefined,
  ) => Promise<boolean>;
  saveQuery: (
    name: string,
    sql: string,
    target?: SavedQueryTarget | undefined,
  ) => Promise<SavedSqlFile>;
  deleteQuery: (id: string) => Promise<void>;
  supportsTransactions: boolean;
  parameterCount: number;
  handleConfigureParameters: () => void;
  driver: DatabaseDriver;
  setQueryLanguage: (id: string, language: QueryLanguage) => void;
  elasticsearchVariableNames: string[];
  setElasticsearchVariables: (
    id: string,
    variables: Record<string, string>,
  ) => void;
}

export function QueryEditorCommandBar({
  activeTab,
  isProjectFilePreview,
  activeProjectFileLanguage,
  canExecuteDocument,
  effectiveConnectionId,
  currentSchema,
  handleSchemaChange,
  canBrowseDatabaseCatalogs,
  catalogDatabases,
  configuredCatalogDatabase,
  handleDatabaseChange,
  postgresDatabaseDiscovery,
  activeTransactionState,
  transactionMode,
  transactionOperation,
  handleTransactionModeChange,
  handleBeginTransaction,
  handleCommitTransaction,
  handleRollbackTransaction,
  handleFormat,
  handleRun,
  pendingToolbarExecutionSnapshotRef,
  editorRef,
  handleRunCurrent,
  canPreviewChanges,
  isPreviewingChanges,
  handlePreviewChanges,
  handleExplain,
  handleCancelRun,
  capabilities,
  handleImportSqlScript,
  isElasticsearchConsole,
  handleImportConsoleRequests,
  handleExportConsoleRequests,
  editorFileOperation,
  savedQueries,
  openHistoryInEditor,
  rerunHistory,
  activeProjectId,
  openSavedSqlFile,
  updateSavedSqlFile,
  saveQuery,
  deleteQuery,
  supportsTransactions,
  parameterCount,
  handleConfigureParameters,
  driver,
  setQueryLanguage,
  elasticsearchVariableNames,
  setElasticsearchVariables,
}: QueryEditorCommandBarProps) {
  return activeTab.agentFileDiffPreview ? (
    <AgentFileDiffReviewBar preview={activeTab.agentFileDiffPreview} />
  ) : activeTab.gitFileDiffPreview ? (
    <GitFileDiffReviewBar preview={activeTab.gitFileDiffPreview} />
  ) : isProjectFilePreview && activeTab.filePreview ? (
    <div className="wb-editor-commandbar justify-between gap-2">
      <div
        className="flex min-w-0 items-center gap-1.5 truncate text-[10px] wb-muted"
        title={activeTab.fileRelativePath}
      >
        <ImageIcon size={12} className="shrink-0 text-violet-400" />
        <span className="truncate">{activeTab.fileRelativePath}</span>
      </div>
      <span className="shrink-0 text-[9px] uppercase tracking-wide wb-muted">
        Image preview · Read only
      </span>
    </div>
  ) : activeProjectFileLanguage && !canExecuteDocument ? (
    <div className="wb-editor-commandbar justify-between gap-2">
      <div
        className="min-w-0 truncate text-[10px] wb-muted"
        title={activeTab.fileRelativePath}
      >
        {activeTab.fileRelativePath}
        <span className="ml-2 uppercase opacity-70">
          {activeProjectFileLanguage.editorLanguageId}
        </span>
      </div>
      <button
        type="button"
        className={cn(
          "wb-text-button h-6 shrink-0 gap-1.5 px-2 text-[10px]",
          activeTab.isDirty && "text-[hsl(var(--wb-accent))]",
        )}
        onClick={() => void saveEditorFileTab(activeTab.id)}
        disabled={!activeTab.isDirty}
        title={
          activeTab.isDirty
            ? "Save Project File (Ctrl+S)"
            : "Project File Saved"
        }
      >
        <Save size={12} />
        Save
      </button>
    </div>
  ) : (
    <EditorActionBar
      connectionId={effectiveConnectionId}
      currentSchema={activeTab.targetSchema ?? currentSchema}
      onSchemaChange={handleSchemaChange}
      databases={canBrowseDatabaseCatalogs ? catalogDatabases : undefined}
      currentDatabase={
        canBrowseDatabaseCatalogs
          ? activeTab.databaseName ||
            configuredCatalogDatabase ||
            catalogDatabases[0] ||
            null
          : null
      }
      onDatabaseChange={
        canBrowseDatabaseCatalogs ? handleDatabaseChange : undefined
      }
      isDatabaseRefreshing={postgresDatabaseDiscovery.isRefreshing}
      databaseSelectionDisabled={activeTransactionState === "active"}
      transactionMode={transactionMode}
      transactionState={activeTransactionState}
      transactionOperation={transactionOperation}
      onTransactionModeChange={handleTransactionModeChange}
      onBeginTransaction={handleBeginTransaction}
      onCommitTransaction={handleCommitTransaction}
      onRollbackTransaction={handleRollbackTransaction}
      onFormat={handleFormat}
      onRun={handleRun}
      onRunCurrentPointerDown={() => {
        pendingToolbarExecutionSnapshotRef.current =
          captureQueryExecutionSnapshot(editorRef.current);
      }}
      onRunCurrent={() => {
        const snapshot = pendingToolbarExecutionSnapshotRef.current;
        pendingToolbarExecutionSnapshotRef.current = null;
        void handleRunCurrent(snapshot);
      }}
      canPreviewChanges={canPreviewChanges}
      isPreviewingChanges={isPreviewingChanges}
      onPreviewChanges={() => void handlePreviewChanges()}
      onExplain={handleExplain}
      onCancelRun={handleCancelRun}
      onImportSqlScript={
        capabilities.supportsSqlQuery ? handleImportSqlScript : undefined
      }
      onImportConsoleRequests={
        isElasticsearchConsole ? handleImportConsoleRequests : undefined
      }
      onExportConsoleRequests={
        isElasticsearchConsole ? handleExportConsoleRequests : undefined
      }
      fileOperation={editorFileOperation}
      isExecuting={activeTab.isExecuting}
      isConnected={Boolean(effectiveConnectionId && canExecuteDocument)}
      supportsExplainPlan={
        capabilities.supportsExplainPlan && canExecuteDocument
      }
      savedQueries={savedQueries}
      onOpenHistory={openHistoryInEditor}
      onRerunHistory={rerunHistory}
      onLoadQuery={async (item) => {
        const existing = useTabStore
          .getState()
          .tabs.find(
            (tab) =>
              tab.savedSqlProjectId === activeProjectId &&
              tab.savedSqlFileId === item.id,
          );
        if (existing) {
          useTabStore.getState().setActiveTab(existing.id);
          return;
        }
        const file = await openSavedSqlFile(item.id);
        if (!file) return;
        useTabStore
          .getState()
          .createTab("query", stripSqlExtension(file.name), file.sql, {
            connectionId: file.connectionId || undefined,
            databaseName: file.databaseName || undefined,
            schemaName: file.schemaName || undefined,
            savedSqlProjectId: file.projectId,
            savedSqlFileId: file.id,
          });
      }}
      onSaveQuery={async (name: string) => {
        if (activeTab.savedSqlFileId) {
          const saved = await updateSavedSqlFile(
            activeTab.savedSqlFileId,
            name,
            activeTab.sql,
            {
              connectionId: effectiveConnectionId || null,
              databaseName: activeTab.databaseName || null,
              schemaName: activeTab.schemaName || currentSchema || null,
            },
          );
          if (saved) {
            useTabStore.setState((state) => ({
              tabs: state.tabs.map((tab) =>
                tab.id === activeTab.id
                  ? {
                      ...tab,
                      title: stripSqlExtension(name),
                      isDirty: false,
                      fileError: null,
                    }
                  : tab,
              ),
            }));
          }
          return;
        }
        const file = await saveQuery(name, activeTab.sql, {
          connectionId: effectiveConnectionId || null,
          databaseName: activeTab.databaseName || null,
          schemaName: activeTab.schemaName || currentSchema || null,
        });
        useTabStore.setState((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === activeTab.id
              ? {
                  ...tab,
                  title: stripSqlExtension(file.name),
                  savedSqlProjectId: file.projectId,
                  savedSqlFileId: file.id,
                  isDirty: false,
                }
              : tab,
          ),
        }));
      }}
      onDeleteQuery={deleteQuery}
      supportsTransactions={supportsTransactions && canExecuteDocument}
      fileSaveTarget={
        activeTab.fileRelativePath
          ? "original-file"
          : activeTab.savedSqlFileId
            ? "sql-library"
            : null
      }
      isFileDirty={Boolean(activeTab.isDirty)}
      onSaveFile={() => void saveEditorFileTab(activeTab.id)}
      parameterCount={canExecuteDocument ? parameterCount : 0}
      onConfigureParameters={handleConfigureParameters}
      queryLanguage={
        driver === "elasticsearch"
          ? activeTab.queryLanguage || "elasticsearch-dsl"
          : undefined
      }
      onQueryLanguageChange={(queryLanguage) =>
        setQueryLanguage(activeTab.id, queryLanguage)
      }
      elasticsearchVariableNames={elasticsearchVariableNames}
      elasticsearchVariables={activeTab.elasticsearchVariables}
      onElasticsearchVariableChange={(name, value) =>
        setElasticsearchVariables(activeTab.id, {
          ...activeTab.elasticsearchVariables,
          [name]: value,
        })
      }
    />
  );
}
