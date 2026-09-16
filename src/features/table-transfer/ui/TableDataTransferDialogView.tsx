import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { displayEndpoint } from "@/features/table-transfer/model/transferPolicy";
import type { TableDataTransferDialogController } from "@/features/table-transfer/hooks/useTableDataTransferDialogController";
import { TransferReviewSection } from "@/features/table-transfer/ui/TransferReviewSection";
import { TransferSetupSection } from "@/features/table-transfer/ui/TransferSetupSection";
import { TransferWorkflowSidebar } from "@/features/table-transfer/ui/TransferWorkflowSidebar";
import { AlertCircle, Loader2 } from "lucide-react";

interface TableDataTransferDialogViewProps {
  controller: TableDataTransferDialogController;
}

export function TableDataTransferDialogView({
  controller,
}: TableDataTransferDialogViewProps) {
  const {
    open,
    onClose,
    source,
    initialSourceScope,
    sourceSchemas,
    effectiveSource,
    selectedSourceTables,
    destinationReady,
    targetConnection,
    targetSchema,
    reviewReady,
    canExecute,
    selectSection,
    activeSection,
    targetTableMode,
    hasCurrentReview,
    setupSectionRef,
    activeSourceSchema,
    setActiveSourceSchema,
    setSourceTables,
    setSelectedSourceTables,
    setSourceTransferObjects,
    setSelectedTransferObjectKeys,
    resetTransferReview,
    setError,
    isSubmitting,
    sourceTables,
    toggleSourceTable,
    selectedTransferObjects,
    isSourceObjectsLoading,
    sourceTransferObjectGroups,
    selectedTransferObjectKeys,
    toggleTransferObject,
    targetConnectionId,
    setTargetConnectionId,
    eligibleTargetConnections,
    sourceSupportsTransfer,
    targetSupportsCatalogs,
    targetDatabase,
    setTargetDatabase,
    isDatabasesLoading,
    databases,
    setTargetSchema,
    isSchemasLoading,
    schemas,
    handleTargetTableModeChange,
    isTablesLoading,
    isBatchTransfer,
    targetSupportsGeneratedTable,
    targetTable,
    setTargetTable,
    tables,
    setTargetPlan,
    setTargetPlanPreviewKey,
    setTargetPlanConfirmation,
    mode,
    handleModeChange,
    targetDistribution,
    canConfigureTargetColumnQuoting,
    quoteTargetColumnNames,
    setQuoteTargetColumnNames,
    maxRows,
    setMaxRows,
    batchSize,
    setBatchSize,
    reseedIdentity,
    setReseedIdentity,
    canRestoreSourceSchemaObjects,
    restoreSourceSchemaObjects,
    setRestoreSourceSchemaObjects,
    reviewSectionRef,
    recentReports,
    handleRetryReport,
    targetPlan,
    handlePreviewTarget,
    targetPlanRequest,
    targetPlanPreviewKey,
    targetPlanRequestKey,
    targetPlanConfirmation,
    handleCreateTarget,
    isCreatingTarget,
    batchPlan,
    batchPlanIsCurrent,
    progress,
    confirmation,
    setConfirmation,
    preview,
    planIsCurrent,
    error,
    isExecuting,
    isCancelling,
    handleCancelTransfer,
    handlePreview,
    handleTransfer,
  } = controller;
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && !isSubmitting && onClose()}
    >
      <DialogContent className="flex h-[min(740px,calc(100vh-32px))] max-h-none w-[min(960px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden rounded-[8px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] p-0 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_12px_36px_rgba(0,0,0,0.4)]">
        <DialogHeader className="relative flex h-10 shrink-0 items-center justify-center border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-frame))] px-4 py-0">
          <DialogTitle className="text-[12px] font-semibold tracking-normal text-[hsl(var(--wb-text-muted))]">
            Data transfer
          </DialogTitle>
          <DialogDescription className="sr-only">
            Copy data to a reviewed target table without writing rows until
            confirmation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)]">
          <TransferWorkflowSidebar
            effectiveSource={effectiveSource}
            selectedSourceTables={selectedSourceTables}
            destinationReady={destinationReady}
            targetConnection={targetConnection}
            targetSchema={targetSchema}
            reviewReady={reviewReady}
            canExecute={canExecute}
            selectSection={selectSection}
            activeSection={activeSection}
          />

          <main className="flex min-h-0 flex-col bg-[hsl(var(--wb-editor))]">
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-5">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">
                  Transfer{" "}
                  {initialSourceScope === "table"
                    ? "table"
                    : initialSourceScope}{" "}
                  data
                </div>
                <p className="mt-0.5 truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
                  {displayEndpoint(effectiveSource)} →{" "}
                  {targetTableMode === "new"
                    ? "new target table"
                    : "existing target table"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-[3px] px-1.5 py-0.5 text-[9px] ${hasCurrentReview ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]" : "bg-[hsl(var(--wb-hover))] text-[hsl(var(--wb-text-muted))]"}`}
              >
                {hasCurrentReview ? "Reviewed" : "Draft"}
              </span>
            </div>

            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
              <TransferSetupSection
                setupSectionRef={setupSectionRef}
                initialSourceScope={initialSourceScope}
                sourceSchemas={sourceSchemas}
                activeSourceSchema={activeSourceSchema}
                setActiveSourceSchema={setActiveSourceSchema}
                setSourceTables={setSourceTables}
                setSelectedSourceTables={setSelectedSourceTables}
                setSourceTransferObjects={setSourceTransferObjects}
                setSelectedTransferObjectKeys={setSelectedTransferObjectKeys}
                resetTransferReview={resetTransferReview}
                setError={setError}
                isSubmitting={isSubmitting}
                sourceTables={sourceTables}
                selectedSourceTables={selectedSourceTables}
                toggleSourceTable={toggleSourceTable}
                selectedTransferObjects={selectedTransferObjects}
                isSourceObjectsLoading={isSourceObjectsLoading}
                sourceTransferObjectGroups={sourceTransferObjectGroups}
                selectedTransferObjectKeys={selectedTransferObjectKeys}
                toggleTransferObject={toggleTransferObject}
                targetConnectionId={targetConnectionId}
                setTargetConnectionId={setTargetConnectionId}
                eligibleTargetConnections={eligibleTargetConnections}
                sourceSupportsTransfer={sourceSupportsTransfer}
                source={source}
                targetSupportsCatalogs={targetSupportsCatalogs}
                targetDatabase={targetDatabase}
                setTargetDatabase={setTargetDatabase}
                isDatabasesLoading={isDatabasesLoading}
                databases={databases}
                targetSchema={targetSchema}
                setTargetSchema={setTargetSchema}
                isSchemasLoading={isSchemasLoading}
                schemas={schemas}
                targetTableMode={targetTableMode}
                handleTargetTableModeChange={handleTargetTableModeChange}
                isTablesLoading={isTablesLoading}
                isBatchTransfer={isBatchTransfer}
                targetSupportsGeneratedTable={targetSupportsGeneratedTable}
                targetTable={targetTable}
                setTargetTable={setTargetTable}
                tables={tables}
                setTargetPlan={setTargetPlan}
                setTargetPlanPreviewKey={setTargetPlanPreviewKey}
                setTargetPlanConfirmation={setTargetPlanConfirmation}
                mode={mode}
                handleModeChange={handleModeChange}
                targetDistribution={targetDistribution}
                canConfigureTargetColumnQuoting={
                  canConfigureTargetColumnQuoting
                }
                quoteTargetColumnNames={quoteTargetColumnNames}
                setQuoteTargetColumnNames={setQuoteTargetColumnNames}
                maxRows={maxRows}
                setMaxRows={setMaxRows}
                batchSize={batchSize}
                setBatchSize={setBatchSize}
                targetConnection={targetConnection}
                reseedIdentity={reseedIdentity}
                setReseedIdentity={setReseedIdentity}
                canRestoreSourceSchemaObjects={canRestoreSourceSchemaObjects}
                restoreSourceSchemaObjects={restoreSourceSchemaObjects}
                setRestoreSourceSchemaObjects={setRestoreSourceSchemaObjects}
                effectiveSource={effectiveSource}
              />

              <TransferReviewSection
                reviewSectionRef={reviewSectionRef}
                hasCurrentReview={hasCurrentReview}
                recentReports={recentReports}
                targetTableMode={targetTableMode}
                effectiveSource={effectiveSource}
                isSubmitting={isSubmitting}
                handleRetryReport={handleRetryReport}
                targetPlan={targetPlan}
                handlePreviewTarget={handlePreviewTarget}
                targetPlanRequest={targetPlanRequest}
                targetSchema={targetSchema}
                targetTable={targetTable}
                targetPlanPreviewKey={targetPlanPreviewKey}
                targetPlanRequestKey={targetPlanRequestKey}
                targetPlanConfirmation={targetPlanConfirmation}
                setTargetPlanConfirmation={setTargetPlanConfirmation}
                handleCreateTarget={handleCreateTarget}
                isCreatingTarget={isCreatingTarget}
                isBatchTransfer={isBatchTransfer}
                batchPlan={batchPlan}
                batchPlanIsCurrent={batchPlanIsCurrent}
                progress={progress}
                confirmation={confirmation}
                setConfirmation={setConfirmation}
                preview={preview}
                planIsCurrent={planIsCurrent}
                mode={mode}
              />
            </div>
          </main>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 border-t border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.08)] px-4 py-2 text-[10px] text-[hsl(var(--destructive))]"
          >
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <DialogFooter className="flex-row items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-5 py-3">
          <p className="hidden text-[10px] wb-muted sm:block">
            {hasCurrentReview
              ? "Settings are locked to this one-time review token."
              : "Preview is read-only and does not write rows."}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={
                isExecuting ? () => void handleCancelTransfer() : onClose
              }
              disabled={(isSubmitting && !isExecuting) || isCancelling}
            >
              {isExecuting
                ? isCancelling
                  ? "Cancelling…"
                  : "Cancel transfer"
                : "Cancel"}
            </Button>
            {targetTableMode === "new" &&
            !isBatchTransfer ? null : !(isBatchTransfer
                ? batchPlan
                : preview) ? (
              <Button
                type="button"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => void handlePreview()}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  "Preview transfer"
                )}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => void handleTransfer()}
                disabled={!canExecute}
              >
                {isSubmitting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : isBatchTransfer ? (
                  "Transfer selected items"
                ) : mode === "overwrite" ? (
                  "Replace target rows"
                ) : mode === "upsert" ? (
                  "Upsert rows"
                ) : (
                  "Append rows"
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
