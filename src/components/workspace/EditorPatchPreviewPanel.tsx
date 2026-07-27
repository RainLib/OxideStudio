import type {
  EditorPatchApplyResult,
  EditorPatchPreview,
} from "@/lib/editorPatch";
import type { SqlSyntaxValidation } from "@/services/tauri/types";
import type {
  ExplainPlanComparison,
  RuntimePlanReview,
} from "@/lib/explainPlanComparison";
import { formatPlanMetric } from "@/lib/explainPlan";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  Check,
  FileDiff,
  LoaderCircle,
  ScanSearch,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface EditorPatchPreviewPanelProps {
  patch: EditorPatchPreview;
  stale: boolean;
  onValidate?: () => Promise<SqlSyntaxValidation>;
  onComparePlans?: (signal: AbortSignal) => Promise<ExplainPlanComparison>;
  onAnalyzeAfterPlan?: (signal: AbortSignal) => Promise<RuntimePlanReview>;
  onApply: () => EditorPatchApplyResult;
  onDismiss: () => void;
}

export function EditorPatchPreviewPanel({
  patch,
  stale,
  onValidate,
  onComparePlans,
  onAnalyzeAfterPlan,
  onApply,
  onDismiss,
}: EditorPatchPreviewPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<
    | { status: "idle" | "running" }
    | { status: "complete"; result: SqlSyntaxValidation }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [planComparison, setPlanComparison] = useState<
    | { status: "idle" | "running" }
    | { status: "complete"; result: ExplainPlanComparison }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [runtimePlan, setRuntimePlan] = useState<
    | { status: "idle" | "running" }
    | { status: "complete"; result: RuntimePlanReview }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [actualConfirmOpen, setActualConfirmOpen] = useState(false);
  const planRequestAbortRef = useRef<AbortController | null>(null);
  const busy =
    validation.status === "running" ||
    planComparison.status === "running" ||
    runtimePlan.status === "running";
  const syntaxKnownInvalid =
    validation.status === "complete" && !validation.result.valid;

  useEffect(
    () => () => {
      planRequestAbortRef.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!stale) return;
    planRequestAbortRef.current?.abort();
    setPlanComparison({ status: "idle" });
    setRuntimePlan({ status: "idle" });
    setActualConfirmOpen(false);
  }, [stale]);
  const apply = () => {
    const result = onApply();
    setError(result.status === "success" ? null : result.message);
  };
  const validate = async () => {
    if (!onValidate || stale || busy) return;
    setError(null);
    setValidation({ status: "running" });
    try {
      setValidation({ status: "complete", result: await onValidate() });
    } catch (validationError) {
      setValidation({
        status: "error",
        message:
          validationError instanceof Error
            ? validationError.message
            : "SQL syntax validation is unavailable.",
      });
    }
  };
  const comparePlans = async () => {
    if (!onComparePlans || stale || busy || syntaxKnownInvalid) return;
    setError(null);
    const controller = new AbortController();
    planRequestAbortRef.current?.abort();
    planRequestAbortRef.current = controller;
    setPlanComparison({ status: "running" });
    try {
      const result = await onComparePlans(controller.signal);
      if (!controller.signal.aborted) {
        setPlanComparison({ status: "complete", result });
      }
    } catch (comparisonError) {
      if (!controller.signal.aborted) {
        setPlanComparison({
          status: "error",
          message:
            comparisonError instanceof Error
              ? comparisonError.message
              : "Plan comparison is unavailable.",
        });
      }
    } finally {
      if (planRequestAbortRef.current === controller) {
        planRequestAbortRef.current = null;
      }
    }
  };
  const analyzeAfterPlan = async () => {
    if (
      !onAnalyzeAfterPlan ||
      stale ||
      busy ||
      syntaxKnownInvalid ||
      !actualConfirmOpen
    ) {
      return;
    }
    setActualConfirmOpen(false);
    setError(null);
    const controller = new AbortController();
    planRequestAbortRef.current?.abort();
    planRequestAbortRef.current = controller;
    setRuntimePlan({ status: "running" });
    try {
      const result = await onAnalyzeAfterPlan(controller.signal);
      if (!controller.signal.aborted) {
        setRuntimePlan({ status: "complete", result });
      }
    } catch (runtimeError) {
      if (!controller.signal.aborted) {
        setRuntimePlan({
          status: "error",
          message:
            runtimeError instanceof Error
              ? runtimeError.message
              : "Runtime plan review is unavailable.",
        });
      }
    } finally {
      if (planRequestAbortRef.current === controller) {
        planRequestAbortRef.current = null;
      }
    }
  };

  return (
    <section
      className="border-b border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised)/0.92)]"
      aria-label="AI patch preview"
    >
      <div className="flex min-h-8 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-2.5">
        <FileDiff size={13} className="shrink-0 text-[hsl(var(--wb-accent))]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-medium text-[hsl(var(--wb-text))]">
            {patch.title}
          </div>
          <div className="truncate text-[9px] text-[hsl(var(--wb-text-muted))]">
            {patch.rationale || `Lines ${patch.range.startLine}–${patch.range.endLine}`}
          </div>
        </div>
        {stale && (
          <span className="inline-flex items-center gap-1 text-[9px] text-amber-300">
            <AlertTriangle size={10} /> Document changed
          </span>
        )}
        {onValidate && (
          <button
            type="button"
            className="wb-text-button h-6 gap-1 px-2 text-[9px]"
            onClick={() => void validate()}
            disabled={stale || busy}
            title="Validate patched SQL syntax without executing it"
          >
            {validation.status === "running" ? (
              <LoaderCircle
                size={11}
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <ScanSearch size={11} />
            )}
            {validation.status === "running" ? "Checking" : "Validate"}
          </button>
        )}
        {onComparePlans && (
          <button
            type="button"
            className="wb-text-button h-6 gap-1 px-2 text-[9px]"
            onClick={() => void comparePlans()}
            disabled={stale || busy || syntaxKnownInvalid}
            title={
              syntaxKnownInvalid
                ? "Fix syntax issues before comparing plans"
                : "Compare estimated plans for the complete before and after SQL"
            }
          >
            {planComparison.status === "running" ? (
              <LoaderCircle
                size={11}
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <ChartNoAxesColumnIncreasing size={11} />
            )}
            {planComparison.status === "running" ? "Comparing" : "Plans"}
          </button>
        )}
        {onAnalyzeAfterPlan && (
          <button
            type="button"
            className="wb-text-button h-6 gap-1 px-2 text-[9px]"
            onClick={() => setActualConfirmOpen(true)}
            disabled={stale || busy || syntaxKnownInvalid}
            title={
              syntaxKnownInvalid
                ? "Fix syntax issues before collecting an actual plan"
                : "Collect actual timing and rows for the proposed SQL"
            }
          >
            {runtimePlan.status === "running" ? (
              <LoaderCircle
                size={11}
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <Activity size={11} />
            )}
            {runtimePlan.status === "running" ? "Running" : "Actual"}
          </button>
        )}
        <button
          type="button"
          className="wb-text-button h-6 gap-1 px-2 text-[9px]"
          onClick={apply}
          disabled={stale || busy}
          title={
            stale
              ? "Refresh the proposal against the current document"
              : "Apply this patch"
          }
        >
          <Check size={11} /> Apply
        </button>
        <button
          type="button"
          className="wb-icon-button"
          onClick={onDismiss}
          title="Dismiss patch"
        >
          <X size={12} />
        </button>
      </div>
      <div className="grid max-h-52 grid-cols-2 overflow-auto font-mono text-[10px] leading-4">
        <PatchSide label="Before" value={patch.originalText} tone="remove" />
        <PatchSide label="After" value={patch.replacement} tone="add" />
      </div>
      {actualConfirmOpen && (
        <div
          className="flex min-h-9 items-center gap-2 border-t border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[9px] leading-4 text-amber-100"
          role="alert"
        >
          <AlertTriangle size={11} className="shrink-0 text-amber-300" />
          <span className="min-w-0 flex-1">
            Runs the complete proposed read-only query once with EXPLAIN
            ANALYZE. It can be expensive.
          </span>
          <button
            type="button"
            className="wb-text-button h-6 px-2 text-[9px]"
            onClick={() => setActualConfirmOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="wb-text-button h-6 px-2 text-[9px]"
            onClick={() => void analyzeAfterPlan()}
          >
            Run actual
          </button>
        </div>
      )}
      {validation.status === "complete" && (
        <ValidationResult result={validation.result} />
      )}
      {validation.status === "error" && (
        <div
          className="border-t border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[9px] text-amber-200"
          role="status"
        >
          Syntax check unavailable: {validation.message}
        </div>
      )}
      {planComparison.status === "complete" && (
        <PlanComparisonResult comparison={planComparison.result} />
      )}
      {planComparison.status === "error" && (
        <div
          className="border-t border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[9px] leading-4 text-amber-200"
          role="status"
        >
          Plan comparison unavailable: {planComparison.message} The source
          query was not executed.
        </div>
      )}
      {runtimePlan.status === "complete" && (
        <RuntimePlanResult review={runtimePlan.result} />
      )}
      {runtimePlan.status === "error" && (
        <div
          className="border-t border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[9px] leading-4 text-amber-200"
          role="status"
        >
          Runtime plan unavailable: {runtimePlan.message}
        </div>
      )}
      {error && (
        <div className="border-t border-red-500/25 bg-red-500/10 px-2.5 py-1 text-[9px] text-red-300">
          {error}
        </div>
      )}
    </section>
  );
}

