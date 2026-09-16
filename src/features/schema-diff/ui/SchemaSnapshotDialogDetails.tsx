import {
  AlertCircle,
  Check,
  ClipboardCopy,
  FileCode2,
  Loader2,
  Upload,
} from "lucide-react";
import type { SchemaSnapshotIdentity } from "@/services/schemaSnapshotStore";
import { schemaComparisonPhaseLabel } from "@/features/schema-diff/model/schemaComparisonProgress";
import {
  ALL_PROJECT_DDL_SOURCES,
  formatSchemaSnapshotTimestamp,
} from "@/features/schema-diff/model/schemaSnapshotDialog";
import type { SchemaSnapshotDialogController } from "@/features/schema-diff/hooks/useSchemaSnapshotDialog";

interface SchemaSnapshotDialogDetailsProps {
  identity: SchemaSnapshotIdentity;
  controller: SchemaSnapshotDialogController;
}

export function SchemaSnapshotDialogDetails({
  identity,
  controller,
}: SchemaSnapshotDialogDetailsProps) {
  const {
    busy,
    comparisonProgress,
    copiedMetadataQuery,
    copyMetadataQuery,
    dbmlInputRef,
    ddlInputRef,
    error,
    importDbml,
    importDdl,
    importMetadataJson,
    importProjectDdl,
    importSource,
    metadataInputRef,
    metadataQuery,
    nextComparisonProgress,
    operation,
    projectDdlDocuments,
    selected,
    selectedIsDbml,
    selectedIsMetadata,
    selectedIsOffline,
    selectedProjectDdlPath,
    selectedProjectDdlSources,
    setSelectedProjectDdlPath,
    supportsRestorePlan,
    supportsSchemaReviewPlan,
  } = controller;

  return (
    <section className="flex min-h-0 flex-col overflow-y-auto bg-[hsl(var(--wb-editor))] p-4">
            <div className="text-[11px] font-medium">Comparison direction</div>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] items-center gap-2">
              <TargetCard
                eyebrow="Desired source"
                title={
                  selected
                    ? `Snapshot ${formatSchemaSnapshotTimestamp(selected.capturedAt)}`
                    : "Select a snapshot"
                }
                detail={
                  selected
                    ? selected.fingerprint.slice(0, 12)
                    : "No baseline selected"
                }
              />
              <div className="text-center text-[16px] text-[hsl(var(--wb-accent))]">
                →
              </div>
              <TargetCard
                eyebrow="Actual target"
                title="Fresh live capture"
                detail={`${identity.connectionName} / ${identity.schemaName}`}
              />
            </div>

            <div className="mt-4 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.4)] p-3 text-[9px] leading-4 wb-muted">
              {selectedIsOffline
                ? `This baseline is inferred from bounded ${selectedIsDbml ? "DBML" : selectedIsMetadata ? "metadata JSON" : "SQL DDL"}. It can reveal drift and generate a review diff, but cannot be applied automatically.`
                : supportsRestorePlan
                  ? "The generated plan describes how to make the live target match the selected snapshot. It opens as a read-only artifact first. OxideStudio does not execute migration SQL from this dialog."
                  : identity?.driver === "sqlite"
                    ? "SQLite differences generate a reviewed replacement-table plan. Complete existing-table rebuilds can be applied from the plan view through a verified recovery backup, one write-locked transaction, and a foreign-key check; incomplete, create/drop, or view changes remain blocked."
                    : "Document and search snapshots preserve collection or index fields and indexes for drift review and diagrams. Restore plans remain disabled because these stores require driver-specific migration commands."}
            </div>

            <div className="mt-3 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.32)] p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-medium">
                <FileCode2 size={12} className="text-[hsl(var(--wb-accent))]" />
                SQL DDL baseline
              </div>
              <p className="mt-1 text-[9px] leading-4 wb-muted">
                Detects PostgreSQL, MySQL, SQL Server, SQLite, and Oracle
                syntax, then parses a bounded CREATE TABLE / INDEX subset.
                Results stay review-only until the source contract is fully
                validated.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <select
                  aria-label="Project DDL source"
                  value={selectedProjectDdlPath}
                  onChange={(event) =>
                    setSelectedProjectDdlPath(event.target.value)
                  }
                  disabled={busy || projectDdlDocuments.length === 0}
                  className="h-7 min-w-0 flex-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[10px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent)/0.65)] disabled:opacity-50"
                >
                  {projectDdlDocuments.length === 0 ? (
                    <option value="">No project SQL files available</option>
                  ) : (
                    <>
                      <option value={ALL_PROJECT_DDL_SOURCES}>
                        All eligible project SQL files (
                        {projectDdlDocuments.length})
                      </option>
                      {projectDdlDocuments.map((document) => (
                        <option
                          key={document.relativePath}
                          value={document.relativePath}
                        >
                          {document.relativePath}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                <button
                  type="button"
                  className="wb-text-button h-7 shrink-0 gap-1.5 px-2.5 text-[10px]"
                  disabled={busy || !selectedProjectDdlPath}
                  onClick={() => void importProjectDdl()}
                >
                  {importSource === "project" ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <FileCode2 size={11} />
                  )}
                  Create baseline
                </button>
              </div>
              <div className="mt-2 border-t border-[hsl(var(--wb-border-subtle))] pt-2">
                <input
                  ref={ddlInputRef}
                  type="file"
                  accept=".sql,text/sql,text/plain"
                  className="hidden"
                  onChange={(event) =>
                    void importDdl(event.currentTarget.files?.[0])
                  }
                />
                <input
                  ref={dbmlInputRef}
                  type="file"
                  accept=".dbml,text/plain"
                  className="hidden"
                  onChange={(event) =>
                    void importDbml(event.currentTarget.files?.[0])
                  }
                />
                <input
                  ref={metadataInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(event) =>
                    void importMetadataJson(event.currentTarget.files?.[0])
                  }
                />
                <p className="text-[9px] leading-4 wb-muted">
                  Import an external DDL, DBML, or ChartDB-compatible metadata
                  file. Use the target-scoped read-only query when metadata was
                  captured outside OxideStudio.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className="wb-text-button h-7 shrink-0 gap-1.5 px-2.5 text-[10px]"
                    disabled={busy}
                    onClick={() => ddlInputRef.current?.click()}
                    title="Import a SQL DDL file as a review-only baseline"
                  >
                    {importSource === "ddl" ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <FileCode2 size={11} />
                    )}
                    Import DDL
                  </button>
                  <button
                    type="button"
                    className="wb-text-button h-7 shrink-0 gap-1.5 px-2.5 text-[10px]"
                    disabled={busy}
                    onClick={() => dbmlInputRef.current?.click()}
                  >
                    {importSource === "dbml" ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Upload size={11} />
                    )}
                    Import DBML
                  </button>
                  <button
                    type="button"
                    className="wb-text-button h-7 shrink-0 gap-1.5 px-2.5 text-[10px]"
                    disabled={busy || !metadataQuery}
                    onClick={() => void copyMetadataQuery()}
                    title={
                      metadataQuery
                        ? `${metadataQuery.dialectLabel}: ${metadataQuery.note}`
                        : `No ChartDB-compatible metadata query is registered for ${identity.driver}`
                    }
                  >
                    {copiedMetadataQuery ? (
                      <Check size={11} />
                    ) : (
                      <ClipboardCopy size={11} />
                    )}
                    {copiedMetadataQuery ? "Query copied" : "Copy query"}
                  </button>
                  <button
                    type="button"
                    className="wb-text-button h-7 shrink-0 gap-1.5 px-2.5 text-[10px]"
                    disabled={busy}
                    onClick={() => metadataInputRef.current?.click()}
                    title="Import ChartDB metadata-query JSON as a review-only baseline"
                  >
                    {importSource === "metadata" ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Upload size={11} />
                    )}
                    Metadata JSON
                  </button>
                </div>
              </div>
            </div>

            {selected && (
              <div className="mt-4 grid grid-cols-[120px_minmax(0,1fr)] gap-y-2 text-[10px]">
                <span className="wb-muted">Captured</span>
                <span>{formatSchemaSnapshotTimestamp(selected.capturedAt)}</span>
                {selectedIsOffline && (
                  <>
                    <span className="wb-muted">Source mode</span>
                    <span>
                      {selectedIsDbml
                        ? "DBML"
                        : selectedIsMetadata
                          ? "Metadata JSON"
                          : "SQL DDL"}{" "}
                      · review-only
                    </span>
                    <span className="wb-muted">Source files</span>
                    <span
                      className="truncate font-mono text-[9px]"
                      title={
                        selectedIsDbml || selectedIsMetadata
                          ? selected.warnings
                              .find((warning) => warning.startsWith("Source: "))
                              ?.slice(8)
                          : selectedProjectDdlSources.join("\n")
                      }
                    >
                      {selectedIsDbml || selectedIsMetadata
                        ? selected.warnings
                            .find((warning) => warning.startsWith("Source: "))
                            ?.slice(8) ||
                          (selectedIsDbml
                            ? "Imported DBML"
                            : "Imported metadata JSON")
                        : selectedProjectDdlSources.length === 1
                          ? selectedProjectDdlSources[0] || "Project SQL"
                          : `${selectedProjectDdlSources.length} bounded project SQL files`}
                    </span>
                  </>
                )}
                <span className="wb-muted">
                  {supportsSchemaReviewPlan ? "Relations" : "Objects"}
                </span>
                <span>{selected.relations.length.toLocaleString()}</span>
                <span className="wb-muted">Driver</span>
                <span>{selected.driver}</span>
                <span className="wb-muted">Fingerprint</span>
                <span className="break-all font-mono text-[9px]">
                  {selected.fingerprint}
                </span>
              </div>
            )}

            {error && (
              <div
                className="mt-auto flex items-start gap-2 rounded-[4px] border border-red-400/20 bg-red-400/5 px-2.5 py-2 text-[10px] text-red-300"
                role="alert"
              >
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {operation === "compare" && comparisonProgress && (
              <div
                className="mt-auto flex items-center gap-2 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.6)] px-2.5 py-2 text-[10px]"
                role="status"
                data-schema-comparison-progress={comparisonProgress}
              >
                <Loader2 size={12} className="shrink-0 animate-spin text-[hsl(var(--wb-accent))]" />
                <span>{schemaComparisonPhaseLabel(comparisonProgress)}</span>
                {nextComparisonProgress && (
                  <span className="ml-auto whitespace-nowrap wb-muted">
                    Next: {schemaComparisonPhaseLabel(nextComparisonProgress)}
                  </span>
                )}
              </div>
            )}
          </section>
  );
}

function TargetCard({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.46)] px-3 py-3">
      <div className="text-[8px] uppercase tracking-[0.13em] wb-muted">
        {eyebrow}
      </div>
      <div className="mt-1.5 truncate text-[10px] font-medium" title={title}>
        {title}
      </div>
      <div
        className="mt-1 truncate font-mono text-[8px] wb-muted"
        title={detail}
      >
        {detail}
      </div>
    </div>
  );
}
