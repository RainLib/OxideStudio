import {
  explainPlanNodeCount,
  explainPlanNodeLabel,
} from "@/lib/explainPlan";
import {
  applyEditorTextPatch,
  type EditorPatchPreview,
} from "@/lib/editorPatch";
import type {
  ExplainPlan,
  ExplainPlanNode,
  ExplainQueryRequest,
} from "@/services/tauri/types";
import { v4 as uuidv4 } from "uuid";

export interface ExplainPlanComparisonMetric {
  before: number | null;
  after: number | null;
  delta: number | null;
  percentChange: number | null;
}

export interface ExplainPlanComparison {
  driver: string;
  totalCost: ExplainPlanComparisonMetric;
  estimatedRows: ExplainPlanComparisonMetric;
  nodeCount: ExplainPlanComparisonMetric;
  facts: ExplainPlanComparisonFact[];
  hotspots: ExplainPlanHotspot[];
}

export interface ExplainPlanComparisonFact {
  label: string;
  before: string;
  after: string;
}

export interface ExplainPlanHotspot {
  id: string;
  severity: "warning" | "info";
  title: string;
  evidence: string;
}

export interface RuntimePlanReview {
  driver: string;
  executionTimeMs: number | null;
  planningTimeMs: number | null;
  actualRows: number | null;
  loops: number | null;
  slowestNodes: RuntimePlanNodeEvidence[];
  signals: RuntimePlanSignal[];
}

export interface RuntimePlanNodeEvidence {
  id: string;
  label: string;
  relation: string | null;
  actualTotalTimeMs: number;
  actualRows: number | null;
  loops: number | null;
}

export interface RuntimePlanSignal {
  id: string;
  severity: "warning" | "info";
  title: string;
  evidence: string;
}

export interface ComparePatchExplainPlansInput {
  connectionId: string;
  beforeSql: string;
  afterSql: string;
  schema?: string;
  database?: string;
  signal?: AbortSignal;
  explainQuery: (request: ExplainQueryRequest) => Promise<ExplainPlan>;
  cancelQuery?: (queryId: string) => Promise<unknown>;
}

export interface AnalyzePatchExplainPlanInput {
  connectionId: string;
  sql: string;
  schema?: string;
  database?: string;
  signal?: AbortSignal;
  explainQuery: (request: ExplainQueryRequest) => Promise<ExplainPlan>;
  cancelQuery?: (queryId: string) => Promise<unknown>;
}

export function completePatchSqlDocuments(
  documentSql: string,
  patch: EditorPatchPreview,
) {
  const virtualDocument = applyEditorTextPatch(
    documentSql,
    patch.range,
    patch.originalText,
    patch.replacement,
  );
  if (virtualDocument.status !== "success") {
    throw new Error(virtualDocument.message);
  }
  return {
    beforeSql: documentSql,
    afterSql: virtualDocument.text,
  };
}

export async function comparePatchExplainPlans({
  connectionId,
  beforeSql,
  afterSql,
  schema,
  database,
  signal,
  explainQuery,
  cancelQuery,
}: ComparePatchExplainPlansInput): Promise<ExplainPlanComparison> {
  const before = beforeSql.trim();
  const after = afterSql.trim();
  if (!before || !after) {
    throw new Error(
      "Plan comparison requires complete SQL before and after the patch.",
    );
  }
  if (before === after) {
    throw new Error("The patch does not change the SQL query.");
  }
  if (signal?.aborted) throw abortedComparisonError();

  const comparisonId = uuidv4();
  let activeQueryId: string | null = null;
  const cancelActiveQuery = () => {
    if (!activeQueryId || !cancelQuery) return;
    void cancelQuery(activeQueryId).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancelActiveQuery, { once: true });

  try {
    activeQueryId = `patch-plan:${comparisonId}:before`;
    const beforePlan = await explainPlan(
      "Before",
      before,
      activeQueryId,
      connectionId,
      schema,
      database,
      signal,
      explainQuery,
    );

    activeQueryId = `patch-plan:${comparisonId}:after`;
    const afterPlan = await explainPlan(
      "After",
      after,
      activeQueryId,
      connectionId,
      schema,
      database,
      signal,
      explainQuery,
    );
    activeQueryId = null;
    if (beforePlan.driver !== afterPlan.driver) {
      throw new Error("Before and after plans used different database drivers.");
    }

    const totalCost = comparedMetric(beforePlan.totalCost, afterPlan.totalCost);
    const estimatedRows = comparedMetric(
      beforePlan.estimatedRows,
      afterPlan.estimatedRows,
    );
    return {
      driver: afterPlan.driver,
      totalCost,
      estimatedRows,
      nodeCount: comparedMetric(
        explainPlanNodeCount(beforePlan.root),
        explainPlanNodeCount(afterPlan.root),
      ),
      facts: comparedPlanFacts(beforePlan.root, afterPlan.root),
      hotspots: planHotspots(
        beforePlan.root,
        afterPlan.root,
        totalCost,
        estimatedRows,
      ),
    };
  } finally {
    signal?.removeEventListener("abort", cancelActiveQuery);
  }
}

