import { describe, expect, it } from "vitest";
import { reorderExplorerConnectionIds } from "./explorerConnectionOrder";

describe("explorer connection manual ordering", () => {
  it("moves one connection before a target", () => {
    expect(
      reorderExplorerConnectionIds(["a", "b", "c"], ["c"], "a", "before"),
    ).toEqual(["c", "a", "b"]);
  });

  it("preserves display order for a multi-row move", () => {
    expect(
      reorderExplorerConnectionIds(
        ["a", "b", "c", "d"],
        ["c", "a"],
        "d",
        "before",
      ),
    ).toEqual(["b", "a", "c", "d"]);
  });

  it("ignores a drop onto the moving selection", () => {
    expect(
      reorderExplorerConnectionIds(["a", "b", "c"], ["a", "b"], "b", "after"),
    ).toEqual(["a", "b", "c"]);
  });
});
