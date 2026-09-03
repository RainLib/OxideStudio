import { describe, expect, it } from "vitest";
import {
  adjacentExplorerNodeId,
  resolveExplorerSelection,
} from "./explorerSelection";

describe("explorer selection", () => {
  const visibleNodeIds = ["a", "b", "c", "d"];

  it("replaces selection on a plain click", () => {
    expect(
      resolveExplorerSelection({
        visibleNodeIds,
        selectedNodeIds: ["a", "b"],
        targetNodeId: "c",
        anchorNodeId: "a",
      }).selectedNodeIds,
    ).toEqual(["c"]);
  });

  it("toggles with Ctrl or Command semantics", () => {
    expect(
      resolveExplorerSelection({
        visibleNodeIds,
        selectedNodeIds: ["a", "b"],
        targetNodeId: "b",
        anchorNodeId: "a",
        additive: true,
      }).selectedNodeIds,
    ).toEqual(["a"]);
  });

  it("selects an ordered visible range", () => {
    const result = resolveExplorerSelection({
      visibleNodeIds,
      selectedNodeIds: ["a"],
      targetNodeId: "d",
      anchorNodeId: "b",
      range: true,
    });
    expect(result.selectedNodeIds).toEqual(["b", "c", "d"]);
    expect(result.anchorNodeId).toBe("b");
  });

  it("clamps keyboard adjacency at tree boundaries", () => {
    expect(adjacentExplorerNodeId(visibleNodeIds, "a", -1)).toBe("a");
    expect(adjacentExplorerNodeId(visibleNodeIds, "d", 1)).toBe("d");
    expect(adjacentExplorerNodeId(visibleNodeIds, "missing", 1)).toBeNull();
  });
});