export async function analyzePatchExplainPlan({
  connectionId,
  sql,
  schema,
  database,
  signal,
  explainQuery,
  cancelQuery,
}: AnalyzePatchExplainPlanInput): Promise<ExplainPlan> {
  const query = sql.trim();
  if (!query) {
    throw new Error("Runtime plan requires a complete proposed SQL query.");
  }
  if (signal?.aborted) throw abortedComparisonError();
  const queryId = `patch-plan:${uuidv4()}:actual`;
  const cancel = () => {
    if (!cancelQuery) return;
    void cancelQuery(queryId).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const plan = await explainQuery({
      connectionId,
      sql: query,
      schema: database ? undefined : schema,
      database,
      queryId,
      mode: "analyze",
    });
    if (signal?.aborted) throw abortedComparisonError();
    if (plan.mode !== "analyze") {
      throw new Error("The database returned a non-analyzed plan.");
    }
    return plan;
  } catch (error) {
    if (signal?.aborted) throw abortedComparisonError();
    const message = boundedPlanError(error);
    throw new Error(
      `Proposed SQL could not be analyzed. Select one complete read-only query. ${message}`,
    );
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

const MAX_RUNTIME_PLAN_NODES = 1_000;
const MAX_RUNTIME_SLOW_NODES = 3;
const MAX_RUNTIME_SIGNALS = 3;
const MATERIAL_ROW_MISESTIMATE_RATIO = 10;

export function reviewRuntimeExplainPlan(plan: ExplainPlan): RuntimePlanReview {
  if (plan.mode !== "analyze") {
    throw new Error("Runtime review requires an analyzed plan.");
  }
  const nodes = boundedPlanNodes(plan.root).slice(0, MAX_RUNTIME_PLAN_NODES);
  const slowestNodes = nodes
    .filter(
      (node) =>
        typeof node.actualTotalTimeMs === "number" &&
        Number.isFinite(node.actualTotalTimeMs),
    )
    .sort(
      (left, right) =>
        (right.actualTotalTimeMs ?? 0) - (left.actualTotalTimeMs ?? 0),
    )
    .slice(0, MAX_RUNTIME_SLOW_NODES)
    .map((node) => ({
      id: node.id,
      label: boundedPlanFact(explainPlanNodeLabel(node)),
      relation: boundedNullableFact(node.relation),
      actualTotalTimeMs: node.actualTotalTimeMs!,
      actualRows: finiteMetric(node.actualRows),
      loops: finiteMetric(node.loops),
    }));
  const signals: RuntimePlanSignal[] = [];
  for (const node of nodes) {
    if (signals.length >= MAX_RUNTIME_SIGNALS) break;
    const estimatedRows = finiteMetric(node.estimatedRows);
    const actualRows = finiteMetric(node.actualRows);
    if (
      estimatedRows === null ||
      actualRows === null ||
      (estimatedRows === 0 && actualRows === 0)
    ) {
      continue;
    }
    const ratio =
      Math.max(estimatedRows, actualRows) /
      Math.max(1, Math.min(estimatedRows, actualRows));
    if (ratio < MATERIAL_ROW_MISESTIMATE_RATIO) continue;
    signals.push({
      id: `row-misestimate:${node.id}`,
      severity: "warning",
      title: `Row estimate differs at ${boundedPlanFact(explainPlanNodeLabel(node))}`,
      evidence: `${formatHotspotMetric(estimatedRows)} estimated · ${formatHotspotMetric(actualRows)} actual · ${formatHotspotMetric(ratio)}×`,
    });
  }
  if (signals.length === 0 && slowestNodes[0]) {
    const slowest = slowestNodes[0];
    signals.push({
      id: `slowest-node:${slowest.id}`,
      severity: "info",
      title: `Most time reported at ${slowest.label}`,
      evidence: `${formatHotspotMetric(slowest.actualTotalTimeMs)} ms${slowest.relation ? ` · ${slowest.relation}` : ""}`,
    });
  }
  return {
    driver: plan.driver,
    executionTimeMs: finiteMetric(plan.executionTimeMs),
    planningTimeMs: finiteMetric(plan.planningTimeMs),
    actualRows: finiteMetric(plan.root.actualRows),
    loops: finiteMetric(plan.root.loops),
    slowestNodes,
    signals,
  };
}

function boundedNullableFact(value: string | null | undefined) {
  const bounded = boundedPlanFact(value || "");
  return bounded || null;
}

async function explainPlan(
  label: "Before" | "After",
  sql: string,
  queryId: string,
  connectionId: string,
  schema: string | undefined,
  database: string | undefined,
  signal: AbortSignal | undefined,
  explainQuery: (request: ExplainQueryRequest) => Promise<ExplainPlan>,
) {
  if (signal?.aborted) throw abortedComparisonError();
  try {
    const plan = await explainQuery({
      connectionId,
      sql,
      schema: database ? undefined : schema,
      database,
      queryId,
      mode: "estimate",
    });
    if (signal?.aborted) throw abortedComparisonError();
    if (plan.mode !== "estimate") {
      throw new Error("The database returned a non-estimate plan.");
    }
    return plan;
  } catch (error) {
    if (signal?.aborted) throw abortedComparisonError();
    const message = boundedPlanError(error);
    throw new Error(
      `${label} SQL could not be explained. Select a complete read-only query. ${message}`,
    );
  }
}

function comparedMetric(
  beforeValue: number | null | undefined,
  afterValue: number | null | undefined,
): ExplainPlanComparisonMetric {
  const before = finiteMetric(beforeValue);
  const after = finiteMetric(afterValue);
  if (before === null || after === null) {
    return { before, after, delta: null, percentChange: null };
  }
  const delta = after - before;
  return {
    before,
    after,
    delta,
    percentChange: before === 0 ? null : (delta / Math.abs(before)) * 100,
  };
}

function finiteMetric(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const MAX_COMPARISON_FACTS = 3;
const MAX_PLAN_HOTSPOTS = 3;
const MAX_PLAN_FACT_TEXT = 120;
const MAX_PLAN_FACT_NODES = 1_000;
const COST_REGRESSION_PERCENT = 50;
const COST_REGRESSION_MIN_AFTER = 100;
const ROW_GROWTH_PERCENT = 100;
const ROW_GROWTH_MIN_AFTER = 1_000;
const LARGE_SCAN_ESTIMATED_ROWS = 10_000;
const LARGE_NODE_COST = 1_000;

function comparedPlanFacts(
  beforeRoot: ExplainPlanNode,
  afterRoot: ExplainPlanNode,
): ExplainPlanComparisonFact[] {
  const before = planFacts(beforeRoot);
  const after = planFacts(afterRoot);
  const facts: ExplainPlanComparisonFact[] = [];

  for (const [relation, beforeAccess] of before.relationAccess) {
    const afterAccess = after.relationAccess.get(relation);
    if (!afterAccess || afterAccess === beforeAccess) continue;
    facts.push({
      label: boundedPlanFact(relation),
      before: beforeAccess,
      after: afterAccess,
    });
    if (facts.length >= MAX_COMPARISON_FACTS) return facts;
  }

  if (before.fullScanCount !== after.fullScanCount) {
    facts.push({
      label: "Full scans",
      before: before.fullScanCount.toLocaleString(),
      after: after.fullScanCount.toLocaleString(),
    });
  }

  const newlyUsedIndexes = [...after.indexes].filter(
    (index) => !before.indexes.has(index),
  );
  if (newlyUsedIndexes.length > 0 && facts.length < MAX_COMPARISON_FACTS) {
    facts.push({
      label: "New index usage",
      before: "None",
      after: boundedPlanFact(newlyUsedIndexes.slice(0, 2).join(", ")),
    });
  }

  if (
    facts.length < MAX_COMPARISON_FACTS &&
    before.highestCostNode &&
    after.highestCostNode &&
    before.highestCostNode !== after.highestCostNode
  ) {
    facts.push({
      label: "Highest-cost node",
      before: before.highestCostNode,
      after: after.highestCostNode,
    });
  }

  return facts.slice(0, MAX_COMPARISON_FACTS);
}

function planFacts(root: ExplainPlanNode) {
  const relationAccess = new Map<string, string>();
  const indexes = new Set<string>();
  let fullScanCount = 0;
  let highestCost = Number.NEGATIVE_INFINITY;
  let highestCostNode: string | null = null;
  let visitedNodes = 0;
  const visit = (node: ExplainPlanNode) => {
    if (visitedNodes >= MAX_PLAN_FACT_NODES) return;
    visitedNodes += 1;
    const relation = boundedPlanFact(node.relation || node.alias || "");
    const access = planNodeAccess(node);
    if (relation && access) relationAccess.set(relation, access);
    if (node.index) indexes.add(boundedPlanFact(node.index));
    if (isFullScan(node)) fullScanCount += 1;
    if (
      typeof node.totalCost === "number" &&
      Number.isFinite(node.totalCost) &&
      node.totalCost > highestCost
    ) {
      highestCost = node.totalCost;
      highestCostNode = boundedPlanFact(explainPlanNodeLabel(node));
    }
    node.children.forEach(visit);
  };
  visit(root);
  return { relationAccess, indexes, fullScanCount, highestCostNode };
}

function planHotspots(
  beforeRoot: ExplainPlanNode,
  afterRoot: ExplainPlanNode,
  totalCost: ExplainPlanComparisonMetric,
  estimatedRows: ExplainPlanComparisonMetric,
): ExplainPlanHotspot[] {
  const hotspots: ExplainPlanHotspot[] = [];
  if (
    totalCost.after !== null &&
    totalCost.after >= COST_REGRESSION_MIN_AFTER &&
    totalCost.percentChange !== null &&
    totalCost.percentChange >= COST_REGRESSION_PERCENT
  ) {
    hotspots.push({
      id: "estimated-cost-growth",
      severity: "warning",
      title: "Estimated cost increased",
      evidence: `${formatHotspotMetric(totalCost.before)} → ${formatHotspotMetric(totalCost.after)} · +${formatHotspotPercent(totalCost.percentChange)}%`,
    });
  }
  if (
    estimatedRows.after !== null &&
    estimatedRows.after >= ROW_GROWTH_MIN_AFTER &&
    estimatedRows.percentChange !== null &&
    estimatedRows.percentChange >= ROW_GROWTH_PERCENT
  ) {
    hotspots.push({
      id: "estimated-row-growth",
      severity: "warning",
      title: "Estimated output grew",
      evidence: `${formatHotspotMetric(estimatedRows.before)} → ${formatHotspotMetric(estimatedRows.after)} rows · +${formatHotspotPercent(estimatedRows.percentChange)}%`,
    });
  }

  const beforeAccess = planFacts(beforeRoot).relationAccess;
  const nodes = boundedPlanNodes(afterRoot).sort(
    (left, right) => hotspotNodeScore(right) - hotspotNodeScore(left),
  );
  for (const node of nodes) {
    if (hotspots.length >= MAX_PLAN_HOTSPOTS) break;
    const rows = finiteMetric(node.estimatedRows);
    const cost = finiteMetric(node.totalCost);
    const relation = boundedPlanFact(node.relation || node.alias || "");
    if (
      isFullScan(node) &&
      ((rows ?? 0) >= LARGE_SCAN_ESTIMATED_ROWS ||
        (cost ?? 0) >= LARGE_NODE_COST)
    ) {
      const previousAccess = relation ? beforeAccess.get(relation) : undefined;
      const introduced = Boolean(
        previousAccess &&
          !previousAccess.toLowerCase().includes("seq scan") &&
          !previousAccess.toLowerCase().includes("table scan") &&
          !previousAccess.toLowerCase().includes(" · all"),
      );
      hotspots.push({
        id: `large-full-scan:${node.id}`,
        severity: "warning",
        title: `${introduced ? "Full scan introduced" : "Large full scan"}${relation ? ` on ${relation}` : ""}`,
        evidence: hotspotNodeEvidence(node),
      });
      continue;
    }
    if (
      node.nodeType.toLowerCase().includes("nested loop") &&
      ((rows ?? 0) >= LARGE_SCAN_ESTIMATED_ROWS ||
        (cost ?? 0) >= LARGE_NODE_COST)
    ) {
      hotspots.push({
        id: `large-nested-loop:${node.id}`,
        severity: "info",
        title: "High-estimate nested loop",
        evidence: hotspotNodeEvidence(node),
      });
    }
  }
  return hotspots.slice(0, MAX_PLAN_HOTSPOTS);
}

function boundedPlanNodes(root: ExplainPlanNode) {
  const nodes: ExplainPlanNode[] = [];
  const pending = [root];
  while (pending.length > 0 && nodes.length < MAX_PLAN_FACT_NODES) {
    const node = pending.shift();
    if (!node) break;
    nodes.push(node);
    pending.push(...node.children);
  }
  return nodes;
}

function hotspotNodeScore(node: ExplainPlanNode) {
  return Math.max(
    finiteMetric(node.totalCost) ?? 0,
    (finiteMetric(node.estimatedRows) ?? 0) / 10,
  );
}

function hotspotNodeEvidence(node: ExplainPlanNode) {
  const metrics = [
    finiteMetric(node.estimatedRows) === null
      ? null
      : `${formatHotspotMetric(node.estimatedRows)} estimated rows`,
    finiteMetric(node.totalCost) === null
      ? null
      : `${formatHotspotMetric(node.totalCost)} cost`,
  ].filter(Boolean);
  return [boundedPlanFact(explainPlanNodeLabel(node)), metrics.join(" · ")]
    .filter(Boolean)
    .join(" · ");
}

function formatHotspotMetric(value: number | null | undefined) {
  const metric = finiteMetric(value);
  return metric === null
    ? "—"
    : metric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatHotspotPercent(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function planNodeAccess(node: ExplainPlanNode) {
  const parts = [node.nodeType];
  if (node.accessType) parts.push(node.accessType);
  if (node.index) parts.push(node.index);
  return boundedPlanFact(parts.join(" · "));
}

function isFullScan(node: ExplainPlanNode) {
  const nodeType = node.nodeType.toLowerCase();
  const accessType = node.accessType?.toLowerCase();
  return (
    nodeType.includes("seq scan") ||
    nodeType.includes("table scan") ||
    accessType === "all"
  );
}

function boundedPlanFact(value: string) {
  const normalized = value
    .trim()
    .replace(/[\u0000-\u001f\u007f]/gu, " ");
  return [...normalized].slice(0, MAX_PLAN_FACT_TEXT).join("");
}

function boundedPlanError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  const normalized = value
    .trim()
    .replace(/[\u0000-\u001f\u007f]/gu, " ");
  return [...normalized].slice(0, 400).join("") || "Unknown database error.";
}

function abortedComparisonError() {
  return new DOMException("Plan comparison was cancelled.", "AbortError");
}
