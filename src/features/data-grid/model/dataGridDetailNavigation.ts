export type DataGridDetailNavigationDelta = -1 | 1;
export type DataGridDetailNavigationAxis = "row" | "column";

export function adjacentDataGridDetailIndex(
  currentIndex: number,
  delta: DataGridDetailNavigationDelta,
  itemCount: number,
) {
  const nextIndex = currentIndex + delta;
  if (
    currentIndex < 0 ||
    currentIndex >= itemCount ||
    nextIndex < 0 ||
    nextIndex >= itemCount
  ) {
    return null;
  }
  return nextIndex;
}

export function dataGridDetailNavigationDelta(
  key: string,
): { axis: DataGridDetailNavigationAxis; delta: DataGridDetailNavigationDelta } | null {
  if (key === "ArrowUp") return { axis: "row", delta: -1 };
  if (key === "ArrowDown") return { axis: "row", delta: 1 };
  if (key === "ArrowLeft") return { axis: "column", delta: -1 };
  if (key === "ArrowRight") return { axis: "column", delta: 1 };
  return null;
}

export function dataGridDetailNavigationUsesNativeKeys(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element?.closest) return false;
  return Boolean(
    element.closest(
      "input, textarea, select, [contenteditable='true'], .monaco-editor, [role='menu'], [role='listbox']",
    ),
  );
}