function RuntimePlanResult({ review }: { review: RuntimePlanReview }) {
  return (
    <div className="border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]">
      <div className="grid grid-cols-3 divide-x divide-[hsl(var(--wb-border-subtle))]">
        <RuntimeMetric
          label="Execution time"
          value={formatRuntimeMetric(review.executionTimeMs, " ms")}
        />
        <RuntimeMetric
          label="Actual rows"
          value={formatRuntimeMetric(review.actualRows)}
        />
        <RuntimeMetric
          label="Loops"
          value={formatRuntimeMetric(review.loops)}
        />
      </div>
      {review.slowestNodes.length > 0 && (
        <div
          className="border-t border-[hsl(var(--wb-border-subtle))]"
          aria-label="Slowest reported plan nodes"
        >
          <div className="px-2.5 py-1 text-[9px] font-medium text-[hsl(var(--wb-text-muted))]">
            Slowest reported nodes
          </div>
          {review.slowestNodes.map((node) => (
            <div
              key={node.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-[hsl(var(--wb-border-subtle))] px-2.5 py-1 text-[9px] leading-4"
              data-runtime-plan-node-id={node.id}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-[hsl(var(--wb-text))]">
                  {node.label}
                </span>
                <span className="block truncate text-[8px] text-[hsl(var(--wb-text-muted))]">
                  {[node.relation, runtimeNodeDetail(node)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="font-mono tabular-nums text-[hsl(var(--wb-text))]">
                {formatRuntimeMetric(node.actualTotalTimeMs, " ms")}
              </span>
            </div>
          ))}
        </div>
      )}
      {review.signals.length > 0 && (
        <div
          className="border-t border-[hsl(var(--wb-border-subtle))]"
          aria-label="Runtime plan signals"
        >
          <div className="px-2.5 py-1 text-[9px] font-medium text-[hsl(var(--wb-text-muted))]">
            Runtime signals
          </div>
          {review.signals.map((signal) => (
            <div
              key={signal.id}
              className="flex items-start gap-1.5 border-t border-[hsl(var(--wb-border-subtle))] px-2.5 py-1.5 text-[9px] leading-4"
            >
              <AlertTriangle
                size={10}
                className={
                  signal.severity === "warning"
                    ? "mt-0.5 shrink-0 text-amber-300"
                    : "mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]"
                }
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-[hsl(var(--wb-text))]">
                  {signal.title}
                </span>
                <span className="block break-words font-mono text-[8px] text-[hsl(var(--wb-text-muted))]">
                  {signal.evidence}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-[hsl(var(--wb-border-subtle))] px-2.5 py-1 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
        Actual · proposed query executed once inside a backend-enforced
        read-only transaction
        {review.planningTimeMs === null
          ? "."
          : ` · ${formatRuntimeMetric(review.planningTimeMs, " ms")} planning.`}{" "}
        Timing can vary with cache and load.
      </div>
    </div>
  );
}

function RuntimeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2.5 py-1.5">
      <div className="truncate text-[9px] text-[hsl(var(--wb-text-muted))]">
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] tabular-nums text-[hsl(var(--wb-text))]">
        {value}
      </div>
    </div>
  );
}

function runtimeNodeDetail(
  node: RuntimePlanReview["slowestNodes"][number],
) {
  const rows =
    node.actualRows === null
      ? null
      : `${formatRuntimeMetric(node.actualRows)} rows`;
  const loops =
    node.loops === null ? null : `${formatRuntimeMetric(node.loops)} loops`;
  return [rows, loops].filter(Boolean).join(" · ");
}

function formatRuntimeMetric(value: number | null, suffix = "") {
  return value === null
    ? "—"
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

function PlanComparisonResult({
  comparison,
}: {
  comparison: ExplainPlanComparison;
}) {
  return (
    <div className="border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]">
      <div className="grid grid-cols-3 divide-x divide-[hsl(var(--wb-border-subtle))]">
        <ComparedPlanMetric
          label="Estimated cost"
          metric={comparison.totalCost}
          showPercent
        />
        <ComparedPlanMetric
          label="Estimated rows"
          metric={comparison.estimatedRows}
        />
        <ComparedPlanMetric label="Plan nodes" metric={comparison.nodeCount} />
      </div>
      {comparison.facts.length > 0 && (
        <div className="border-t border-[hsl(var(--wb-border-subtle))] px-2.5 py-1.5">
          <div className="mb-1 text-[9px] font-medium text-[hsl(var(--wb-text-muted))]">
            Plan changes
          </div>
          <div className="space-y-1">
            {comparison.facts.map((fact) => (
              <div
                key={`${fact.label}:${fact.before}:${fact.after}`}
                className="grid min-w-0 grid-cols-[minmax(64px,0.55fr)_minmax(0,1fr)_10px_minmax(0,1fr)] items-center gap-1 text-[9px]"
              >
                <span className="truncate text-[hsl(var(--wb-text-muted))]" title={fact.label}>
                  {fact.label}
                </span>
                <span className="truncate font-mono text-[hsl(var(--wb-text))]" title={fact.before}>
                  {fact.before}
                </span>
                <ArrowRight size={9} className="text-[hsl(var(--wb-text-muted))]" />
                <span className="truncate font-mono text-[hsl(var(--wb-text))]" title={fact.after}>
                  {fact.after}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {comparison.hotspots.length > 0 && (
        <div
          className="border-t border-[hsl(var(--wb-border-subtle))]"
          aria-label="Plan review signals"
        >
          <div className="px-2.5 py-1 text-[9px] font-medium text-[hsl(var(--wb-text-muted))]">
            Review signals
          </div>
          {comparison.hotspots.map((hotspot) => (
            <div
              key={hotspot.id}
              className="flex items-start gap-1.5 border-t border-[hsl(var(--wb-border-subtle))] px-2.5 py-1.5 text-[9px] leading-4"
              data-plan-hotspot-id={hotspot.id}
            >
              <AlertTriangle
                size={10}
                className={
                  hotspot.severity === "warning"
                    ? "mt-0.5 shrink-0 text-amber-300"
                    : "mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]"
                }
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-[hsl(var(--wb-text))]">
                  {hotspot.title}
                </span>
                <span className="block break-words font-mono text-[8px] text-[hsl(var(--wb-text-muted))]">
                  {hotspot.evidence}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-[hsl(var(--wb-border-subtle))] px-2.5 py-1 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
        Estimate only · database contacted · neither query executed. Planner
        cost is directional, not proof of runtime improvement.
      </div>
    </div>
  );
}

function ComparedPlanMetric({
  label,
  metric,
  showPercent = false,
}: {
  label: string;
  metric: ExplainPlanComparison["totalCost"];
  showPercent?: boolean;
}) {
  const percent =
    showPercent && metric.percentChange !== null
      ? `${metric.percentChange > 0 ? "+" : ""}${metric.percentChange.toFixed(1)}%`
      : null;
  return (
    <div className="min-w-0 px-2.5 py-1.5">
      <div className="truncate text-[9px] text-[hsl(var(--wb-text-muted))]">
        {label}
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[10px] tabular-nums text-[hsl(var(--wb-text))]">
        <span className="truncate">{formatPlanMetric(metric.before)}</span>
        <ArrowRight
          size={10}
          className="shrink-0 text-[hsl(var(--wb-text-muted))]"
        />
        <span className="truncate">{formatPlanMetric(metric.after)}</span>
        {percent && (
          <span className="ml-auto shrink-0 text-[hsl(var(--wb-text-muted))]">
            {percent}
          </span>
        )}
      </div>
    </div>
  );
}

function ValidationResult({ result }: { result: SqlSyntaxValidation }) {
  if (result.valid) {
    return (
      <div
        className="flex items-center gap-1 border-t border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[9px] text-emerald-200"
        role="status"
      >
        <Check size={10} />
        Syntax valid for {result.driver} · {result.statementCount}{" "}
        {result.statementCount === 1 ? "statement" : "statements"} · nothing
        executed
      </div>
    );
  }

  const diagnostic = result.diagnostics[0];
  const location =
    diagnostic?.line && diagnostic.column
      ? `Line ${diagnostic.line}, column ${diagnostic.column}: `
      : "";
  return (
    <div
      className="border-t border-red-500/25 bg-red-500/10 px-2.5 py-1 text-[9px] text-red-200"
      role="alert"
    >
      Syntax issue · {location}
      {diagnostic?.message || "The parser rejected the patched SQL."} Nothing
      executed.
    </div>
  );
}

function PatchSide({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "add" | "remove";
}) {
  return (
    <div className="min-w-0 border-r border-[hsl(var(--wb-border-subtle))] last:border-r-0">
      <div className="sticky top-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] px-2 py-0.5 text-[9px] uppercase tracking-wider text-[hsl(var(--wb-text-muted))]">
        {label}
      </div>
      <pre
        className={
          tone === "add"
            ? "min-h-16 whitespace-pre-wrap break-words bg-emerald-500/5 px-2 py-1.5 text-emerald-100"
            : "min-h-16 whitespace-pre-wrap break-words bg-red-500/5 px-2 py-1.5 text-red-100"
        }
      >
        {value || "∅"}
      </pre>
    </div>
  );
}
