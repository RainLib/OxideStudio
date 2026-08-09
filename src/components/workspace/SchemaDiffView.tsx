import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clipboard,
  Code2,
  GitCompareArrows,
  History,
  ListChecks,
  Loader2,
  OctagonX,
  Play,
  RotateCcw,
  ShieldAlert,
  TerminalSquare,
  X,
} from "lucide-react";
import { requestDatabaseObjectReveal } from "@/lib/databaseNavigation";
import { normalizeDatabaseDriverName } from "@/lib/databaseDialect";
import { cn } from "@/lib/utils";
import { isProjectDdlSnapshot } from "@/features/schema-diff/model/projectDdlSnapshot";
import { isSchemaDbmlSnapshot } from "@/features/schema-diff/model/schemaDbmlImport";
import { isChartDbMetadataSnapshot } from "@/features/schema-diff/model/chartDbMetadataImport";
import { isSchemaDiagramDraftSnapshot } from "@/features/schema-diff/model/schemaDiagramDraft";
import { schemaService } from "@/services/tauri/schema.service";
import type {
  SchemaChange,
  SchemaChangeRisk,
  SchemaMigrationJournalEntry,
  SchemaMigrationStatus,
} from "@/services/tauri/types";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useTabStore } from "@/store/useTabStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";

const riskStyle: Record<SchemaChangeRisk, { rail: string; text: string; label: string }> = {
  safe: {
    rail: "bg-emerald-400",
    text: "text-emerald-300",
    label: "Safe",
  },
  review: {
    rail: "bg-amber-400",
    text: "text-amber-300",
    label: "Review",
  },
  destructive: {
    rail: "bg-red-400",
    text: "text-red-300",
    label: "Destructive",
  },
};

