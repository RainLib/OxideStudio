import { Button } from "@/components/ui/button";
import {
  CreateConstraintDialog,
} from "@/components/workspace/CreateConstraintDialog";
import {
  CreateIndexDialog,
} from "@/components/workspace/CreateIndexDialog";
import { DataGrid } from "@/components/workspace/DataGrid";
import { GridFilterRow } from "@/components/workspace/GridFilterRow";
import { TableDdlView } from "@/components/workspace/TableDdlView";
import { stepGridZoom } from "@/lib/dataGridView";
import { normalizeDatabaseDriverName } from "@/lib/databaseDialect";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Code2,
  RefreshCw,
  TableProperties,
} from "lucide-react";
import { TableDataDialogs } from "@/features/table-data/ui/TableDataDialogs";
import { TableStructurePanel } from "@/features/table-data/ui/TableStructurePanel";
import { TableViewToolbar } from "@/features/table-data/ui/TableViewToolbar";
import type { useTableDataController } from "@/features/table-data/hooks/useTableDataController";

type TableDataViewContentProps = NonNullable<ReturnType<typeof useTableDataController>>;

export function TableDataViewContent({
  importInputRef, dataGridRef, setFilterMode, setVisualFilters, setSqlFilter, setGridSort,
  addNewRow, commitEdits, cancelEdits, resetColumnLayout, runTabQuery, activeTab, connections,
  activeProjectId, tabConnectionId, driver, activeCapabilities, defaultGridZoomPercent, tableExportFormats,
  supportsSqlConflictSkip, supportsSqlConflictUpdate, isNativeObjectPreview, isSearchObjectPreview,
  isMongoDocumentPreview, isCrossDatabasePreview, isTableReadOnly, canManageIndexes,
  canManageConstraints, metadataColumns, fallbackColumns, tableIndexes, tableConstraints,
  referencingForeignKeys, isMetadataLoading, tableDdl, isDdlLoading, ddlError, metadataError,
  refreshDdl, showStructure, setShowStructure, showDdl, setShowDdl, isIndexDialogOpen,
  setIsIndexDialogOpen, isIndexSubmitting, isConstraintDialogOpen, setIsConstraintDialogOpen,
  isConstraintSubmitting, csvImportSource, setCsvImportSource, jsonImportSource,
  setJsonImportSource, xlsxImportSource, setXlsxImportSource, isTransferDialogOpen,
  setIsTransferDialogOpen, isCsvImportSubmitting, isCsvImportCancelling, isJsonImportSubmitting,
  isXlsxImportSubmitting, activeCsvImportId, activeTableExport, exportMaxRows, setExportMaxRows,
  isEditingEnabled, setIsEditingEnabled, isGridReadOnly, gridZoomPercent, setGridZoomPercent,
  gridSelectionSummary, setGridSelectionSummary, mongoDocumentAction, setMongoDocumentAction,
  documentFilterDraft, setDocumentFilterDraft, documentSortDraft, setDocumentSortDraft,
  setTransposedTabIds, openDdlInQueryEditor, openCsvImportPicker, openJsonImportPicker,
  openXlsxImportPicker, recentExportReport, result, isTransposed, transposedResult,
  csvImportColumns, columns, filterMode, visualFilters, sqlFilter, handleSearch, handleRefresh,
  applyDocumentFilterAndSort, clearDocumentFilterAndSort, handleCalculateTotalRows,
  openMongoDocumentAction, handlePrevious, handleFirst, handleNext, handleLast, totalRows,
  visibleRows, startRow, endRow, canPrevious, canNext, canLast, hasEdits, handleExport,
  handleCancelExport, handleExportDatabaseSql, handleImportCsvRows, handleCancelCsvImport,
  handleImportJsonRows, handleImportXlsxRows, handleCreateIndex, handleDropIndex,
  handleRenameIndex, handleCreateUniqueConstraint, handleCreatePrimaryKey,
  handleCreateCheckConstraint, handleCreateForeignKey, handleDropConstraint,
}: TableDataViewContentProps) {
  return (
    <div
      className="flex flex-col h-full wb-grid-surface"
      onKeyDownCapture={(event) => {
        if (!event.metaKey && !event.ctrlKey) return;
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          setGridZoomPercent((value) => stepGridZoom(value, 1));
        } else if (event.key === "-") {
          event.preventDefault();
          setGridZoomPercent((value) => stepGridZoom(value, -1));
        } else if (event.key === "0") {
          event.preventDefault();
          setGridZoomPercent(defaultGridZoomPercent);
        }
      }}
      onWheelCapture={(event) => {
        if (!event.metaKey && !event.ctrlKey) return;
        event.preventDefault();
        setGridZoomPercent((value) =>
          stepGridZoom(value, event.deltaY < 0 ? 1 : -1),
        );
      }}
    >
      <TableDataDialogs
        importInputRef={importInputRef}
        setCsvImportSource={setCsvImportSource}
        csvImportSource={csvImportSource}
        activeTab={activeTab}
        csvImportColumns={csvImportColumns}
        isCsvImportSubmitting={isCsvImportSubmitting}
        isCsvImportCancelling={isCsvImportCancelling}
        activeCsvImportId={activeCsvImportId}
        handleCancelCsvImport={handleCancelCsvImport}
        handleImportCsvRows={handleImportCsvRows}
        jsonImportSource={jsonImportSource}
        isJsonImportSubmitting={isJsonImportSubmitting}
        setJsonImportSource={setJsonImportSource}
        handleImportJsonRows={handleImportJsonRows}
        xlsxImportSource={xlsxImportSource}
        isXlsxImportSubmitting={isXlsxImportSubmitting}
        setXlsxImportSource={setXlsxImportSource}
        handleImportXlsxRows={handleImportXlsxRows}
        tabConnectionId={tabConnectionId}
        isTransferDialogOpen={isTransferDialogOpen}
        activeProjectId={activeProjectId}
        driver={driver}
        activeCapabilities={activeCapabilities}
        connections={connections}
        setIsTransferDialogOpen={setIsTransferDialogOpen}
        handleRefresh={handleRefresh}
        mongoDocumentAction={mongoDocumentAction}
        setMongoDocumentAction={setMongoDocumentAction}
        runTabQuery={runTabQuery}
      />

      <TableViewToolbar
        activeTab={activeTab}
        isTableReadOnly={isTableReadOnly}
        isTransposed={isTransposed}
        isCrossDatabasePreview={isCrossDatabasePreview}
        isNativeObjectPreview={isNativeObjectPreview}
        tableExportFormats={tableExportFormats}
        exportMaxRows={exportMaxRows}
        setExportMaxRows={setExportMaxRows}
        supportsSqlConflictSkip={supportsSqlConflictSkip}
        supportsSqlConflictUpdate={supportsSqlConflictUpdate}
        activeTableExport={activeTableExport}
        activeCapabilities={activeCapabilities}
        isEditingEnabled={isEditingEnabled}
        hasEdits={hasEdits}
        gridSelectionSummary={gridSelectionSummary}
        handleRefresh={handleRefresh}
        addNewRow={addNewRow}
        dataGridRef={dataGridRef}
        isMongoDocumentPreview={isMongoDocumentPreview}
        openMongoDocumentAction={openMongoDocumentAction}
        result={result}
        commitEdits={commitEdits}
        cancelEdits={cancelEdits}
        resetColumnLayout={resetColumnLayout}
        setIsEditingEnabled={setIsEditingEnabled}
        setTransposedTabIds={setTransposedTabIds}
        openCsvImportPicker={openCsvImportPicker}
        openJsonImportPicker={openJsonImportPicker}
        openXlsxImportPicker={openXlsxImportPicker}
        setIsTransferDialogOpen={setIsTransferDialogOpen}
        handleExport={handleExport}
        driver={driver}
        handleExportDatabaseSql={handleExportDatabaseSql}
        handleCancelExport={handleCancelExport}
      />

      {recentExportReport && (
        <div
          className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-1 text-[10px] wb-muted"
          title={recentExportReport.error || "Latest export audit record"}
        >
          Latest export: {recentExportReport.status} ·{" "}
          {recentExportReport.format.toUpperCase()} ·{" "}
          {recentExportReport.encoding === "utf8Bom"
            ? "UTF-8 BOM"
            : recentExportReport.encoding === "binary"
              ? "Binary"
              : "UTF-8"}{" "}
          ·{" "}
          {recentExportReport.maxRows
            ? `first ${recentExportReport.maxRows.toLocaleString()} requested · `
            : "all matching rows · "}
          {recentExportReport.rowsExported.toLocaleString()} rows ·{" "}
          {recentExportReport.batches.toLocaleString()} batches
        </div>
      )}

      {isSearchObjectPreview && !showStructure && !showDdl && !isTransposed && (
        <form
          className="flex shrink-0 items-center gap-1.5 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            applyDocumentFilterAndSort();
          }}
        >
          <input
            value={documentFilterDraft}
            onChange={(event) => setDocumentFilterDraft(event.target.value)}
            className="h-7 min-w-0 flex-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[11px] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
            placeholder={
              normalizeDatabaseDriverName(driver) === "meilisearch"
                ? 'Filter: {"status":"published"} or status = "published"'
                : 'Filter JSON: {"term":{"status":"published"}}'
            }
            aria-label="Document filter"
            disabled={activeTab.isExecuting}
          />
          <input
            value={documentSortDraft}
            onChange={(event) => setDocumentSortDraft(event.target.value)}
            className="h-7 w-48 max-w-[30%] rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[11px] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
            placeholder={
              normalizeDatabaseDriverName(driver) === "meilisearch"
                ? 'Sort: {"title":"asc"}'
                : 'Sort JSON: [{"createdAt":"desc"}]'
            }
            aria-label="Document sort"
            disabled={activeTab.isExecuting}
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={activeTab.isExecuting}
          >
            Apply
          </Button>
          {(documentFilterDraft ||
            documentSortDraft ||
            activeTab.documentFilter ||
            activeTab.documentSort) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={activeTab.isExecuting}
              onClick={clearDocumentFilterAndSort}
            >
              Clear
            </Button>
          )}
        </form>
      )}

      {/* Query Builder Filter Row */}
      {!isNativeObjectPreview &&
        !showStructure &&
        !showDdl &&
        !isTransposed &&
        (result || fallbackColumns.length > 0) && (
          <GridFilterRow
            columns={columns}
            mode={filterMode}
            visualFilters={visualFilters}
            sqlFilter={sqlFilter}
            onModeChange={(mode) => setFilterMode(activeTab.id, mode)}
            onVisualFiltersChange={(filters) =>
              setVisualFilters(activeTab.id, filters)
            }
            onSqlFilterChange={(sql) => setSqlFilter(activeTab.id, sql)}
            onSearch={handleSearch}
            connectionId={tabConnectionId}
            driver={driver}
            capabilities={activeCapabilities}
            tabId={activeTab.id}
            databaseName={activeTab.databaseName}
            schemaName={activeTab.schemaName}
            tableName={activeTab.tableName}
            sortColumn={activeTab.gridState?.sortColumn}
            sortDirection={activeTab.gridState?.sortDirection}
            onSortChange={(column, direction) =>
              void setGridSort(activeTab.id, column, direction)
            }
          />
        )}

      {activeTab.error && (
        <div
          role="alert"
          className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--destructive)/0.08)] px-3 py-1.5 text-[11px] text-[hsl(var(--destructive))]"
        >
          {activeTab.error}
        </div>
      )}

      <div className="flex h-7 shrink-0 items-center border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-1.5">
        <button
          type="button"
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-[3px] px-2 text-[10px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
            !showStructure && !showDdl
              ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
              : "wb-muted hover:text-[hsl(var(--wb-text))]",
          )}
          onClick={() => {
            setShowDdl(false);
            setShowStructure(false);
          }}
        >
          <TableProperties size={12} />
          Data
        </button>
        {(!isNativeObjectPreview || isSearchObjectPreview) && (
          <button
            type="button"
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-[3px] px-2 text-[10px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
              showDdl
                ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                : "wb-muted hover:text-[hsl(var(--wb-text))]",
            )}
            onClick={() => {
              setShowDdl(true);
              setShowStructure(false);
            }}
          >
            <Code2 size={12} />
            {isSearchObjectPreview ? "Mapping" : "DDL"}
          </button>
        )}
        <span className="ml-auto min-w-0 truncate px-2 text-[10px] wb-muted">
          {[activeTab.databaseName, activeTab.schemaName, activeTab.tableName]
            .filter(Boolean)
            .join(".")}
        </span>
      </div>
      {showStructure && metadataError && (
        <div className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-1 text-xs text-destructive">
          {metadataError}
        </div>
      )}
      {showStructure && isMetadataLoading && !metadataError && (
        <div className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-1 text-xs text-[hsl(var(--wb-text-muted))]">
          Loading structure...
        </div>
      )}

      {showDdl && (
        <TableDdlView
          ddl={tableDdl}
          isLoading={isDdlLoading}
          error={ddlError}
          onRefresh={() => void refreshDdl(true)}
          onOpenInQuery={openDdlInQueryEditor}
          kind={isSearchObjectPreview ? "mapping" : "ddl"}
        />
      )}

      {showStructure && (
        <TableStructurePanel
          metadataColumns={metadataColumns}
          setIsIndexDialogOpen={setIsIndexDialogOpen}
          canManageIndexes={canManageIndexes}
          isCrossDatabasePreview={isCrossDatabasePreview}
          activeCapabilities={activeCapabilities}
          tableIndexes={tableIndexes}
          isMongoDocumentPreview={isMongoDocumentPreview}
          handleRenameIndex={handleRenameIndex}
          handleDropIndex={handleDropIndex}
          setIsConstraintDialogOpen={setIsConstraintDialogOpen}
          canManageConstraints={canManageConstraints}
          tableConstraints={tableConstraints}
          handleDropConstraint={handleDropConstraint}
        />
      )}

      {/* Main Grid View */}
      {!showStructure && !showDdl && (
        <div className="relative min-h-0 flex-1 wb-grid-surface">
          <DataGrid
            ref={dataGridRef}
            overrideColumns={fallbackColumns}
            readOnly={isGridReadOnly || activeTab.isExecuting}
            resultOverride={transposedResult}
            transposed={isTransposed}
            onEditDocument={
              isMongoDocumentPreview && !isTransposed
                ? (rowIndex) => openMongoDocumentAction("edit", rowIndex)
                : undefined
            }
            onCloneDocument={
              isMongoDocumentPreview && !isTransposed
                ? (rowIndex) => openMongoDocumentAction("clone", rowIndex)
                : undefined
            }
            onDeleteDocument={
              isMongoDocumentPreview && !isTransposed
                ? (rowIndex) => openMongoDocumentAction("delete", rowIndex)
                : undefined
            }
            zoomPercent={gridZoomPercent}
            onSelectionSummaryChange={setGridSelectionSummary}
            tableConstraints={tableConstraints}
            referencingForeignKeys={referencingForeignKeys}
          />
          <div className="absolute bottom-3 left-1/2 z-40 flex h-8 -translate-x-1/2 items-center gap-0.5 rounded-[6px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised)/0.94)] px-1 shadow-[0_8px_22px_rgba(0,0,0,0.26)] backdrop-blur-sm">
            <button
              type="button"
              className="wb-icon-button"
              disabled={!canPrevious}
              onClick={handleFirst}
              title="First page"
            >
              <ChevronsLeft size={13} />
            </button>
            <button
              type="button"
              className="wb-icon-button"
              disabled={!canPrevious}
              onClick={handlePrevious}
              title="Previous page"
            >
              <ChevronLeft size={13} />
            </button>
            {!isSearchObjectPreview && !isNativeObjectPreview && (
              <button
                type="button"
                className="wb-icon-button"
                disabled={activeTab.isExecuting || hasEdits}
                onClick={handleCalculateTotalRows}
                title={
                  hasEdits
                    ? "Apply or discard edits before calculating the exact total"
                    : "Calculate exact total rows for the current filter"
                }
                aria-label="Calculate exact total rows"
              >
                <RefreshCw
                  size={12}
                  className={activeTab.isExecuting ? "animate-spin" : undefined}
                />
              </button>
            )}
            <span className="min-w-[112px] px-1 text-center text-[10px] tabular-nums text-[hsl(var(--wb-text-muted))]">
              {totalRows == null
                ? `${visibleRows.toLocaleString()} rows`
                : `${startRow.toLocaleString()}-${endRow.toLocaleString()} of ${totalRows.toLocaleString()}`}
            </span>
            <button
              type="button"
              className="wb-icon-button"
              disabled={!canNext}
              onClick={handleNext}
              title="Next page"
            >
              <ChevronRight size={13} />
            </button>
            <button
              type="button"
              className="wb-icon-button"
              disabled={isSearchObjectPreview || !canLast}
              onClick={handleLast}
              title="Last page"
            >
              <ChevronsRight size={13} />
            </button>
          </div>
        </div>
      )}
      <CreateIndexDialog
        isOpen={isIndexDialogOpen}
        onClose={() => setIsIndexDialogOpen(false)}
        tableName={activeTab.tableName || ""}
        columns={metadataColumns}
        isSubmitting={isIndexSubmitting}
        onCreate={handleCreateIndex}
      />
      <CreateConstraintDialog
        isOpen={isConstraintDialogOpen}
        onClose={() => setIsConstraintDialogOpen(false)}
        connectionId={tabConnectionId || ""}
        driver={driver}
        schema={activeTab.schemaName || ""}
        tableName={activeTab.tableName || ""}
        columns={metadataColumns}
        isSubmitting={isConstraintSubmitting}
        supportsForeignKeys={activeCapabilities.supportsForeignKeys}
        supportsCheckConstraints={activeCapabilities.supportsCheckConstraints}
        onCreateUnique={handleCreateUniqueConstraint}
        onCreatePrimaryKey={handleCreatePrimaryKey}
        onCreateCheck={handleCreateCheckConstraint}
        onCreateForeignKey={handleCreateForeignKey}
      />
    </div>
  );
}