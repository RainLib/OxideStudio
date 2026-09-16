import type { AiWorkspaceTabSummary } from "@/ai/tools/types";
import type { ExplainPlan } from "@/services/tauri/types";

const MAX_AI_EXPLAIN_NODES = 100;

const MAX_AI_EXPLAIN_WARNINGS = 3;

export function boundedAiExplainPlanSummary(
  plan: ExplainPlan,
): NonNullable<AiWorkspaceTabSummary["explainPlan"]> {
  const nodes: NonNullable<AiWorkspaceTabSummary["explainPlan"]>["nodes"] = [];
  const pending = [{ node: plan.root, parentId: null as string | null }];
  while (pending.length > 0 && nodes.length < MAX_AI_EXPLAIN_NODES) {
    const current = pending.shift()!;
    nodes.push({
      id: boundedPlanText(current.node.id, 240),
      parentId: current.parentId,
      nodeType: boundedPlanText(current.node.nodeType, 160),
      relation: boundedNullablePlanText(current.node.relation, 240),
      index: boundedNullablePlanText(current.node.index, 240),
      totalCost: finitePlanMetric(current.node.totalCost),
      estimatedRows: finitePlanMetric(current.node.estimatedRows),
      actualTotalTimeMs: finitePlanMetric(current.node.actualTotalTimeMs),
      actualRows: finitePlanMetric(current.node.actualRows),
      loops: finitePlanMetric(current.node.loops),
    });
    pending.push(
      ...current.node.children.map((node) => ({
        node,
        parentId: current.node.id,
      })),
    );
  }
  return {
    id: boundedPlanText(plan.id, 240),
    driver: plan.driver,
    mode: plan.mode,
    generatedInMs: finitePlanMetric(plan.generatedInMs) ?? 0,
    planningTimeMs: finitePlanMetric(plan.planningTimeMs),
    executionTimeMs: finitePlanMetric(plan.executionTimeMs),
    totalCost: finitePlanMetric(plan.totalCost),
    estimatedRows: finitePlanMetric(plan.estimatedRows),
    rootNodeId: boundedPlanText(plan.root.id, 240),
    nodes,
    truncated: pending.length > 0,
    warnings: plan.warnings
      .slice(0, MAX_AI_EXPLAIN_WARNINGS)
      .map((warning) => boundedPlanText(warning, 240)),
  };
}

function boundedPlanText(value: string, maxCharacters: number) {
  return value.trim().slice(0, maxCharacters);
}

function boundedNullablePlanText(
  value: string | null | undefined,
  maxCharacters: number,
) {
  const bounded = value ? boundedPlanText(value, maxCharacters) : "";
  return bounded || null;
}

function finitePlanMetric(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
