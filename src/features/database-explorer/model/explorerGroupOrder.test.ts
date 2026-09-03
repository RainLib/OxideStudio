import { describe, expect, it } from "vitest";
import {
  orderExplorerConnectionGroups,
  placeExplorerConnectionGroup,
} from "./explorerGroupOrder";

describe("database explorer connection group ordering", () => {
  const groups = [
    { id: "root-a", name: "A", parentId: null },
    { id: "root-b", name: "B", parentId: null },
    { id: "child-a", name: "A child", parentId: "root-a" },
    { id: "grandchild-a", name: "A grandchild", parentId: "child-a" },
  ];

  it("renders descendants directly after their parent", () => {
    expect(orderExplorerConnectionGroups(groups).map((group) => group.id)).toEqual([
      "root-a",
      "child-a",
      "grandchild-a",
      "root-b",
    ]);
  });

  it("moves a group before a sibling without losing its descendants", () => {
    const next = placeExplorerConnectionGroup(
      groups,
      "root-b",
      "root-a",
      "before",
    );
    expect(orderExplorerConnectionGroups(next).map((group) => group.id)).toEqual([
      "root-b",
      "root-a",
      "child-a",
      "grandchild-a",
    ]);
  });

  it("reparents a group when dropped inside another group", () => {
    const next = placeExplorerConnectionGroup(
      groups,
      "root-b",
      "child-a",
      "inside",
    );
    expect(next.find((group) => group.id === "root-b")?.parentId).toBe(
      "child-a",
    );
    expect(orderExplorerConnectionGroups(next).map((group) => group.id)).toEqual([
      "root-a",
      "child-a",
      "grandchild-a",
      "root-b",
    ]);
  });

  it("rejects drops that would create a cycle", () => {
    expect(
      placeExplorerConnectionGroup(groups, "root-a", "grandchild-a", "inside"),
    ).toEqual(groups);
  });
});