export function SchemaDiffView() {
  const {
    tabs,
    activeTabId,
    createTab,
    selectSchemaDiffChange,
  } = useTabStore();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection);
  const setActiveToolWindow = useWorkbenchLayoutStore(
    (state) => state.setActiveToolWindow,
  );
  const [copied, setCopied] = useState(false);
  const [previewSurface, setPreviewSurface] = useState<
    "migration" | "preflight" | "rollback" | "run"
  >("migration");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationTarget, setConfirmationTarget] = useState("");
  const [allowReview, setAllowReview] = useState(false);
  const [allowDestructive, setAllowDestructive] = useState(false);
  const [allowNonTransactional, setAllowNonTransactional] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [execution, setExecution] = useState<SchemaMigrationJournalEntry | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [recentExecutions, setRecentExecutions] = useState<SchemaMigrationJournalEntry[]>([]);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const plan = activeTab?.schemaDiffPlan;
  const source = activeTab?.schemaDiffSource;
  const target = activeTab?.schemaDiffTarget;
  const previewSql = previewSurface === "migration"
    ? plan?.migrationSql || ""
    : previewSurface === "preflight"
      ? plan?.preflightSql || ""
      : previewSurface === "rollback"
        ? execution?.rollback.sql || recentExecutions[0]?.rollback.sql || ""
        : "";
  const sqlLines = useMemo(() => previewSql.split("\n"), [previewSql]);

  useEffect(() => {
    if (!plan) return;
    let active = true;
    void schemaService
      .listSchemaMigrationJournal(activeProjectId, plan.targetConnectionId, 12)
      .then((entries) => {
        if (active) setRecentExecutions(entries);
      })
      .catch(() => {
        if (active) setRecentExecutions([]);
      });
    return () => {
      active = false;
    };
  }, [activeProjectId, plan?.id, plan?.targetConnectionId]);

  useEffect(() => {
    setConfirmationOpen(false);
    setConfirmationTarget("");
    setAllowReview(false);
    setAllowDestructive(false);
    setAllowNonTransactional(false);
    setExecution(null);
    setExecutionError(null);
    setPreviewSurface("migration");
  }, [plan?.id]);

  if (!activeTab || activeTab.type !== "schema_diff" || !plan || !source || !target) {
    return null;
  }

  const selectedChange = plan.changes.find(
    (change) => change.id === activeTab.selectedSchemaChangeId,
  );
  const requiresReview = plan.changes.some(
    (change) => change.manualReview || change.risk === "review",
  );
  const reviewChangeCount = plan.changes.filter(
    (change) => change.manualReview || change.risk === "review",
  ).length;
  const requiresDestructive = plan.changes.some(
    (change) => change.risk === "destructive" || !change.reversible,
  );
  const destructiveChangeCount = plan.changes.filter(
    (change) => change.risk === "destructive" || !change.reversible,
  ).length;
  const conversionIssues = plan.conversionIssues || [];
  // The backend resolves aliases (for example `mariadb`) through the dialect
  // registry before it executes a migration. Mirror that decision here so the
  // confirmation surface cannot hide a reviewed, executable family plan.
  const normalizedPlanDriver = normalizeDatabaseDriverName(plan.driver);
  const isNonTransactionalPlan =
    normalizedPlanDriver === "mysql" && !plan.transactional;
  const isOfflineProjectDdlSource = isProjectDdlSnapshot(source);
  const isOfflineDbmlSource = isSchemaDbmlSnapshot(source);
  const isOfflineMetadataSource = isChartDbMetadataSnapshot(source);
  const isOfflineDiagramDraftSource = isSchemaDiagramDraftSnapshot(source);
  const isOfflineSource =
    isOfflineProjectDdlSource ||
    isOfflineDbmlSource ||
    isOfflineMetadataSource ||
    isOfflineDiagramDraftSource;
  const offlineSourceLabel = isOfflineDiagramDraftSource
    ? "Diagram draft"
    : isOfflineDbmlSource
    ? "DBML"
    : isOfflineMetadataSource
      ? "Metadata JSON"
      : "Project DDL";
  const supportsSafeApply =
    !isOfflineSource &&
    ((normalizedPlanDriver === "postgres" && plan.transactional) ||
      isNonTransactionalPlan);
  const currentJournal = execution || recentExecutions[0] || null;
  const requiredConfirmationTarget = [
    target.connectionName,
    plan.targetDatabaseName || null,
    plan.targetSchemaName,
  ].filter(Boolean).join(" / ");
  const confirmationReady =
    confirmationTarget.trim() === requiredConfirmationTarget &&
    (!requiresReview || allowReview) &&
    (!requiresDestructive || allowDestructive) &&
    (!isNonTransactionalPlan || allowNonTransactional);

  const copySql = async () => {
    if (!previewSql) return;
    await navigator.clipboard.writeText(previewSql);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const openInConsole = () => {
    if (!previewSql || previewSurface === "run" || isOfflineSource) return;
    const surfaceName = previewSurface === "migration"
      ? "migration"
      : previewSurface === "preflight"
        ? "preflight"
        : "rollback";
    createTab(
      "query",
      `${surfaceName} [${plan.targetSchemaName}]`,
      previewSql,
      {
        connectionId: plan.targetConnectionId,
        databaseName: plan.targetDatabaseName || undefined,
        schemaName: plan.targetSchemaName,
      },
    );
    setActiveToolWindow("editor");
  };

  const applyMigration = async () => {
    if (!confirmationReady || !supportsSafeApply || isApplying) return;
    setIsApplying(true);
    setExecutionError(null);
    try {
      const connectionError = await setActiveConnection(plan.targetConnectionId);
      if (connectionError) throw new Error(connectionError);
      const entry = await schemaService.executeSchemaMigration({
        source,
        expectedTarget: target,
        expectedPlanId: plan.id,
        expectedTargetFingerprint: target.fingerprint,
        confirmationTarget: confirmationTarget.trim(),
        allowReview,
        allowDestructive,
        allowNonTransactional,
      });
      setExecution(entry);
      setRecentExecutions((entries) => [
        entry,
        ...entries.filter((candidate) => candidate.id !== entry.id),
      ].slice(0, 12));
      setConfirmationOpen(false);
      setPreviewSurface("run");
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApplying(false);
    }
  };

  const revealChange = async (change: SchemaChange) => {
    selectSchemaDiffChange(activeTab.id, change.id);
    if (change.kind === "relationCreate") {
      setActiveToolWindow("editor");
      return;
    }
    const connectionError = await setActiveConnection(plan.targetConnectionId);
    if (connectionError) return;
    setActiveToolWindow("databaseExplorer");
    requestDatabaseObjectReveal({
      projectId: activeProjectId,
      connectionId: plan.targetConnectionId,
      databaseName: plan.targetDatabaseName || undefined,
      schemaName: change.schemaName,
      objectType: change.objectType || undefined,
      objectName: change.relationName,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--wb-editor))] text-[hsl(var(--wb-text))]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
            <GitCompareArrows size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[12px] font-semibold">
              <span className="truncate">{target.connectionName}</span>
              <span className="font-normal wb-muted">/</span>
              <span className="truncate font-mono">{plan.targetSchemaName}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[9px] wb-muted">
              <span>Make live target match snapshot</span>
              <span>·</span>
              <span>{formatTimestamp(source.capturedAt)}</span>
              <span>·</span>
              <span className="font-mono">{source.fingerprint.slice(0, 10)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="wb-text-button h-7 gap-1.5 px-2.5 text-[10px]"
            onClick={() => void copySql()}
            disabled={!previewSql || previewSurface === "run"}
          >
            {copied ? <Check size={12} /> : <Clipboard size={12} />}
            {copied
              ? "Copied"
              : previewSurface === "preflight"
                ? "Copy checks"
                : previewSurface === "rollback"
                  ? "Copy rollback"
                  : "Copy SQL"}
          </button>
          <button
            type="button"
            className="wb-text-button h-7 gap-1.5 px-2.5 text-[10px]"
            onClick={openInConsole}
            title={
              isOfflineSource
                ? `${offlineSourceLabel} review artifacts cannot open a runnable console.`
                : previewSurface === "migration" && plan.summary.blocked > 0
                ? "Resolve blocked changes before opening a runnable migration console"
                : undefined
            }
            disabled={
              isOfflineSource ||
              (previewSurface === "run" || previewSurface === "rollback"
                ? !previewSql
                : previewSurface === "migration"
                ? plan.changes.length === 0 || plan.summary.blocked > 0
                : plan.preflightChecks.length === 0)
            }
          >
            <TerminalSquare size={12} />
            Open in console
          </button>
          <button
            type="button"
            className="wb-primary-button h-7 gap-1.5 px-2.5 text-[10px]"
            onClick={() => {
              setExecutionError(null);
              setConfirmationOpen(true);
            }}
            disabled={
              isApplying ||
              !supportsSafeApply ||
              plan.changes.length === 0 ||
              plan.summary.blocked > 0
            }
            title={
              !supportsSafeApply
                ? isOfflineSource
                  ? `${offlineSourceLabel} baselines are review-only. Capture a live snapshot before applying a migration.`
                  : "Automatic apply is available for PostgreSQL transactions and explicitly acknowledged MySQL DDL"
                : plan.summary.blocked > 0
                  ? "Resolve blocked changes before applying"
                  : isNonTransactionalPlan
                    ? "Refresh the live target, run preflight, apply each reviewed statement, then verify"
                    : "Refresh the live target, run preflight, apply atomically, then verify"
            }
          >
            {isApplying ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {isApplying ? "Applying…" : isNonTransactionalPlan ? "Apply reviewed plan" : "Apply safely"}
          </button>
        </div>
      </header>

      {isOfflineSource && (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-400/20 bg-amber-400/[0.045] px-4 py-2 text-[9px] text-amber-100/90">
          <AlertTriangle size={12} className="shrink-0 text-amber-300" />
          {offlineSourceLabel} baselines can be compared and reviewed, but cannot be applied. Capture a live baseline before creating an executable migration.
        </div>
      )}

      {confirmationOpen && (
        <section className="shrink-0 border-b border-amber-400/25 bg-amber-400/[0.045] px-4 py-3">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-200">
                <ShieldAlert size={13} /> Confirm {isNonTransactionalPlan ? "non-transactional" : "transactional"} migration
              </div>
              <p className="mt-1 max-w-3xl text-[9px] leading-4 wb-muted">
                {isNonTransactionalPlan
                  ? `OxideStudio will recapture the live target and reject stale plans, run every generated preflight check, then execute ${plan.changes.flatMap((change) => change.sql).length} reviewed MySQL statement(s) one at a time. MySQL can auto-commit DDL, so a failed run may leave earlier statements applied; the journal and post-verification show the exact outcome.`
                  : `OxideStudio will recapture the live target and reject stale plans, run every generated preflight check, commit all ${plan.changes.flatMap((change) => change.sql).length} statement(s) in one PostgreSQL transaction, then recapture and compare the schema again.`}
              </p>
            </div>
            <button
              type="button"
              className="wb-icon-button h-6 w-6 shrink-0"
              onClick={() => setConfirmationOpen(false)}
              aria-label="Close migration confirmation"
            >
              <X size={12} />
            </button>
          </div>
          <div className="mt-2.5 flex flex-wrap items-end gap-x-4 gap-y-2">
            <label className="text-[9px] wb-muted">
              Type exact target <span className="font-mono text-[hsl(var(--wb-text))]">{requiredConfirmationTarget}</span>
              <input
                type="text"
                value={confirmationTarget}
                onChange={(event) => setConfirmationTarget(event.target.value)}
                className="mt-1 block h-7 w-72 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[10px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent)/0.65)]"
                autoComplete="off"
                spellCheck={false}
                disabled={isApplying}
              />
            </label>
            {requiresReview && (
              <label className="flex h-7 items-center gap-2 text-[9px] text-amber-100/85">
                <input
                  type="checkbox"
                  checked={allowReview}
                  onChange={(event) => setAllowReview(event.target.checked)}
                  disabled={isApplying}
                  className="accent-[hsl(var(--wb-accent))]"
                />
                I reviewed {reviewChangeCount} manual-review change(s)
              </label>
            )}
            {requiresDestructive && (
              <label className="flex h-7 items-center gap-2 text-[9px] text-red-200/90">
                <input
                  type="checkbox"
                  checked={allowDestructive}
                  onChange={(event) => setAllowDestructive(event.target.checked)}
                  disabled={isApplying}
                  className="accent-red-400"
                />
                I approve {destructiveChangeCount} destructive/non-reversible change(s)
              </label>
            )}
            {isNonTransactionalPlan && (
              <label className="flex h-7 items-center gap-2 text-[9px] text-amber-100/90">
                <input
                  type="checkbox"
                  checked={allowNonTransactional}
                  onChange={(event) => setAllowNonTransactional(event.target.checked)}
                  disabled={isApplying}
                  className="accent-amber-400"
                />
                I understand MySQL DDL can partially commit before a failure
              </label>
            )}
            <button
              type="button"
              className="wb-primary-button h-7 gap-1.5 px-3 text-[10px]"
              disabled={!confirmationReady || isApplying}
              onClick={() => void applyMigration()}
            >
              {isApplying ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              Run preflight & apply
            </button>
          </div>
          {executionError && (
            <div className="mt-2 flex items-start gap-1.5 text-[9px] leading-4 text-red-300">
              <OctagonX size={11} className="mt-0.5 shrink-0" /> {executionError}
            </div>
          )}
        </section>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[330px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]">
          <div className="grid grid-cols-4 border-b border-[hsl(var(--wb-border-subtle))]">
            <RiskMetric label="Safe" value={plan.summary.safe} risk="safe" />
            <RiskMetric label="Review" value={plan.summary.review} risk="review" />
            <RiskMetric
              label="Destructive"
              value={plan.summary.destructive}
              risk="destructive"
            />
            <BlockedMetric value={plan.summary.blocked} />
          </div>

          <div className="flex h-8 shrink-0 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-3 text-[10px]">
            <span className="font-medium">Migration rail</span>
            <span className="wb-muted">{plan.summary.total} changes</span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            {plan.changes.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-5 text-center">
                <CheckCircle2 size={22} className="mb-2 text-emerald-400" />
                <div className="text-[11px] font-medium">Schemas match</div>
                <div className="mt-1 text-[9px] leading-4 wb-muted">
                  The live target has the same captured structure as this snapshot.
                </div>
              </div>
            ) : (
              plan.changes.map((change) => {
                const style = riskStyle[change.risk];
                const selected = selectedChange?.id === change.id;
                return (
                  <button
                    key={change.id}
                    type="button"
                    className={cn(
                      "group relative mb-1 flex w-full overflow-hidden rounded-[4px] border text-left transition-colors",
                      selected
                        ? "border-[hsl(var(--wb-accent)/0.46)] bg-[hsl(var(--wb-active-strong))]"
                        : "border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.42)] hover:bg-[hsl(var(--wb-hover))]",
                    )}
                    onClick={() => void revealChange(change)}
                  >
                    <span className={cn("w-1 shrink-0", style.rail)} />
                    <span className="min-w-0 flex-1 px-2.5 py-2">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[10px]">
                          {change.relationName}
                          {change.childName ? `.${change.childName}` : ""}
                        </span>
                        <span className={cn("shrink-0 text-[8px] uppercase tracking-wide", style.text)}>
                          {style.label}
                        </span>
                      </span>
                      <span className="mt-1 block text-[9px] leading-4 wb-muted">
                        Step {change.order} · {formatPhase(change.phase)}
                      </span>
                      <span className="mt-0.5 block text-[9px] leading-4 wb-muted">
                        {change.summary}
                      </span>
                      {(change.blockedReason || change.manualReview || !change.reversible) && (
                        <span className="mt-1.5 flex items-center gap-1 text-[8px] text-amber-300/90">
                          <AlertTriangle size={9} />
                          {change.blockedReason
                            ? `Blocked · ${change.blockedReason}`
                            : change.reversible
                              ? "Manual review"
                              : "Not automatically reversible"}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

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
              {currentJournal?.rollback.available && currentJournal.rollback.sql && (
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
                : plan.transactional && normalizedPlanDriver === "postgres"
                  ? "PostgreSQL · ROLLBACK guard"
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
                  {conversionIssues.length} structured type conversion review
                  {conversionIssues.length === 1 ? "" : "s"}
                </span>
                <span className="ml-auto text-sky-200/65 group-open:hidden">
                  Expand mappings
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
                    <span className="truncate font-mono text-sky-100">
                      {issue.relationName === "*"
                        ? "All captured columns"
                        : `${issue.relationName}.${issue.columnName}`}
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
                      title={[issue.reason, issue.remediation].filter(Boolean).join("\n")}
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

          {plan.warnings.length > 0 && (
            <div className="shrink-0 border-b border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[9px] text-amber-200">
              <div className="flex items-center gap-1.5 font-medium">
                <ShieldAlert size={11} /> {plan.warnings.length} capture or generation warning{plan.warnings.length === 1 ? "" : "s"}
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
                    <tr key={index} className="hover:bg-[hsl(var(--wb-hover)/0.45)]">
                      <td className="w-12 select-none border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.35)] px-2 text-right align-top text-[hsl(var(--wb-text-muted)/0.52)]">
                        {index + 1}
                      </td>
                      <td className={cn(
                        "whitespace-pre px-3 align-top",
                        line.startsWith("-- WARNING")
                          ? "text-amber-300"
                          : line.startsWith("-- BLOCKED") || line.startsWith("-- PLAN BLOCKED")
                            ? "text-red-300"
                          : line.startsWith("--")
                            ? "text-[hsl(var(--wb-text-muted))]"
                            : "text-[hsl(var(--wb-text))]",
                      )}>
                        {line || " "}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function MigrationRunLog({
  current,
  entries,
  onSelect,
}: {
  current: SchemaMigrationJournalEntry | null;
  entries: SchemaMigrationJournalEntry[];
  onSelect: (entry: SchemaMigrationJournalEntry) => void;
}) {
  if (!current) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[10px] wb-muted">
        No migration execution has been recorded for this connection.
      </div>
    );
  }
  const preflightPassed = current.preflightResults.filter(
    (result) => result.status === "passed",
  ).length;
  const preflightWarnings = current.preflightResults.filter(
    (result) => result.status === "warning",
  ).length;
  const preflightBlocked = current.preflightResults.filter(
    (result) => result.blocksExecution,
  ).length;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-h-0 overflow-auto">
        <div className="flex items-start justify-between border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "rounded-[3px] border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em]",
                migrationStatusStyle(current.status),
              )}>
                {formatMigrationStatus(current.status)}
              </span>
              <span className="font-mono text-[10px]">{current.schemaName}</span>
            </div>
            <div className="mt-1.5 font-mono text-[8px] wb-muted">
              {current.id} · {formatTimestamp(current.startedAt)}
            </div>
          </div>
          <div className="text-right text-[9px] wb-muted">
            <div>{current.committedStatements}/{current.statementCount} committed</div>
            <div className="mt-1 font-mono">{current.targetFingerprintBefore.slice(0, 12)}</div>
          </div>
        </div>

        {current.error && (
          <div className="flex items-start gap-2 border-b border-red-400/20 bg-red-400/5 px-4 py-2.5 text-[9px] leading-4 text-red-200">
            <OctagonX size={12} className="mt-0.5 shrink-0" /> {current.error}
          </div>
        )}

        <div className="grid grid-cols-4 border-b border-[hsl(var(--wb-border-subtle))]">
          <RunStage
            label="Freshness"
            detail="Fingerprint matched"
            state="passed"
          />
          <RunStage
            label="Preflight"
            detail={`${preflightPassed} pass · ${preflightWarnings} warn`}
            state={preflightBlocked > 0 ? "failed" : "passed"}
          />
          <RunStage
            label="Atomic apply"
            detail={`${current.committedStatements}/${current.statementCount} committed`}
            state={
              current.committedStatements === current.statementCount && current.statementCount > 0
                ? "passed"
                : current.status === "blocked"
                  ? "skipped"
                  : "failed"
            }
          />
          <RunStage
            label="Post-verify"
            detail={
              current.verification?.matchesSource
                ? "Schemas match"
                : current.verification
                  ? `${current.verification.remainingSummary.total} remaining`
                  : "Not completed"
            }
            state={
              current.verification?.matchesSource
                ? "passed"
                : current.verification
                  ? "failed"
                  : "skipped"
            }
          />
        </div>

        <div className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-2 text-[9px] font-medium">
          Preflight results
        </div>
        {current.preflightResults.length === 0 ? (
          <div className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3 text-[9px] wb-muted">
            This plan had no generated data preflight checks.
          </div>
        ) : (
          current.preflightResults.map((result) => (
            <div
              key={result.checkId}
              className="grid grid-cols-[80px_minmax(0,1fr)_180px] items-start border-b border-[hsl(var(--wb-border-subtle))] px-4 py-2 text-[9px]"
            >
              <span className={cn(
                "w-fit rounded-[3px] border px-1.5 py-0.5 text-[8px] uppercase tracking-wide",
                result.status === "passed"
                  ? "border-emerald-400/25 text-emerald-300"
                  : result.status === "warning"
                    ? "border-amber-400/25 text-amber-300"
                    : "border-red-400/25 text-red-300",
              )}>
                {result.status}
              </span>
              <span className="min-w-0 pr-4">
                <span className="block text-[hsl(var(--wb-text))]">{result.label}</span>
                <span className="mt-0.5 block leading-4 wb-muted">
                  {result.error || result.expectation}
                </span>
              </span>
              <span className="font-mono text-[8px] wb-muted">{result.observed}</span>
            </div>
          ))
        )}

        <div className="px-4 py-3 text-[9px]">
          <div className="flex items-center gap-2 font-medium">
            <RotateCcw size={11} /> Rollback package
          </div>
          <div className="mt-1 leading-4 wb-muted">
            {current.rollback.available
              ? `${current.rollback.changeCount} reverse change(s) generated${current.rollback.requiresManualReview ? "; manual review is required" : ""}. The artifact remains a ROLLBACK-guarded preview until opened explicitly.`
              : current.rollback.reason || "No rollback package is available."}
          </div>
        </div>
      </div>

      <aside className="min-h-0 overflow-auto border-l border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel)/0.55)]">
        <div className="sticky top-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-2 text-[9px] font-medium">
          Recent journal
        </div>
        {entries.length === 0 ? (
          <div className="px-3 py-3 text-[9px] wb-muted">No persisted entries.</div>
        ) : (
          entries.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={cn(
                "w-full border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-left hover:bg-[hsl(var(--wb-hover))]",
                current.id === entry.id && "bg-[hsl(var(--wb-active-strong))]",
              )}
              onClick={() => onSelect(entry)}
            >
              <span className="flex items-center justify-between gap-2 text-[9px]">
                <span className="truncate font-mono">{entry.schemaName}</span>
                <span className={cn("shrink-0 text-[8px]", statusTextStyle(entry.status))}>
                  {formatMigrationStatus(entry.status)}
                </span>
              </span>
              <span className="mt-1 block text-[8px] wb-muted">
                {formatTimestamp(entry.startedAt)} · {entry.committedStatements}/{entry.statementCount}
              </span>
            </button>
          ))
        )}
      </aside>
    </div>
  );
}

function RunStage({
  label,
  detail,
  state,
}: {
  label: string;
  detail: string;
  state: "passed" | "failed" | "skipped";
}) {
  return (
    <div className="border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2.5 last:border-r-0">
      <div className={cn(
        "text-[9px] font-medium",
        state === "passed"
          ? "text-emerald-300"
          : state === "failed"
            ? "text-red-300"
            : "wb-muted",
      )}>
        {state === "passed" ? "✓" : state === "failed" ? "×" : "—"} {label}
      </div>
      <div className="mt-1 text-[8px] wb-muted">{detail}</div>
    </div>
  );
}

function formatMigrationStatus(status: SchemaMigrationStatus) {
  switch (status) {
    case "verificationFailed":
      return "Verification failed";
    case "succeeded":
      return "Succeeded";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Rolled back";
    case "running":
      return "Running";
    case "interrupted":
      return "Interrupted — recapture required";
  }
}

function migrationStatusStyle(status: SchemaMigrationStatus) {
  if (status === "succeeded") return "border-emerald-400/25 text-emerald-300";
  if (status === "running") return "border-sky-400/25 text-sky-300";
  if (status === "interrupted") return "border-red-400/25 text-red-300";
  if (status === "blocked") return "border-amber-400/25 text-amber-300";
  return "border-red-400/25 text-red-300";
}

function statusTextStyle(status: SchemaMigrationStatus) {
  if (status === "succeeded") return "text-emerald-300";
  if (status === "running") return "text-sky-300";
  if (status === "interrupted") return "text-red-300";
  if (status === "blocked") return "text-amber-300";
  return "text-red-300";
}

function RiskMetric({
  label,
  value,
  risk,
}: {
  label: string;
  value: number;
  risk: SchemaChangeRisk;
}) {
  const style = riskStyle[risk];
  return (
    <div className="border-r border-[hsl(var(--wb-border-subtle))] px-2 py-2 last:border-r-0">
      <div className={cn("font-mono text-[15px] font-semibold leading-none", style.text)}>
        {value}
      </div>
      <div className="mt-1 text-[8px] uppercase tracking-[0.12em] wb-muted">{label}</div>
    </div>
  );
}

function BlockedMetric({ value }: { value: number }) {
  return (
    <div className="border-r border-[hsl(var(--wb-border-subtle))] px-2 py-2 last:border-r-0">
      <div className="flex items-center gap-1 font-mono text-[15px] font-semibold leading-none text-red-300">
        <OctagonX size={11} /> {value}
      </div>
      <div className="mt-1 text-[8px] uppercase tracking-[0.12em] wb-muted">Blocked</div>
    </div>
  );
}

function PreviewSwitch({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: typeof Code2;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-5 items-center gap-1 rounded-[3px] px-2 text-[9px] transition-colors",
        active
          ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
          : "wb-muted hover:text-[hsl(var(--wb-text))]",
      )}
      onClick={onClick}
    >
      <Icon size={10} />
      {label}
    </button>
  );
}

function formatPhase(phase: SchemaChange["phase"]) {
  return phase.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
