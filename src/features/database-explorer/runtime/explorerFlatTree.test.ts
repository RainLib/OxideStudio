import { describe, expect, it } from "vitest";
import type { ExplorerTreeNode } from "../model/explorerTreeNode";
import {
  EXPLORER_TREE_VIRTUALIZE_THRESHOLD,
  createExplorerFlatTreeIndex,
  explorerVirtualWindow,
  flatExplorerRowsChanged,
  flattenExplorerTree,
  nextExplorerVirtualizationState,
} from "./explorerFlatTree";

describe("explorer flat tree runtime", () => {
  const child: ExplorerTreeNode = {
    id: "schema:public",
    kind: "schema",
    label: "public",
  };
  const root: ExplorerTreeNode = {
    id: "connection:local",
    kind: "connection",
    label: "Local",
    children: [child],
  };

  it("flattens only expanded branches with ancestry-safe recycler keys", () => {
    const collapsed = flattenExplorerTree([root], new Set());
    const expanded = flattenExplorerTree([root], new Set([root.id]));
    expect(collapsed.map((row) => row.id)).toEqual([root.id]);
    expect(expanded.map((row) => row.id)).toEqual([root.id, child.id]);
    expect(expanded[1]!.renderKey).toContain(root.id);
    expect(expanded[1]!.depth).toBe(1);
  });

  it("builds constant-time lookup indexes", () => {
    const rows = flattenExplorerTree([root], new Set([root.id]));
    const index = createExplorerFlatTreeIndex(rows);
    expect(index.flatNodeIndexById.get(child.id)).toBe(1);
    expect(index.nodeById.get(root.id)).toBe(root);
    expect(index.expandableNodeIds).toEqual([root.id]);
  });

  it("detects material row changes", () => {
    const rows = flattenExplorerTree([root], new Set([root.id]));
    expect(flatExplorerRowsChanged(rows, rows)).toBe(false);
    expect(flatExplorerRowsChanged(rows, rows.slice(0, 1))).toBe(true);
  });

  it("uses hysteresis to avoid remounting near the threshold", () => {
    expect(
      nextExplorerVirtualizationState(
        false,
        EXPLORER_TREE_VIRTUALIZE_THRESHOLD,
      ),
    ).toBe(true);
    expect(
      nextExplorerVirtualizationState(
        true,
        EXPLORER_TREE_VIRTUALIZE_THRESHOLD - 20,
      ),
    ).toBe(true);
    expect(
      nextExplorerVirtualizationState(
        true,
        EXPLORER_TREE_VIRTUALIZE_THRESHOLD - 60,
      ),
    ).toBe(false);
  });

  it("calculates buffered fixed-row windows", () => {
    expect(explorerVirtualWindow(1_000, 2_400, 480, 24, 240)).toEqual({
      start: 90,
      end: 130,
      offsetTop: 2_160,
      totalHeight: 24_000,
    });
  });

  it("mounts no rows for directories outside the buffered viewport", () => {
    expect(explorerVirtualWindow(300, -2_000, 480, 24, 240)).toEqual({
      start: 0,
      end: 0,
      offsetTop: 0,
      totalHeight: 7_200,
    });
    expect(explorerVirtualWindow(300, 9_000, 480, 24, 240)).toEqual({
      start: 300,
      end: 300,
      offsetTop: 7_200,
      totalHeight: 7_200,
    });
  });
});
