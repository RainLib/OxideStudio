import { describe, expect, it } from "vitest";
import {
  TRANSFER_LIST_OVERSCAN_ROWS,
  TRANSFER_LIST_ROW_HEIGHT,
  transferVirtualListWindow,
} from "./transferListVirtualization";

describe("transferVirtualListWindow", () => {
  it("bounds a large object inventory to the viewport and overscan", () => {
    const window = transferVirtualListWindow({
      itemCount: 50_000,
      scrollTop: 24_000,
      viewportHeight: 240,
    });

    expect(window.startIndex).toBe(1_000 - TRANSFER_LIST_OVERSCAN_ROWS);
    expect(window.endIndex - window.startIndex).toBeLessThanOrEqual(
      10 + TRANSFER_LIST_OVERSCAN_ROWS * 2,
    );
    expect(window.offsetTop).toBe(
      window.startIndex * TRANSFER_LIST_ROW_HEIGHT,
    );
    expect(window.totalHeight).toBe(50_000 * TRANSFER_LIST_ROW_HEIGHT);
  });

  it("clamps stale scroll offsets after the inventory shrinks", () => {
    const window = transferVirtualListWindow({
      itemCount: 3,
      scrollTop: Number.MAX_SAFE_INTEGER,
      viewportHeight: 48,
      overscanRows: 0,
    });

    expect(window).toEqual({
      startIndex: 1,
      endIndex: 3,
      offsetTop: 24,
      totalHeight: 72,
    });
  });

  it("handles invalid and empty dimensions without allocating rows", () => {
    expect(
      transferVirtualListWindow({
        itemCount: -1,
        scrollTop: Number.NaN,
        viewportHeight: 100,
      }),
    ).toEqual({ startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight: 0 });
    expect(
      transferVirtualListWindow({
        itemCount: 100,
        scrollTop: 0,
        viewportHeight: 0,
      }).endIndex,
    ).toBe(0);
  });
});
