import { useQueryEditorController } from "@/features/query-editor/hooks/useQueryEditorController";
import type { QueryEditorProps } from "@/features/query-editor/model/queryEditorProps";
import { DangerousSqlConfirmDialog } from "@/features/query-editor/ui/DangerousSqlConfirmDialog";
import { QueryEditorCommandBar } from "@/features/query-editor/ui/QueryEditorCommandBar";
import { QueryEditorPatchReview } from "@/features/query-editor/ui/QueryEditorPatchReview";
import { QueryEditorStatusBar } from "@/features/query-editor/ui/QueryEditorStatusBar";
import { QueryEditorSurface } from "@/features/query-editor/ui/QueryEditorSurface";
import { SqlBatchColumnDialog } from "./SqlBatchColumnDialog";
import { SqlParametersPanel } from "./SqlParametersPanel";
import { SqlScriptImportDialog } from "./SqlScriptImportDialog";

export function QueryEditor({
  tabId,
  isActivePane = true,
  onActivate,
  editorGroupId,
  onVimWindowNavigate,
}: QueryEditorProps = {}) {
  const controller = useQueryEditorController({ tabId, isActivePane, onActivate, editorGroupId, onVimWindowNavigate });
  const {
    activeTab,
    activeProjectFileLanguage,
    activeProjectId,
    activeTransactionState,
    applyBatchColumnSelection,
    applyEditorPatchPreview,
    batchColumnSession,
    canAcceptExplorerTableDrop,
    canBrowseDatabaseCatalogs,
    canExecuteDocument,
    canPreviewChanges,
    capabilities,
    catalogDatabases,
    closeParameterExecution,
    closeSqlScriptImport,
    configuredCatalogDatabase,
    connectedConnectionIds,
    currentSchema,
    cursorPosition,
    dangerousExecution,
    dismissEditorPatch,
    documentUri,
    driver,
    editorSettings,
    canUseLsp,
    editorFileOperation,
    editorLanguageId,
    editorOptions,
    editorRef,
    effectiveConnectionId,
    elasticsearchVariableNames,
    executionNotice,
    handleBeginTransaction,
    handleCancelRun,
    handleCommitTransaction,
    handleConfigureParameters,
    handleConfirmSqlScriptImport,
    handleDatabaseChange,
    handleEditorBeforeMount,
    handleEditorContentChange,
    handleEditorMount,
    handleExplain,
    handleExportConsoleRequests,
    handleFormat,
    handleImportConsoleRequests,
    handleImportSqlScript,
    handlePreviewChanges,
    handleRollbackTransaction,
    handleRun,
    handleRunCurrent,
    handleRunParameterizedSql,
    handleSchemaChange,
    handleTransactionModeChange,
    handleSavedSqlDragOver,
    handleSavedSqlDrop,
    inlineCompletionStatus,
    isElasticsearchConsole,
    isPreviewingChanges,
    isProjectFilePreview,
    isSqlScriptImporting,
    lspError,
    lspReady,
    lspStatus,
    mode,
    openHistoryInEditor,
    openSavedSqlFile,
    parameterCount,
    parameterExecution,
    pendingSqlScriptImport,
    pendingToolbarExecutionSnapshotRef,
    postgresDatabaseDiscovery,
    resolveDangerousExecution,
    restoreDangerousExecutionFocus,
    rerunHistory,
    savedQueries,
    saveQuery,
    deleteQuery,
    setBatchColumnSession,
    setElasticsearchVariables,
    setQueryLanguage,
    supportsTransactions,
    tableDropCaretRef,
    tableDropTargetRef,
    transactionMode,
    transactionOperation,
    updateSavedSqlFile,
    usesGenericSqlLsp,
    vimStatusNodeRef,
    visibleLspSemanticPresentation,
  } = controller;
  if (!activeTab) return null;
  return (
    <div
      className="wb-query-editor relative flex h-full w-full flex-col bg-[hsl(var(--wb-editor))]"
      data-editor-group-id={editorGroupId}
      onFocusCapture={onActivate}
      onPointerDown={onActivate}
      onDragOverCapture={handleSavedSqlDragOver}
      onDropCapture={(event) => void handleSavedSqlDrop(event)}
    >
      <DangerousSqlConfirmDialog
        open={Boolean(dangerousExecution)}
        message={dangerousExecution?.message || "Execute this query?"}
        onDecision={resolveDangerousExecution}
        onCloseAutoFocus={restoreDangerousExecutionFocus}
      />
      <SqlScriptImportDialog
        open={Boolean(pendingSqlScriptImport)}
        preview={pendingSqlScriptImport?.preview || null}
        target={pendingSqlScriptImport?.target.label || "selected data source"}
        isSubmitting={isSqlScriptImporting}
        onClose={closeSqlScriptImport}
        onImport={handleConfirmSqlScriptImport}
      />
      <SqlBatchColumnDialog
        session={batchColumnSession}
        onClose={() => setBatchColumnSession(null)}
        onApply={applyBatchColumnSelection}
      />
      {
        <QueryEditorCommandBar
          activeTab={activeTab}
          isProjectFilePreview={isProjectFilePreview}
          activeProjectFileLanguage={activeProjectFileLanguage}
          canExecuteDocument={canExecuteDocument}
          effectiveConnectionId={effectiveConnectionId}
          currentSchema={currentSchema}
          handleSchemaChange={handleSchemaChange}
          canBrowseDatabaseCatalogs={canBrowseDatabaseCatalogs}
          catalogDatabases={catalogDatabases}
          configuredCatalogDatabase={configuredCatalogDatabase}
          handleDatabaseChange={handleDatabaseChange}
          postgresDatabaseDiscovery={postgresDatabaseDiscovery}
          activeTransactionState={activeTransactionState}
          transactionMode={transactionMode}
          transactionOperation={transactionOperation}
          handleTransactionModeChange={handleTransactionModeChange}
          handleBeginTransaction={handleBeginTransaction}
          handleCommitTransaction={handleCommitTransaction}
          handleRollbackTransaction={handleRollbackTransaction}
          handleFormat={handleFormat}
          handleRun={handleRun}
          pendingToolbarExecutionSnapshotRef={
            pendingToolbarExecutionSnapshotRef
          }
          editorRef={editorRef}
          handleRunCurrent={handleRunCurrent}
          canPreviewChanges={canPreviewChanges}
          isPreviewingChanges={isPreviewingChanges}
          handlePreviewChanges={handlePreviewChanges}
          handleExplain={handleExplain}
          handleCancelRun={handleCancelRun}
          capabilities={capabilities}
          handleImportSqlScript={handleImportSqlScript}
          isElasticsearchConsole={isElasticsearchConsole}
          handleImportConsoleRequests={handleImportConsoleRequests}
          handleExportConsoleRequests={handleExportConsoleRequests}
          editorFileOperation={editorFileOperation}
          savedQueries={savedQueries}
          openHistoryInEditor={openHistoryInEditor}
          rerunHistory={rerunHistory}
          activeProjectId={activeProjectId}
          openSavedSqlFile={openSavedSqlFile}
          updateSavedSqlFile={updateSavedSqlFile}
          saveQuery={saveQuery}
          deleteQuery={deleteQuery}
          supportsTransactions={supportsTransactions}
          parameterCount={parameterCount}
          handleConfigureParameters={handleConfigureParameters}
          driver={driver}
          setQueryLanguage={setQueryLanguage}
          elasticsearchVariableNames={elasticsearchVariableNames}
          setElasticsearchVariables={setElasticsearchVariables}
        />
      }

      {!isProjectFilePreview &&
        !activeTab.gitFileDiffPreview &&
        parameterExecution && (
          <SqlParametersPanel
            sql={parameterExecution.sql}
            dialect={driver}
            isConnected={Boolean(effectiveConnectionId && canExecuteDocument)}
            isExecuting={activeTab.isExecuting}
            onClose={closeParameterExecution}
            onRun={handleRunParameterizedSql}
          />
        )}

      {!isProjectFilePreview &&
        !activeTab.agentFileDiffPreview &&
        !activeTab.gitFileDiffPreview &&
        activeTab.editorPatchPreview && (
          <QueryEditorPatchReview
            activeTab={activeTab}
            capabilities={capabilities}
            driver={driver}
            effectiveConnectionId={effectiveConnectionId}
            connectedConnectionIds={connectedConnectionIds}
            currentSchema={currentSchema}
            dismissEditorPatch={dismissEditorPatch}
            applyEditorPatchPreview={applyEditorPatchPreview}
          />
        )}

      {activeTab.fileError && (
        <div className="flex min-h-7 items-center border-b border-red-500/25 bg-red-500/10 px-3 text-[10px] text-red-200">
          {activeTab.fileError}
        </div>
      )}

      {/* Editor */}
      <QueryEditorSurface
        tableDropTargetRef={tableDropTargetRef}
        canAcceptExplorerTableDrop={canAcceptExplorerTableDrop}
        activeTab={activeTab}
        editorLanguageId={editorLanguageId}
        handleEditorBeforeMount={handleEditorBeforeMount}
        mode={mode}
        editorOptions={editorOptions}
        documentUri={documentUri}
        handleEditorContentChange={handleEditorContentChange}
        handleEditorMount={handleEditorMount}
        tableDropCaretRef={tableDropCaretRef}
      />

      {isActivePane &&
        !isProjectFilePreview &&
        !activeTab.agentFileDiffPreview &&
        !activeTab.gitFileDiffPreview && (
          <QueryEditorStatusBar
            cursorPosition={cursorPosition}
            editorSettings={editorSettings}
            vimStatusNodeRef={vimStatusNodeRef}
            inlineCompletionStatus={inlineCompletionStatus}
            executionNotice={executionNotice}
            canUseLsp={canUseLsp}
            lspError={lspError}
            isElasticsearchConsole={isElasticsearchConsole}
            usesGenericSqlLsp={usesGenericSqlLsp}
            lspStatus={lspStatus}
            visibleLspSemanticPresentation={visibleLspSemanticPresentation}
            lspReady={lspReady}
          />
        )}
    </div>
  );
}
