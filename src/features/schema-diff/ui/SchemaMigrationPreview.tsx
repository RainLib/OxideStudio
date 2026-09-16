import {
  conversionFeatureLabels,
  formatMigrationStatus,
} from "@/features/schema-diff/model/migrationPresentation";
import { isDescriptorOnlySchemaObjectChange } from "@/features/schema-diff/model/schemaChangePolicy";
import { MigrationRunLog } from "@/features/schema-diff/ui/MigrationRunLog";
import { PreviewSwitch } from "@/features/schema-diff/ui/PreviewSwitch";
import { cn } from "@/lib/utils";
import type {
  SchemaChange,
  SchemaConversionIssue,
  SchemaDiffPlan,
  SchemaMigrationJournalEntry,
} from "@/services/tauri/types/schemaDiff";
import {
  Code2,
  GitCompareArrows,
  History,
  ListChecks,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";

interface SchemaMigrationPreviewContext {
  normalizedPlanDriver: string | null;
  previewSurface: "migration" | "preflight" | "rollback" | "run";
  setPreviewSurface: React.Dispatch<
    React.SetStateAction<"migration" | "preflight" | "rollback" | "run">
  >;
  plan: SchemaDiffPlan;
  currentJournal: SchemaMigrationJournalEntry | null;
  isTargetOwnedPlan: boolean;
  conversionIssues: SchemaConversionIssue[];
  selectedChange: SchemaChange | undefined;
  recentExecutions: SchemaMigrationJournalEntry[];
  setExecution: React.Dispatch<
    React.SetStateAction<SchemaMigrationJournalEntry | null>
  >;
  sqlLines: string[];
}

export function SchemaMigrationPreview({
  normalizedPlanDriver,
  previewSurface,
  setPreviewSurface,
  plan,
  currentJournal,
  isTargetOwnedPlan,
  conversionIssues,
  selectedChange,
  recentExecutions,
  setExecution,
  sqlLines,
}: SchemaMigrationPreviewContext) {
  return (
    <main className="flex min-h-0 min-w-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.62)] px-3 text-[10px]">
        <span className="flex items-center gap-1 rounded-[4px] bg-[hsl(var(--wb-panel-raised)/0.55)] p-0.5">
          <PreviewSwitch
            active={previewSurface === "migration"}
            label="Migration"
            icon={Code2}
            onClick={() => setPreviewSurface("migration")}
          />
          <PreviewSwitch
            active={previewSurface === "preflight"}
            label={`Preflight ${plan.preflightChecks.length}`}
            icon={ListChecks}
            onClick={() => setPreviewSurface("preflight")}
          />
          {currentJournal && (
            <PreviewSwitch
              active={previewSurface === "run"}
              label="Run log"
              icon={History}
              onClick={() => setPreviewSurface("run")}
            />
          )}
          {currentJournal?.rollback.available &&
            currentJournal.rollback.sql && (
              <PreviewSwitch
                active={previewSurface === "rollback"}
                label={`Rollback ${currentJournal.rollback.changeCount}`}
                icon={RotateCcw}
                onClick={() => setPreviewSurface("rollback")}
              />
            )}
        </span>
        <span className="flex items-center gap-1.5 wb-muted">
          {previewSurface === "preflight"
            ? "Read-only validation queries"
            : previewSurface === "run"
              ? currentJournal
                ? formatMigrationStatus(currentJournal.status)
                : "No execution journal"
              : previewSurface === "rollback"
                ? currentJournal?.rollback.requiresManualReview
                  ? "Generated reverse plan · manual review required"
                  : "Generated reverse plan · review before use"
                : isTargetOwnedPlan
                  ? plan.transactional
                    ? "Verified target-owned plan · opaque transactional session"
                    : "Verified target-owned plan · partial apply possible"
                  : plan.transactional && normalizedPlanDriver === "postgres"
                    ? "PostgreSQL · ROLLBACK guard"
                    : plan.transactional && normalizedPlanDriver === "sqlite"
                      ? "SQLite · verified backup + atomic rebuild"
                      : normalizedPlanDriver === "mysql"
                        ? "MySQL family · DDL may auto-commit"
                        : "Metadata comparison · apply is unavailable"}
        </span>
      </div>

      {conversionIssues.length > 0 && (
        <details className="group shrink-0 border-b border-sky-400/20 bg-sky-400/5 text-[9px]">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sky-200 marker:hidden">
            <GitCompareArrows size={11} />
            <span className="font-medium">
              {conversionIssues.length} structured conversion issue
              {conversionIssues.length === 1 ? "" : "s"}
            </span>
            <span className="ml-auto text-sky-200/65 group-open:hidden">
              Expand details
            </span>
            <span className="ml-auto hidden text-sky-200/65 group-open:inline">
              Collapse mappings
            </span>
          </summary>
          <div className="max-h-40 overflow-auto border-t border-sky-400/15">
            {conversionIssues.map((issue, index) => (
              <div
                key={`${issue.relationName}:${issue.columnName}:${index}`}
                className="grid grid-cols-[minmax(120px,0.65fr)_minmax(160px,0.8fr)_minmax(260px,1.5fr)] gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="mb-1 inline-flex rounded-[3px] border border-sky-300/20 px-1 py-0.5 text-[7px] text-sky-200/75">
                    {conversionFeatureLabels[issue.featureKind || "type"]}
                  </span>
                  <span className="block truncate font-mono text-sky-100">
                    {issue.relationName === "*"
                      ? "All captured columns"
                      : `${issue.relationName}.${issue.columnName}`}
                  </span>
                </span>
                <span className="truncate font-mono text-sky-200/75">
                  {issue.sourceDataType} → {issue.targetDataType || "unmapped"}
                </span>
                <span
                  className={cn(
                    "min-w-0",
                    issue.compatibility === "unsupported"
                      ? "text-red-300"
                      : issue.compatibility === "review"
                        ? "text-amber-300"
                        : "text-emerald-300",
                  )}
                  title={[issue.reason, issue.remediation]
                    .filter(Boolean)
                    .join("\n")}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate">{issue.reason}</span>
                    {issue.blocksAutomaticConversion && (
                      <span className="shrink-0 rounded-[3px] border border-red-400/25 px-1 py-0.5 text-[7px] uppercase tracking-wide text-red-300">
                        blocks DDL
                      </span>
                    )}
                  </span>
                  {issue.remediation && (
                    <span className="mt-0.5 block truncate text-[8px] text-[hsl(var(--wb-text-muted))]">
                      Resolve: {issue.remediation}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {selectedChange && isDescriptorOnlySchemaObjectChange(selectedChange) && (
        <section
          className="shrink-0 border-b border-sky-400/20 bg-sky-400/[0.045] px-3 py-2 text-[9px] leading-4 text-sky-100/90"
          data-schema-object-review-detail
        >
          <div className="flex items-center gap-1.5 font-medium text-sky-200">
            <ShieldAlert size={11} /> Schema object review required
          </div>
          <p className="mt-1">
            {selectedChange.objectType || "Schema object"}{" "}
            <span className="font-mono">{selectedChange.relationName}</span> has
            descriptor metadata only. No source definition or executable DDL is
            available, so it is not emitted in this migration preview or
            eligible for automatic apply.
          </p>
        </section>
      )}

      {plan.warnings.length > 0 && (
        <div className="shrink-0 border-b border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[9px] text-amber-200">
          <div className="flex items-center gap-1.5 font-medium">
            <ShieldAlert size={11} /> {plan.warnings.length} capture or
            generation warning{plan.warnings.length === 1 ? "" : "s"}
          </div>
          <div className="mt-1 line-clamp-2 leading-4 text-amber-200/75">
            {plan.warnings.join(" · ")}
          </div>
        </div>
      )}

      {previewSurface === "run" ? (
        <MigrationRunLog
          current={currentJournal}
          entries={recentExecutions}
          onSelect={(entry) => {
            setExecution(entry);
            setPreviewSurface("run");
          }}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto font-mono text-[10px] leading-5">
          <table className="w-full border-collapse">
            <tbody>
              {sqlLines.map((line, index) => (
                <tr
                  key={index}
                  className="hover:bg-[hsl(var(--wb-hover)/0.45)]"
                >
                  <td className="w-12 select-none border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.35)] px-2 text-right align-top text-[hsl(var(--wb-text-muted)/0.52)]">
                    {index + 1}
                  </td>
                  <td
                    className={cn(
                      "whitespace-pre px-3 align-top",
                      line.startsWith("-- WARNING")
                        ? "text-amber-300"
                        : line.startsWith("-- BLOCKED") ||
                            line.startsWith("-- PLAN BLOCKED")
                          ? "text-red-300"
                          : line.startsWith("--")
                            ? "text-[hsl(var(--wb-text-muted))]"
                            : "text-[hsl(var(--wb-text))]",
                    )}
                  >
                    {line || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
