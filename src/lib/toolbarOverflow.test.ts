import { describe, expect, it } from "vitest";
import { resolveToolbarOverflowState } from "./toolbarOverflow";

describe("resolveToolbarOverflowState", () => {
  it("compacts when expanded actions overflow", () => {
    expect(
      resolveToolbarOverflowState(
        { compact: false, expandedRequiredWidth: 0 },
        420,
        560,
      ),
    ).toEqual({ compact: true, expandedRequiredWidth: 560 });
  });

  it("expands only after the full toolbar fits again", () => {
    const compact = { compact: true, expandedRequiredWidth: 560 };
    expect(resolveToolbarOverflowState(compact, 500, 410)).toEqual(compact);
    expect(resolveToolbarOverflowState(compact, 560, 410)).toEqual({
      compact: false,
      expandedRequiredWidth: 0,
    });
  });
});
