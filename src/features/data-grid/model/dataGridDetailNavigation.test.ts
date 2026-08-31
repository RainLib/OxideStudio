import { describe, expect, it } from "vitest";
import {
  adjacentDataGridDetailIndex,
  dataGridDetailNavigationDelta,
  dataGridDetailNavigationUsesNativeKeys,
} from "./dataGridDetailNavigation";

describe("data grid detail navigation", () => {
  it("moves only to adjacent in-range items", () => {
    expect(adjacentDataGridDetailIndex(1, -1, 3)).toBe(0);
    expect(adjacentDataGridDetailIndex(1, 1, 3)).toBe(2);
    expect(adjacentDataGridDetailIndex(0, -1, 3)).toBeNull();
    expect(adjacentDataGridDetailIndex(2, 1, 3)).toBeNull();
    expect(adjacentDataGridDetailIndex(-1, 1, 3)).toBeNull();
  });

  it("maps vertical arrows to rows and horizontal arrows to columns", () => {
    expect(dataGridDetailNavigationDelta("ArrowUp")).toEqual({ axis: "row", delta: -1 });
    expect(dataGridDetailNavigationDelta("ArrowDown")).toEqual({ axis: "row", delta: 1 });
    expect(dataGridDetailNavigationDelta("ArrowLeft")).toEqual({ axis: "column", delta: -1 });
    expect(dataGridDetailNavigationDelta("ArrowRight")).toEqual({ axis: "column", delta: 1 });
    expect(dataGridDetailNavigationDelta("Enter")).toBeNull();
  });

  it("does not steal arrow keys from editors and form controls", () => {
    const nativeControl = {
      closest: (selector: string) => (selector.includes("input") ? {} : null),
    } as unknown as EventTarget;
    const editorChild = {
      closest: (selector: string) => (selector.includes(".monaco-editor") ? {} : null),
    } as unknown as EventTarget;
    const plain = {
      closest: () => null,
    } as unknown as EventTarget;

    expect(dataGridDetailNavigationUsesNativeKeys(nativeControl)).toBe(true);
    expect(dataGridDetailNavigationUsesNativeKeys(editorChild)).toBe(true);
    expect(dataGridDetailNavigationUsesNativeKeys(plain)).toBe(false);
  });
});
