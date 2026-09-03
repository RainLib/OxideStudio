import { describe, expect, it } from "vitest";
import type { ExplorerConnectionGroup } from "@/store/useDatabaseExplorerStore";
import {
  EXPLORER_CONNECTION_DRAG_TYPE,
  explorerConnectionGroupAncestorsExpanded,
  explorerConnectionGroupDepth,
  readExplorerDraggedConnectionIds,
} from "./ExplorerConnectionGroupRow";

const groups: ExplorerConnectionGroup[] = [
  { id: "root", name: "Root", parentId: null },
  { id: "child", name: "Child", parentId: "root" },
  { id: "leaf", name: "Leaf", parentId: "child" },
];
const groupMap = new Map(groups.map((group) => [group.id, group]));

describe("ExplorerConnectionGroupRow helpers", () => {
  it("calculates nesting and ancestor visibility", () => {
    expect(explorerConnectionGroupDepth(groups[2]!, groupMap)).toBe(2);
    expect(
      explorerConnectionGroupAncestorsExpanded(groups[2]!, groupMap, [
        "root",
        "child",
      ]),
    ).toBe(true);
    expect(
      explorerConnectionGroupAncestorsExpanded(groups[2]!, groupMap, [
        "root",
      ]),
    ).toBe(false);
  });

  it("accepts only string connection ids from drag payloads", () => {
    const transfer = {
      getData: (type: string) =>
        type === EXPLORER_CONNECTION_DRAG_TYPE
          ? JSON.stringify(["one", 2, null, "two"])
          : "",
    } as DataTransfer;
    expect(readExplorerDraggedConnectionIds(transfer)).toEqual(["one", "two"]);
  });
});
