export function clampLayoutDimension(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function bottomPanelMaximumHeight() {
  return window.innerHeight - 220;
}
