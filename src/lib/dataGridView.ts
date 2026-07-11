export const GRID_ZOOM_MIN = 70;
export const GRID_ZOOM_MAX = 160;
export const GRID_ZOOM_STEP = 10;

export function clampGridZoom(zoomPercent: number) {
  return Math.min(GRID_ZOOM_MAX, Math.max(GRID_ZOOM_MIN, zoomPercent));
}

export function stepGridZoom(zoomPercent: number, direction: -1 | 1) {
  return clampGridZoom(zoomPercent + direction * GRID_ZOOM_STEP);
}

export function dataGridMetrics(
  fontSize: number,
  rowHeight: number,
  zoomPercent: number
) {
  const normalizedZoom = clampGridZoom(zoomPercent);
  const scale = normalizedZoom / 100;

  return {
    zoomPercent: normalizedZoom,
    scale,
    fontSize: Math.round(fontSize * scale * 10) / 10,
    rowHeight: Math.round(rowHeight * scale),
    headerHeight: Math.max(26, Math.round(rowHeight * scale)),
    rowMarkerWidth: Math.max(36, Math.round(42 * scale)),
  };
}
