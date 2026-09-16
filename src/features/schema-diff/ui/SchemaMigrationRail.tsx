import {
  formatPhase,
  riskStyle,
} from "@/features/schema-diff/model/migrationPresentation";
import {
  BlockedMetric,
  RiskMetric,
} from "@/features/schema-diff/ui/MigrationRiskMetrics";
import { cn } from "@/lib/utils";
import type {
  SchemaChange,
  SchemaDiffPlan,
} from "@/services/tauri/types/schemaDiff";
import { AlertTriangle, CheckCircle2, ListChecks } from "lucide-react";

interface SchemaMigrationRailContext {
  plan: SchemaDiffPlan;
  selectedChange: SchemaChange | undefined;
  revealChange: (change: SchemaChange) => Promise<void>;
}

export function SchemaMigrationRail({
  plan,
  selectedChange,
  revealChange,
}: SchemaMigrationRailContext) {
  return (
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
            {plan.summary.total > 0 ? (
              <ListChecks size={22} className="mb-2 text-sky-300" />
            ) : (
              <CheckCircle2 size={22} className="mb-2 text-emerald-400" />
            )}
            <div className="text-[11px] font-medium">
              {plan.summary.total > 0
                ? "Bounded plan summary"
                : "Schemas match"}
            </div>
            <div className="mt-1 text-[9px] leading-4 wb-muted">
              {plan.summary.total > 0
                ? `The target driver reported ${plan.summary.total} change(s) without individual preview rows.`
                : "The live target has the same captured structure as this snapshot."}
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
                    <span
                      className={cn(
                        "shrink-0 text-[8px] uppercase tracking-wide",
                        style.text,
                      )}
                    >
                      {style.label}
                    </span>
                  </span>
                  <span className="mt-1 block text-[9px] leading-4 wb-muted">
                    Step {change.order} · {formatPhase(change.phase)}
                  </span>
                  <span className="mt-0.5 block text-[9px] leading-4 wb-muted">
                    {change.summary}
                  </span>
                  {(change.blockedReason ||
                    change.manualReview ||
                    !change.reversible) && (
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
  );
}
