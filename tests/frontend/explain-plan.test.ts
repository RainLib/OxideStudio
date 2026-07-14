import { describe, expect, it } from "vitest";
import {
  explainPlanNodeCount,
  explainPlanNodePath,
  findExplainPlanNode,
  flattenExplainPlan,
} from "@/lib/explainPlan";
import type { ExplainPlanNode } from "@/services/tauri/types";

const root: ExplainPlanNode = {
  id: "node-0",
  nodeType: "Hash Join",
  children: [
    {
      id: "node-1",
      nodeType: "Seq Scan",
      relation: "users",
      children: [],
    },
    {
      id: "node-2",
      nodeType: "Hash",
      children: [
        {
          id: "node-3",
          nodeType: "Index Scan",
          relation: "teams",
          children: [],
        },
      ],
    },
  ],
};

describe("Explain Plan tree model", () => {
  it("flattens visible nodes while preserving database plan depth", () => {
    expect(
      flattenExplainPlan(root).map(({ node, depth }) => [node.id, depth]),
    ).toEqual([
      ["node-0", 0],
      ["node-1", 1],
      ["node-2", 1],
      ["node-3", 2],
    ]);
    expect(
      flattenExplainPlan(root, new Set(["node-2"])).map(({ node }) => node.id),
    ).toEqual(["node-0", "node-1", "node-2"]);
  });

  it("finds stable node ids and their reveal path", () => {
    expect(findExplainPlanNode(root, "node-3")?.relation).toBe("teams");
    expect(findExplainPlanNode(root, "missing")).toBeNull();
    expect(explainPlanNodePath(root, "node-3")).toEqual([
      "node-0",
      "node-2",
      "node-3",
    ]);
    expect(explainPlanNodeCount(root)).toBe(4);
  });
});
