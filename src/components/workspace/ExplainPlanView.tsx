import {
  AlertTriangle,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Clock3,
  Gauge,
  ListTree,
  Rows3,
  ScanSearch,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  explainPlanNodeCount,
  explainPlanNodeLabel,
  explainPlanNodePath,
  findExplainPlanNode,
  flattenExplainPlan,
  formatPlanMetric,
} from "@/lib/explainPlan";
import {
  APP_EVENT_REVEAL_PLAN_NODE,
  type ExplainPlanNodeNavigationDetail,
} from "@/lib/explainPlanNavigation";
import { cn } from "@/lib/utils";
import type { ExplainPlan, ExplainPlanNode } from "@/services/tauri/types";

interface ExplainPlanViewProps {
  tabId: string;
  plan: ExplainPlan;
}

export function ExplainPlanView({ tabId, plan }: ExplainPlanViewProps) {
  const [view, setView] = useState<"tree" | "raw">("tree");
  const [selectedNodeId, setSelectedNodeId] = useState(plan.root.id);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setView("tree");
    setSelectedNodeId(plan.root.id);
    setCollapsed(new Set());
  }, [plan.id, plan.root.id]);

  useEffect(() => {
    const reveal = (event: Event) => {
      const detail = (event as CustomEvent<ExplainPlanNodeNavigationDetail>)
        .detail;
      if (detail?.tabId !== tabId || detail.planId !== plan.id) return;
      const path = explainPlanNodePath(plan.root, detail.nodeId);
      if (!path) return;
      setView("tree");
      setSelectedNodeId(detail.nodeId);
      setCollapsed((current) => {
        const next = new Set(current);
        path.slice(0, -1).forEach((nodeId) => next.delete(nodeId));
        return next;
      });
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(
            `[data-plan-id="${cssSelectorValue(plan.id)}"][data-plan-node-id="${cssSelectorValue(detail.nodeId)}"]`,
          )
          ?.scrollIntoView({ block: "nearest" });
      });
    };
    window.addEventListener(APP_EVENT_REVEAL_PLAN_NODE, reveal);
    return () => window.removeEventListener(APP_EVENT_REVEAL_PLAN_NODE, reveal);
  }, [plan.id, plan.root, tabId]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1_600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const visibleNodes = useMemo(
    () => flattenExplainPlan(plan.root, collapsed),
    [collapsed, plan.root],
  );
  const selectedNode =
    findExplainPlanNode(plan.root, selectedNodeId) || plan.root;
  const rawText = useMemo(
    () =>
      typeof plan.rawPlan === "string"
        ? plan.rawPlan
        : JSON.stringify(plan.rawPlan, null, 2),
    [plan.rawPlan],
  );
  const nodeCount = useMemo(() => explainPlanNodeCount(plan.root), [plan.root]);

  const copyRawPlan = async () => {
    await navigator.clipboard.writeText(rawText);
    setCopied(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--wb-editor))] text-[hsl(var(--wb-text))]">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-2">
        <ViewButton
          active={view === "tree"}
          icon={<ListTree size={12} />}
          label="Plan tree"
          onClick={() => setView("tree")}
        />
        <ViewButton
          active={view === "raw"}
          icon={<Braces size={12} />}
          label={plan.format === "json" ? "Raw JSON" : "Raw text"}
          onClick={() => setView("raw")}
        />
        <span className="mx-1 h-4 w-px bg-[hsl(var(--wb-border-subtle))]" />
        <span className="rounded-[3px] border border-[hsl(var(--wb-border))] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--wb-text-muted))]">
          {plan.driver}
        </span>
        <span
          className={cn(
            "rounded-[3px] border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]",
            plan.mode === "analyze"
              ? "border-[hsl(var(--wb-accent))] text-[hsl(var(--wb-accent))]"
              : "border-[hsl(var(--wb-border))] text-[hsl(var(--wb-text-muted))]",
          )}
        >
          {plan.mode}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {view === "tree" ? (
            <>
              <button
                type="button"
                className="wb-text-button h-6 px-2 text-[10px]"
                onClick={() => setCollapsed(new Set())}
              >
                Expand all
              </button>
              <button
                type="button"
                className="wb-text-button h-6 px-2 text-[10px]"
                onClick={() =>
                  setCollapsed(
                    new Set(
                      flattenExplainPlan(plan.root)
                        .filter(({ node }) => node.children.length > 0)
                        .map(({ node }) => node.id),
                    ),
                  )
                }
              >
                Collapse all
              </button>
            </>
          ) : (
            <button
              type="button"
              className="wb-text-button h-6 gap-1.5 px-2 text-[10px]"
              onClick={() => void copyRawPlan()}
            >
              {copied ? <Check size={11} /> : <Clipboard size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-4 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]">
        <PlanMetric
          icon={<Gauge size={12} />}
          label="Total cost"
          value={formatPlanMetric(plan.totalCost)}
        />
        <PlanMetric
          icon={<Rows3 size={12} />}
          label="Estimated rows"
          value={formatPlanMetric(plan.estimatedRows)}
        />
        <PlanMetric
          icon={<Clock3 size={12} />}
          label={plan.mode === "analyze" ? "Execution time" : "Plan request"}
          value={`${formatPlanMetric(
            plan.mode === "analyze"
              ? (plan.executionTimeMs ?? plan.generatedInMs)
              : plan.generatedInMs,
          )} ms`}
        />
        <PlanMetric
          icon={<ScanSearch size={12} />}
          label="Plan nodes"
          value={nodeCount.toLocaleString()}
        />
      </div>

      {plan.warnings.length > 0 && (
        <div className="flex shrink-0 items-start gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-1.5 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
          <AlertTriangle
            size={11}
            className="mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]"
          />
          <span>{plan.warnings.join(" ")}</span>
        </div>
      )}

      {view === "raw" ? (
        <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[11px] leading-5 text-[hsl(var(--wb-text))] custom-scrollbar">
          {rawText}
        </pre>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto border-r border-[hsl(var(--wb-border-subtle))] py-1 custom-scrollbar">
            {visibleNodes.map(({ node, depth }) => (
              <PlanNodeRow
                key={node.id}
                planId={plan.id}
                node={node}
                depth={depth}
                selected={node.id === selectedNode.id}
                collapsed={collapsed.has(node.id)}
                onToggle={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  })
                }
                onSelect={() => setSelectedNodeId(node.id)}
              />
            ))}
          </div>
          <PlanNodeDetails node={selectedNode} />
        </div>
      )}
    </div>
  );
}

