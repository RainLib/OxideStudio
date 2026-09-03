import { describe, expect, it } from "vitest";
import {
  createExplorerMenuContext,
  normalizeExplorerMenuDescriptors,
} from "./explorerMenuDescriptors";
import type { ExplorerTreeNode } from "./explorerTreeNode";

describe("explorer menu descriptors", () => {
  it("creates stable nested ids and immutable action context", () => {
    const node: ExplorerTreeNode = {
      id: "connection:local",
      kind: "connection",
      label: "Local",
    };
    const selected = [node.id];
    const context = createExplorerMenuContext(node, selected, "postgresql");
    const descriptors = normalizeExplorerMenuDescriptors(context, [
      {
        action: "new",
        label: "New",
        children: [{ action: "new.table", label: "Table" }],
      },
      {
        action: "remove",
        label: "Remove Data Source…",
        destructive: true,
      },
    ]);
    selected.push("schema:public");

    expect(context.selectedNodeIds).toEqual([node.id]);
    expect(descriptors[0]!.id).toBe("connection:0");
    expect(descriptors[0]!.children[0]!.id).toBe("connection:0.0");
    expect(descriptors[1]!.variant).toBe("destructive");
    expect(Object.isFrozen(descriptors)).toBe(true);
  });
});
