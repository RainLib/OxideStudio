import { Button } from "@/components/ui/button";
import { canRetryTableDataTransferReport } from "@/features/database-explorer/model/tableDataTransferRetry";
import { transferCompatibilityClass } from "@/features/table-transfer/model/transferPolicy";
import { fieldClass } from "@/features/table-transfer/ui/transferStyles";
import { FilePlus2, Loader2 } from "lucide-react";

interface TransferReviewSectionContext {
  reviewSectionRef: React.RefObject<HTMLElement | null>;
  hasCurrentReview: boolean;
  recentReports: import("@/services/tauri/types").TableDataTransferReport[];
  targetTableMode: "existing" | "new";
  effectiveSource: {
    schema: string;
    table: string;
    connectionId: string;
    driver: import("@/services/tauri/types").DatabaseDriver;
    database?: string | undefined;
  };
  isSubmitting: boolean;
  handleRetryReport: (
    report: import("@/services/tauri/types").TableDataTransferReport,
  ) => void;
  targetPlan:
    | import("@/services/tauri/types").TableDataTransferTargetPlan
    | null;
  handlePreviewTarget: () => Promise<void>;
  targetPlanRequest:
    | import("@/services/tauri/types").TableDataTransferTargetPlanRequest
    | null;
  targetSchema: string;
  targetTable: string;
  targetPlanPreviewKey: string;
  targetPlanRequestKey: string;
  targetPlanConfirmation: string;
  setTargetPlanConfirmation: React.Dispatch<React.SetStateAction<string>>;
  handleCreateTarget: () => Promise<void>;
  isCreatingTarget: boolean;
  isBatchTransfer: boolean;
  batchPlan: import("@/services/tauri/types").TableDataTransferBatchPlan | null;
  batchPlanIsCurrent: boolean;
  progress: import("@/services/tauri/types").TableDataTransferProgress | null;
  confirmation: string;
  setConfirmation: React.Dispatch<React.SetStateAction<string>>;
  preview: import("@/services/tauri/types").TableDataTransferPreview | null;
  planIsCurrent: boolean;
  mode: import("@/services/tauri/types").TableDataTransferMode;
}