function PlanNodeRow({
  planId,
  node,
  depth,
  selected,
  collapsed,
  onToggle,
  onSelect,
}: {
  planId: string;
  node: ExplainPlanNode;
  depth: number;
  selected: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const hasChildren = node.children.length > 0;
  return (
    <div
      data-plan-id={planId}
      data-plan-node-id={node.id}
      className={cn(
        "group flex h-8 min-w-max items-center border-l-2 pr-3 text-[10px]",
        selected
          ? "border-l-[hsl(var(--wb-accent))] bg-[hsl(var(--wb-active-strong))]"
          : "border-l-transparent hover:bg-[hsl(var(--wb-hover))]",
      )}
      style={{ paddingLeft: `${6 + depth * 18}px` }}
    >
      <button
        type="button"
        className="flex h-6 w-5 shrink-0 items-center justify-center text-[hsl(var(--wb-text-muted))]"
        onClick={onToggle}
        disabled={!hasChildren}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${node.nodeType}`}
      >
        {hasChildren &&
          (collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />)}
      </button>
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
        onClick={onSelect}
      >
        <span className="min-w-[160px] truncate font-medium text-[hsl(var(--wb-text))]">
          {explainPlanNodeLabel(node)}
        </span>
        {node.accessType && (
          <span className="rounded-[2px] bg-[hsl(var(--wb-panel-raised))] px-1 py-0.5 font-mono text-[8px] uppercase text-[hsl(var(--wb-text-muted))]">
            {node.accessType}
          </span>
        )}
        <span className="ml-auto w-[90px] text-right tabular-nums text-[hsl(var(--wb-text-muted))]">
          cost {formatPlanMetric(node.totalCost)}
        </span>
        <span className="w-[78px] text-right tabular-nums text-[hsl(var(--wb-text-muted))]">
          rows {formatPlanMetric(node.estimatedRows)}
        </span>
        {node.actualTotalTimeMs !== null &&
          node.actualTotalTimeMs !== undefined && (
            <span className="w-[72px] text-right tabular-nums text-[hsl(var(--wb-accent))]">
              {formatPlanMetric(node.actualTotalTimeMs)} ms
            </span>
          )}
      </button>
    </div>
  );
}

function PlanNodeDetails({ node }: { node: ExplainPlanNode }) {
  const details = [
    ["Relation", node.relation],
    ["Alias", node.alias],
    ["Access", node.accessType],
    ["Join", node.joinType],
    ["Index", node.index],
    ["Startup cost", formatOptionalMetric(node.startupCost)],
    ["Total cost", formatOptionalMetric(node.totalCost)],
    ["Estimated rows", formatOptionalMetric(node.estimatedRows)],
    ["Actual startup", formatOptionalMetric(node.actualStartupTimeMs, " ms")],
    ["Actual total", formatOptionalMetric(node.actualTotalTimeMs, " ms")],
    ["Actual rows", formatOptionalMetric(node.actualRows)],
    ["Loops", formatOptionalMetric(node.loops)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <aside className="w-[300px] shrink-0 overflow-auto bg-[hsl(var(--wb-panel))] p-3 custom-scrollbar">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--wb-text-muted))]">
        Selected node
      </div>
      <div className="mt-2 text-[12px] font-semibold leading-5 text-[hsl(var(--wb-text))]">
        {node.nodeType}
      </div>
      <dl className="mt-3 grid grid-cols-[92px_minmax(0,1fr)] gap-x-2 gap-y-2 text-[10px]">
        {details.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-[hsl(var(--wb-text-muted))]">{label}</dt>
            <dd className="min-w-0 break-words font-mono text-[hsl(var(--wb-text))]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {node.condition && (
        <div className="mt-4 border-t border-[hsl(var(--wb-border-subtle))] pt-3">
          <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--wb-text-muted))]">
            Condition
          </div>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-[hsl(var(--wb-text))]">
            {node.condition}
          </pre>
        </div>
      )}
    </aside>
  );
}

function PlanMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-r border-[hsl(var(--wb-border-subtle))] px-3 py-2 last:border-r-0">
      <span className="text-[hsl(var(--wb-accent))]">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[8px] uppercase tracking-[0.08em] text-[hsl(var(--wb-text-muted))]">
          {label}
        </span>
        <span className="block truncate font-mono text-[11px] font-medium tabular-nums">
          {value}
        </span>
      </span>
    </div>
  );
}

function ViewButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-6 items-center gap-1.5 rounded-[3px] px-2 text-[10px]",
        active
          ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
          : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]",
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function formatOptionalMetric(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined
    ? null
    : `${formatPlanMetric(value)}${suffix}`;
}

function cssSelectorValue(value: string) {
  return value.replace(/["\\]/g, "\\$&");
}
