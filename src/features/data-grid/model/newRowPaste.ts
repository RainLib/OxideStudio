import type { DataGridVisualRow } from "@/lib/dataGridRows";

export const DATA_GRID_MAX_EXPANDABLE_PASTE_ROWS = 1_000;
export const DATA_GRID_MAX_EXPANDABLE_PASTE_CELLS = 100_000;

export interface DataGridPasteRange {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DataGridPasteColumn {
  columnIndex: number;
  editable: boolean;
  dataType?: string;
}

export interface DataGridNewRowPasteCell {
  columnIndex: number;
  value: string | null;
  dataType?: string;
}

export interface DataGridNewRowPastePlan {
  targetRowKey: number;
  reusableRowKeys: number[];
  rows: DataGridNewRowPasteCell[][];
}

interface PlanExpandableNewRowPasteOptions {
  target: readonly [column: number, row: number];
  selection?: DataGridPasteRange;
  selectedRows?: readonly number[];
  hasColumnSelection?: boolean;
  pastedRows: readonly (readonly (string | null)[])[];
  visualRows: readonly DataGridVisualRow[];
  pendingEdits: ReadonlyMap<string, unknown>;
  visibleColumns: readonly DataGridPasteColumn[];
}

export function isBlankDataGridDraftValue(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function nonBlankDraftRowKeys(pendingEdits: ReadonlyMap<string, unknown>) {
  const rowKeys = new Set<number>();
  for (const [key, value] of pendingEdits) {
    if (isBlankDataGridDraftValue(value)) continue;
    const separator = key.indexOf(":");
    if (separator <= 0) continue;
    const rowKey = Number(key.slice(0, separator));
    if (Number.isInteger(rowKey) && rowKey < 0) rowKeys.add(rowKey);
  }
  return rowKeys;
}

/**
 * Plan DBX-compatible expansion only for a blank draft target. Ordinary paste
 * remains owned by Glide when this returns null.
 */
export function planExpandableNewRowPaste({
  target,
  selection,
  selectedRows = [],
  hasColumnSelection = false,
  pastedRows,
  visualRows,
  pendingEdits,
  visibleColumns,
}: PlanExpandableNewRowPasteOptions): DataGridNewRowPastePlan | null {
  if (
    pastedRows.length <= 1 ||
    pastedRows.length > DATA_GRID_MAX_EXPANDABLE_PASTE_ROWS ||
    pastedRows.every((row) => row.every(isBlankDataGridDraftValue))
  ) {
    return null;
  }

  if (
    selectedRows.length > 1 ||
    (selectedRows.length === 0 && hasColumnSelection)
  ) {
    return null;
  }

  const rowSelectionTarget = selectedRows[0];
  const targetInsideSelection =
    rowSelectionTarget === undefined &&
    selection !== undefined &&
    target[0] >= selection.x &&
    target[0] < selection.x + selection.width &&
    target[1] >= selection.y &&
    target[1] < selection.y + selection.height;
  const range = targetInsideSelection ? selection : undefined;
  if (range && range.height === 1 && range.width !== 1) return null;

  const startColumn =
    rowSelectionTarget === undefined ? (range?.x ?? target[0]) : 0;
  const startRow = rowSelectionTarget ?? range?.y ?? target[1];
  if (
    !Number.isInteger(startColumn) ||
    !Number.isInteger(startRow) ||
    startColumn < 0 ||
    startRow < 0
  ) {
    return null;
  }

  const nonBlankRows = nonBlankDraftRowKeys(pendingEdits);
  const selectedRowCount = Math.max(
    1,
    rowSelectionTarget === undefined ? (range?.height ?? 1) : 1,
  );
  for (let offset = 0; offset < selectedRowCount; offset += 1) {
    const row = visualRows[startRow + offset];
    if (!row?.isNew || nonBlankRows.has(row.rowKey)) return null;
  }

  const pastedColumnCount = pastedRows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0,
  );
  const targetColumns = visibleColumns.slice(
    startColumn,
    startColumn + pastedColumnCount,
  );
  if (
    targetColumns.length === 0 ||
    targetColumns.some((column) => !column.editable)
  ) {
    return null;
  }

  const cellCount = pastedRows.reduce(
    (count, row) => count + Math.min(row.length, targetColumns.length),
    0,
  );
  if (cellCount <= 0 || cellCount > DATA_GRID_MAX_EXPANDABLE_PASTE_CELLS) {
    return null;
  }

  const reusableRowKeys: number[] = [];
  for (let rowIndex = startRow; rowIndex < visualRows.length; rowIndex += 1) {
    const row = visualRows[rowIndex];
    if (!row?.isNew || nonBlankRows.has(row.rowKey)) break;
    reusableRowKeys.push(row.rowKey);
    if (reusableRowKeys.length === pastedRows.length) break;
  }
  const targetRowKey = reusableRowKeys[0];
  if (targetRowKey === undefined) return null;

  return {
    targetRowKey,
    reusableRowKeys,
    rows: pastedRows.map((row) =>
      row.slice(0, targetColumns.length).map((value, offset) => ({
        columnIndex: targetColumns[offset]!.columnIndex,
        value,
        dataType: targetColumns[offset]!.dataType,
      })),
    ),
  };
}