export function TransferReviewSection({
  reviewSectionRef,
  hasCurrentReview,
  recentReports,
  targetTableMode,
  effectiveSource,
  isSubmitting,
  handleRetryReport,
  targetPlan,
  handlePreviewTarget,
  targetPlanRequest,
  targetSchema,
  targetTable,
  targetPlanPreviewKey,
  targetPlanRequestKey,
  targetPlanConfirmation,
  setTargetPlanConfirmation,
  handleCreateTarget,
  isCreatingTarget,
  isBatchTransfer,
  batchPlan,
  batchPlanIsCurrent,
  progress,
  confirmation,
  setConfirmation,
  preview,
  planIsCurrent,
  mode,
}: TransferReviewSectionContext) {
  return (
    <section
      ref={reviewSectionRef}
      className="min-w-0 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-5 py-4"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium">Review & confirm</div>
          <p className="mt-0.5 text-[10px] wb-muted">
            Inspect the generated mapping before a single row is written.
          </p>
        </div>
        {hasCurrentReview && (
          <span className="shrink-0 rounded-[3px] bg-[hsl(var(--wb-active-strong))] px-1.5 py-0.5 text-[9px] text-[hsl(var(--wb-accent))]">
            Ready for confirmation
          </span>
        )}
      </div>
      {recentReports.length > 0 && targetTableMode === "existing" && (
        <div className="mb-3 space-y-1 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 text-[10px]">
          <p className="font-medium wb-muted">Recent target transfer history</p>
          {recentReports.map((report) => {
            const retryable = canRetryTableDataTransferReport(
              report,
              effectiveSource,
            );
            return (
              <div
                key={report.id}
                className="flex items-center justify-between gap-2 leading-4"
              >
                <span
                  className="min-w-0 truncate wb-muted"
                  title={`${report.source.schema}.${report.source.table} → ${report.rowsTransferred.toLocaleString()} rows${report.targetRowsBefore != null ? ` · target baseline ${report.targetRowsBefore.toLocaleString()} rows` : ""}`}
                >
                  {report.status} · {report.source.schema}.{report.source.table}{" "}
                  · {report.rowsTransferred.toLocaleString()} rows
                  {report.targetRowsBefore != null
                    ? ` · baseline ${report.targetRowsBefore.toLocaleString()}`
                    : ""}
                </span>
                {report.verification && (
                  <span
                    className={
                      report.verification.status === "verified" ||
                      (report.verification.status === "notAvailable" &&
                        report.verification.identityReseedVerified === true)
                        ? "shrink-0 text-[hsl(var(--wb-success))]"
                        : report.verification.status === "needsReview"
                          ? "shrink-0 text-[hsl(var(--wb-warning))]"
                          : "shrink-0 wb-muted"
                    }
                    title={report.verification.message}
                  >
                    {report.verification.identityReseedVerified === false
                      ? "review generator"
                      : report.verification.status === "needsReview"
                        ? "review count"
                        : report.verification.status === "verified"
                          ? "verified"
                          : report.verification.identityReseedVerified === true
                            ? "generator verified"
                            : "count n/a"}
                  </span>
                )}
                {report.retryPolicy === "manualReviewRequired" && (
                  <span
                    className="shrink-0 text-[hsl(var(--wb-warning))]"
                    title={
                      report.postCommitReceipt?.message ||
                      "Inspect the target manually before starting another transfer."
                    }
                  >
                    manual review
                  </span>
                )}
                {retryable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-1.5 text-[10px]"
                    disabled={isSubmitting}
                    onClick={() => handleRetryReport(report)}
                  >
                    Retry setup
                  </Button>
                )}
              </div>
            );
          })}
          <p className="leading-4 wb-muted">
            Retry setup always requires a fresh preview and confirmation.
          </p>
        </div>
      )}
      {targetTableMode === "new" ? (
        !targetPlan ? (
          <div className="space-y-3 text-[10px]">
            <p className="leading-4 wb-muted">
              Generate a target-dialect CREATE TABLE plan from the source
              metadata. No DDL runs during preview.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[10px]"
              onClick={handlePreviewTarget}
              disabled={
                isSubmitting ||
                !targetPlanRequest ||
                !targetSchema.trim() ||
                !targetTable.trim()
              }
            >
              {isSubmitting ? (
                <Loader2 size={12} className="mr-1.5 animate-spin" />
              ) : (
                <FilePlus2 size={12} className="mr-1.5" />
              )}
              Review create table
            </Button>
          </div>
        ) : (
          <div className="space-y-3 text-[10px]">
            <div className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2">
              <div className="mb-1 flex items-center justify-between gap-2 font-medium">
                <span>{targetPlan.columns.length} mapped column(s)</span>
                <code className="truncate text-[9px] wb-muted">
                  {targetPlan.mappingProfile}
                </code>
              </div>
              <div className="max-h-36 overflow-auto font-mono leading-5 wb-muted">
                {targetPlan.columns.map((column) => (
                  <div
                    key={column.name}
                    className="border-b border-[hsl(var(--wb-border-subtle))] py-1 last:border-b-0"
                    title={column.reason}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {column.name}: {column.sourceDataType || "unknown"} →{" "}
                        {column.targetDataType}
                        {column.targetLength ? `(${column.targetLength})` : ""}
                      </span>
                      <span
                        className={transferCompatibilityClass(
                          column.compatibility,
                        )}
                      >
                        {column.compatibility}
                      </span>
                    </div>
                    <div className="truncate text-[9px] wb-muted">
                      {column.isPrimaryKey ? "primary key · " : ""}
                      {column.isNotNull ? "not null · " : "nullable · "}
                      {column.identityRetained
                        ? `new target identity${
                            column.targetIdentityGeneration === "always"
                              ? " (always)"
                              : column.targetIdentityGeneration === "byDefault"
                                ? " (by default)"
                                : ""
                          } · `
                        : column.sourceAutoIncrement
                          ? "identity materialized · "
                          : ""}
                      {column.hasSourceDefault
                        ? column.defaultRetained
                          ? "default retained · "
                          : "default omitted · "
                        : ""}
                      {column.reason}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {targetPlan.canExecute ? (
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 font-mono leading-4 text-[hsl(var(--wb-text-muted))]">
                {targetPlan.statements.join("\n\n")}
              </pre>
            ) : (
              <p className="rounded-[4px] border border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.08)] p-2 leading-4 text-[hsl(var(--destructive))]">
                Target-table creation is blocked. At least one source type has
                no explicit mapping in this profile, so no executable DDL was
                generated.
              </p>
            )}
            {targetPlan.warnings.map((warning) => (
              <p key={warning} className="leading-4 wb-muted">
                {warning}
              </p>
            ))}
            {targetPlanPreviewKey !== targetPlanRequestKey && (
              <p className="leading-4 text-[hsl(var(--wb-warning))]">
                The target definition changed after preview. Review it again.
              </p>
            )}
            {targetPlan.canExecute && (
              <>
                <label className="block space-y-1">
                  <span className="text-[10px] wb-muted">
                    Type{" "}
                    <code className="select-all text-[hsl(var(--wb-text))]">
                      {targetPlan.confirmationToken}
                    </code>{" "}
                    to create this empty table
                  </span>
                  <input
                    className={fieldClass}
                    value={targetPlanConfirmation}
                    onChange={(event) =>
                      setTargetPlanConfirmation(event.target.value)
                    }
                    autoComplete="off"
                    spellCheck={false}
                    disabled={
                      isSubmitting ||
                      targetPlanPreviewKey !== targetPlanRequestKey
                    }
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-[10px]"
                  onClick={handleCreateTarget}
                  disabled={
                    isSubmitting ||
                    targetPlanPreviewKey !== targetPlanRequestKey ||
                    targetPlanConfirmation.trim() !==
                      targetPlan.confirmationToken
                  }
                >
                  {isCreatingTarget && (
                    <Loader2 size={12} className="mr-1.5 animate-spin" />
                  )}
                  Create empty target table
                </Button>
              </>
            )}
          </div>
        )
      ) : isBatchTransfer ? (
        !batchPlan ? (
          <p className="text-[10px] leading-4 wb-muted">
            Batch preview reads every selected source/target definition, derives
            a parent-first foreign-key order, and binds every mapping into one
            confirmation token. No rows are written during preview.
          </p>
        ) : (
          <div className="space-y-3 text-[10px]">
            <div className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2">
              <div className="mb-1 font-medium">
                {batchPlan.orderedTables.length} table(s) in dependency order
              </div>
              <div className="max-h-40 space-y-1 overflow-auto font-mono leading-4 wb-muted">
                {batchPlan.orderedTables.map((table) => {
                  const preflight = batchPlan.tablePreflights.find(
                    (item) => item.table === table,
                  );
                  const generatorPlans = preflight?.identityReseedPlans || [];
                  const schemaStatements =
                    preflight?.schemaRestoreStatements || [];
                  return (
                    <div
                      key={table}
                      className="space-y-1 border-b border-[hsl(var(--wb-border-subtle))] py-1 last:border-b-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{table}</span>
                        <span
                          className={
                            preflight?.canExecute
                              ? "text-[hsl(var(--wb-success))]"
                              : "text-[hsl(var(--destructive))]"
                          }
                        >
                          {preflight?.canExecute
                            ? `${preflight.mappedColumns} mapped${generatorPlans.length > 0 ? ` · ${generatorPlans.length} generator(s)` : ""}`
                            : "blocked"}
                        </span>
                      </div>
                      {generatorPlans.map((generator) => (
                        <div
                          key={`${generator.column}:${generator.sequenceSchema}:${generator.sequenceName}`}
                          className="truncate pl-2 text-[9px] wb-muted"
                          title={`${generator.ownerSchema}.${generator.ownerTable}.${generator.ownerColumn}`}
                        >
                          {generator.column} → {generator.sequenceSchema}.
                          {generator.sequenceName}
                          {` · last ${generator.currentValue ?? "unavailable"} · target max ${generator.targetMaxValue ?? "empty"}`}
                        </div>
                      ))}
                      {schemaStatements.length > 0 && (
                        <details className="pl-2 text-[9px] wb-muted">
                          <summary className="cursor-pointer select-none">
                            Restore {schemaStatements.length} index/constraint
                            statement(s)
                          </summary>
                          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded-[3px] bg-[hsl(var(--wb-panel))] p-1.5">
                            {schemaStatements.join("\n\n")}
                          </pre>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {(batchPlan.objectPreflights?.length || 0) > 0 && (
              <div
                className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2"
                data-transfer-object-review
              >
                <div className="mb-1 font-medium">
                  {batchPlan.objectPreflights?.length} schema object(s)
                </div>
                <div className="custom-scrollbar max-h-56 space-y-1 overflow-auto font-mono leading-4">
                  {batchPlan.objectPreflights?.map((object) => (
                    <div
                      key={`${object.objectType}:${object.parentName || ""}:${object.name}`}
                      className="border-b border-[hsl(var(--wb-border-subtle))] py-1.5 last:border-b-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {object.objectType.replace(/_/g, " ")} ·{" "}
                          {object.parentName ? `${object.parentName}.` : ""}
                          {object.name}
                        </span>
                        <span
                          className={
                            object.action === "create"
                              ? "text-[hsl(var(--wb-success))]"
                              : object.action === "skipExisting"
                                ? "wb-muted"
                                : "text-[hsl(var(--destructive))]"
                          }
                        >
                          {object.action === "skipExisting"
                            ? "skip existing"
                            : object.action}
                        </span>
                      </div>
                      {object.dependsOn.length > 0 && (
                        <div className="truncate text-[9px] wb-muted">
                          depends on {object.dependsOn.join(", ")}
                        </div>
                      )}
                      {object.statements.length > 0 && (
                        <details className="mt-1 text-[9px] wb-muted">
                          <summary className="cursor-pointer select-none">
                            Review {object.statements.length} DDL statement(s)
                          </summary>
                          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded-[3px] bg-[hsl(var(--wb-panel))] p-1.5">
                            {object.statements.join("\n\n")}
                          </pre>
                        </details>
                      )}
                      {object.warnings.map((warning) => (
                        <div
                          key={warning}
                          className={
                            object.canExecute
                              ? "text-[9px] wb-muted"
                              : "text-[9px] text-[hsl(var(--destructive))]"
                          }
                        >
                          {warning}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {batchPlan.cyclicTables.length > 0 && (
              <p className="leading-4 text-[hsl(var(--destructive))]">
                Foreign-key cycle: {batchPlan.cyclicTables.join(", ")}. This
                target driver has no reviewed deferred-constraints policy.
              </p>
            )}
            {!batchPlan.canExecute && (
              <p className="leading-4 text-[hsl(var(--destructive))]">
                At least one selected table has no executable source-to-target
                mapping. Correct the target schema and preview again.
              </p>
            )}
            {!batchPlanIsCurrent && (
              <p className="leading-4 text-[hsl(var(--wb-warning))]">
                Batch settings changed after preview. Review the current plan
                again.
              </p>
            )}
            {batchPlan.warnings.map((warning) => (
              <p key={warning} className="leading-4 wb-muted">
                {warning}
              </p>
            ))}
            {progress && (
              <div className="space-y-1 border-t border-[hsl(var(--wb-border-subtle))] pt-2">
                <div className="flex items-center justify-between wb-muted">
                  <span>
                    {progress.status === "running"
                      ? "Transferring selected tables"
                      : progress.status === "done"
                        ? "Batch transfer complete"
                        : progress.status === "cancelled"
                          ? "Batch transfer cancelled"
                          : "Batch transfer failed"}
                  </span>
                  <span>
                    {progress.rowsTransferred.toLocaleString()} rows ·{" "}
                    {progress.batches} batch(es)
                  </span>
                </div>
                <div
                  className="h-1 overflow-hidden rounded-full bg-[hsl(var(--wb-border-subtle))]"
                  role="progressbar"
                  aria-label="Batch table data transfer progress"
                  aria-valuemin={0}
                  aria-valuemax={progress.maxRows}
                  aria-valuenow={Math.min(
                    progress.rowsTransferred,
                    progress.maxRows,
                  )}
                >
                  <div
                    className="h-full bg-[hsl(var(--wb-accent))] transition-[width] duration-150"
                    style={{
                      width: `${progress.status === "done" ? 100 : Math.min(100, (progress.rowsTransferred / Math.max(1, progress.maxRows)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
            <label className="block space-y-1">
              <span className="text-[10px] wb-muted">
                Type{" "}
                <code className="select-all text-[hsl(var(--wb-text))]">
                  {batchPlan.confirmationToken}
                </code>{" "}
                to execute one atomic batch transaction
              </span>
              <input
                className={fieldClass}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={
                  isSubmitting || !batchPlan.canExecute || !batchPlanIsCurrent
                }
              />
            </label>
          </div>
        )
      ) : !preview ? (
        <p className="text-[10px] leading-4 wb-muted">
          Preview reads both table definitions, checks required columns, and
          creates a one-time confirmation for this exact plan.
        </p>
      ) : (
        <div className="space-y-3 text-[10px]">
          <div className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2">
            <div className="mb-1 font-medium">
              {preview.previewRows} sample row(s) · limit{" "}
              {preview.maxRows.toLocaleString()}
              {preview.targetRowsToDelete != null
                ? ` · deletes ${preview.targetRowsToDelete.toLocaleString()} target row(s)`
                : preview.targetRowsBefore != null
                  ? ` · target baseline ${preview.targetRowsBefore.toLocaleString()} row(s)`
                  : ""}
              {preview.upsertKeyColumns.length > 0
                ? ` · conflict key ${preview.upsertKeyColumns.join(", ")}`
                : ""}
              {preview.identityReseedColumns.length > 0
                ? ` · synchronizes ${preview.identityReseedColumns.join(", ")}`
                : ""}
            </div>
            <div className="max-h-40 overflow-auto font-mono leading-5 wb-muted">
              {preview.mappedColumns.map((mapping) => (
                <div
                  key={`${mapping.source}:${mapping.target}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 border-b border-[hsl(var(--wb-border-subtle))] py-1 last:border-b-0"
                  title={mapping.reason}
                >
                  <span className="min-w-0 truncate">
                    {mapping.source}{" "}
                    <span className="wb-muted">
                      ({mapping.sourceDataType || "unknown"})
                    </span>
                    {" → "}
                    {mapping.target}{" "}
                    <span className="wb-muted">
                      ({mapping.targetDataType || mapping.dataType || "unknown"}
                      )
                    </span>
                  </span>
                  <span
                    className={transferCompatibilityClass(
                      mapping.compatibility,
                    )}
                  >
                    {mapping.compatibility}
                  </span>
                  <span className="col-span-2 truncate text-[9px] wb-muted">
                    {mapping.conversion === "none"
                      ? "No conversion"
                      : mapping.conversion
                          .replace(/([A-Z])/g, " $1")
                          .toLowerCase()}
                    {" · "}
                    {mapping.reason}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {(preview.identityReseedPlans?.length || 0) > 0 && (
            <div className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2">
              <div className="mb-1 font-medium">PostgreSQL generator plan</div>
              <div className="space-y-1 font-mono leading-4 wb-muted">
                {preview.identityReseedPlans?.map((generator) => (
                  <div
                    key={`${generator.column}:${generator.sequenceSchema}:${generator.sequenceName}`}
                    className="border-b border-[hsl(var(--wb-border-subtle))] py-1 last:border-b-0"
                  >
                    <div>
                      {generator.column} → {generator.sequenceSchema}.
                      {generator.sequenceName}
                    </div>
                    <div className="text-[9px]">
                      owner {generator.ownerSchema}.{generator.ownerTable}.
                      {generator.ownerColumn}
                      {` · current ${generator.currentValue ?? "unavailable"} · target max ${generator.targetMaxValue ?? "empty"}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(preview.schemaRestoreStatements?.length || 0) > 0 && (
            <details className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2">
              <summary className="cursor-pointer select-none font-medium">
                Restore {preview.schemaRestoreStatements?.length}{" "}
                index/constraint statement(s) after copy
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono leading-4 wb-muted">
                {preview.schemaRestoreStatements?.join("\n\n")}
              </pre>
            </details>
          )}
          {!preview.canExecute && (
            <p className="leading-4 text-[hsl(var(--destructive))]">
              This plan contains an unsupported type conversion. Change the
              target column type and preview again.
            </p>
          )}
          {!planIsCurrent && (
            <p className="leading-4 text-[hsl(var(--wb-warning))]">
              Transfer settings changed after preview. Preview the current plan
              again.
            </p>
          )}
          {progress && (
            <div className="space-y-1 border-t border-[hsl(var(--wb-border-subtle))] pt-2">
              <div className="flex items-center justify-between wb-muted">
                <span>
                  {progress.status === "running"
                    ? "Transferring"
                    : progress.status === "done"
                      ? "Transfer complete"
                      : progress.status === "cancelled"
                        ? "Transfer cancelled"
                        : "Transfer failed"}
                </span>
                <span>
                  {progress.rowsTransferred.toLocaleString()} rows ·{" "}
                  {progress.batches} batch(es) · limit{" "}
                  {progress.maxRows.toLocaleString()}
                </span>
              </div>
              <div
                className="h-1 overflow-hidden rounded-full bg-[hsl(var(--wb-border-subtle))]"
                role="progressbar"
                aria-label="Table data transfer progress"
                aria-valuemin={0}
                aria-valuemax={progress.maxRows}
                aria-valuenow={Math.min(
                  progress.rowsTransferred,
                  progress.maxRows,
                )}
              >
                <div
                  className="h-full bg-[hsl(var(--wb-accent))] transition-[width] duration-150"
                  style={{
                    width: `${progress.status === "done" ? 100 : Math.min(100, (progress.rowsTransferred / Math.max(1, progress.maxRows)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
          {preview.warnings.map((warning) => (
            <p key={warning} className="leading-4 wb-muted">
              {warning}
            </p>
          ))}
          <label className="block space-y-1">
            <span className="text-[10px] wb-muted">
              Type{" "}
              <code className="select-all text-[hsl(var(--wb-text))]">
                {preview.confirmationToken}
              </code>{" "}
              to{" "}
              {mode === "overwrite"
                ? "replace target rows"
                : mode === "upsert"
                  ? "upsert rows by primary key"
                  : "append rows"}
            </span>
            <input
              className={fieldClass}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={isSubmitting || !preview.canExecute || !planIsCurrent}
            />
          </label>
        </div>
      )}
    </section>
  );
}
