import { describe, expect, it } from "vitest";
import {
  createExplorerActionRequest,
  createExplorerActionTarget,
  findExplorerActionTarget,
} from "./explorerActionTarget";
import type { ExplorerTreeNode } from "./explorerTreeNode";

describe("explorer action targets", () => {
  const child: ExplorerTreeNode = {
    id: "table:orders",
    kind: "table",
    label: "orders",
    connectionId: "local",
    schema: "public",
  };
  const root: ExplorerTreeNode = {
    id: "schema:public",
    kind: "schema",
    label: "public",
    metadata: { owner: "postgres" },
    children: [child],
  };

  it("does not retain child trees and freezes action identity", () => {
    const target = createExplorerActionTarget(root);
    expect("children" in target).toBe(false);
    expect(Object.isFrozen(target)).toBe(true);
    expect(Object.isFrozen(target.metadata)).toBe(true);
  });

  it("resolves a snapshot against the latest tree", () => {
    expect(findExplorerActionTarget([root], createExplorerActionTarget(child))).toBe(
      child,
    );
  });

  it("copies selection before an async action can observe it", () => {
    const selected = [root.id];
    const request = createExplorerActionRequest(root, selected, { force: true });
    selected.push(child.id);
    expect(request.selectedNodeIds).toEqual([root.id]);
    expect(Object.isFrozen(request.selectedNodeIds)).toBe(true);
  });
});
