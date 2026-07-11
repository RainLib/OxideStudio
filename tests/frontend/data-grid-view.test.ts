import { describe, expect, it } from "vitest";
import {
  GRID_ZOOM_MAX,
  GRID_ZOOM_MIN,
  clampGridZoom,
  dataGridMetrics,
  stepGridZoom,
} from "@/lib/dataGridView";

describe("data grid view metrics", () => {
  it("clamps toolbar zoom steps", () => {
    expect(stepGridZoom(100, 1)).toBe(110);
    expect(stepGridZoom(GRID_ZOOM_MAX, 1)).toBe(GRID_ZOOM_MAX);
    expect(stepGridZoom(GRID_ZOOM_MIN, -1)).toBe(GRID_ZOOM_MIN);
    expect(clampGridZoom(20)).toBe(GRID_ZOOM_MIN);
  });

  it("scales font, rows, headers, and row markers together", () => {
    expect(dataGridMetrics(12, 28, 125)).toEqual({
      zoomPercent: 125,
      scale: 1.25,
      fontSize: 15,
      rowHeight: 35,
      headerHeight: 35,
      rowMarkerWidth: 53,
    });
  });
});
