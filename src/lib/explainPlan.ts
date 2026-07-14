import type { ExplainPlanNode } from "@/services/tauri/types";

export interface VisibleExplainPlanNode {
  node: ExplainPlanNode;
  depth: number;
}

export function flattenExplainPlan(
  root: ExplainPlanNode,
  collapsed: ReadonlySet<string> = new Set(),
): VisibleExplainPlanNode[] {
  const rows: VisibleExplainPlanNode[] = [];
  const visit = (node: ExplainPlanNode, depth: number) => {
    rows.push({ node, depth });
    if (collapsed.has(node.id)) return;
    node.children.forEach((child) => visit(child, depth + 1));
  };
  visit(root, 0);
  return rows;
}

export function findExplainPlanNode(
  root: ExplainPlanNode,
  nodeId: string,
): ExplainPlanNode | null {
  if (root.id === nodeId) return root;
  for (const child of root.children) {
    const match = findExplainPlanNode(child, nodeId);
    if (match) return match;
  }
  return null;
}

export function explainPlanNodePath(
  root: ExplainPlanNode,
  nodeId: string,
): string[] | null {
  if (root.id === nodeId) return [root.id];
  for (const child of root.children) {
    const childPath = explainPlanNodePath(child, nodeId);
    if (childPath) return [root.id, ...childPath];
  }
  return null;
}

export function explainPlanNodeCount(root: ExplainPlanNode): number {
  return (
    1 +
    root.children.reduce(
      (count, child) => count + explainPlanNodeCount(child),
      0,
    )
  );
}

export function explainPlanNodeLabel(node: ExplainPlanNode) {
  const target = node.relation || node.alias;
  return target ? `${node.nodeType} · ${target}` : node.nodeType;
}

export function formatPlanMetric(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
