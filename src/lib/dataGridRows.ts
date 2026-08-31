export interface NewGridRowPlacement {
  anchorRowKey: number;
  position: "below";
}

export interface DataGridVisualRow {
  rowKey: number;
  isNew: boolean;
}

/**
 * Merge pending rows into the visible source order without mutating query data.
 * Clones remain directly below their source (including another pending row),
 * while ordinary new rows and clones whose source is filtered out stay at the end.
 */
export function buildDataGridVisualRows(
  sourceRowKeys: readonly number[],
  newRowsCount: number,
  placements: readonly (NewGridRowPlacement | null)[] = [],
): DataGridVisualRow[] {
  const pendingKeys = Array.from({ length: Math.max(0, newRowsCount) }, (_, offset) =>
    -1 - offset,
  );
  const children = new Map<number, number[]>();

  for (const rowKey of pendingKeys) {
    const placement = placements[-rowKey - 1];
    if (!placement || placement.position !== "below" || placement.anchorRowKey === rowKey) {
      continue;
    }
    const anchored = children.get(placement.anchorRowKey) || [];
    anchored.push(rowKey);
    children.set(placement.anchorRowKey, anchored);
  }

  const rows: DataGridVisualRow[] = [];
  const emitted = new Set<number>();
  const emit = (rowKey: number, ancestry?: Set<number>) => {
    if (emitted.has(rowKey) || ancestry?.has(rowKey)) return;
    emitted.add(rowKey);
    rows.push({ rowKey, isNew: rowKey < 0 });
    const anchoredRows = children.get(rowKey);
    if (!anchoredRows?.length) return;
    const nextAncestry = new Set(ancestry).add(rowKey);
    for (const child of anchoredRows) emit(child, nextAncestry);
  };

  for (const rowKey of sourceRowKeys) emit(rowKey);
  for (const rowKey of pendingKeys) {
    if (!emitted.has(rowKey)) emit(rowKey);
  }
  return rows;
}
