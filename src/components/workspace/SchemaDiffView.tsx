import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clipboard,
  Code2,
  GitCompareArrows,
  ListChecks,
  OctagonX,
  ShieldAlert,
  TerminalSquare,
} from "lucide-react";
import { requestDatabaseObjectReveal } from "@/lib/databaseNavigation";
import { cn } from "@/lib/utils";
import type { SchemaChange, SchemaChangeRisk } from "@/services/tauri/types";
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
  const [previewSurface, setPreviewSurface] = useState<"migration" | "preflight">(
    "migration",
  );
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const plan = activeTab?.schemaDiffPlan;
  const source = activeTab?.schemaDiffSource;
  const target = activeTab?.schemaDiffTarget;
  const previewSql = previewSurface === "migration"
    ? plan?.migrationSql || ""
    : plan?.preflightSql || "";
  const sqlLines = useMemo(() => previewSql.split("\n"), [previewSql]);

  if (!activeTab || activeTab.type !== "schema_diff" || !plan || !source || !target) {
    return null;
  }

  const selectedChange = plan.changes.find(
    (change) => change.id === activeTab.selectedSchemaChangeId,
  );

  const copySql = async () => {
    await navigator.clipboard.writeText(previewSql);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const openInConsole = () => {
    createTab(
      "query",
      `${previewSurface === "migration" ? "migration" : "preflight"} [${plan.targetSchemaName}]`,
      previewSql,
      {
        connectionId: plan.targetConnectionId,
        databaseName: plan.targetDatabaseName || undefined,
        schemaName: plan.targetSchemaName,
      },
    );
    setActiveToolWindow("editor");
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
          >
            {copied ? <Check size={12} /> : <Clipboard size={12} />}
            {copied ? "Copied" : `Copy ${previewSurface === "migration" ? "SQL" : "checks"}`}
          </button>
          <button
            type="button"
            className="wb-primary-button h-7 gap-1.5 px-2.5 text-[10px]"
            onClick={openInConsole}
            title={
              previewSurface === "migration" && plan.summary.blocked > 0
                ? "Resolve blocked changes before opening a runnable migration console"
                : undefined
            }
            disabled={
              previewSurface === "migration"
                ? plan.changes.length === 0 || plan.summary.blocked > 0
                : plan.preflightChecks.length === 0
            }
          >
            <TerminalSquare size={12} />
            Open in console
          </button>
        </div>
      </header>

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
            </span>
            <span className="flex items-center gap-1.5 wb-muted">
              {previewSurface === "preflight"
                ? "Read-only validation queries"
                : plan.transactional
                  ? "PostgreSQL · ROLLBACK guard"
                  : "MySQL · DDL may auto-commit"}
            </span>
          </div>

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
        </main>
      </div>
    </div>
  );
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
