export const TRANSFER_LIST_VIRTUALIZATION_THRESHOLD = 200;
export const TRANSFER_LIST_ROW_HEIGHT = 24;
export const TRANSFER_LIST_OVERSCAN_ROWS = 8;

export interface TransferVirtualListWindowOptions {
  itemCount: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight?: number;
  overscanRows?: number;
}

export interface TransferVirtualListWindow {
  startIndex: number;
  endIndex: number;
  offsetTop: number;
  totalHeight: number;
}

/**
 * Computes the bounded DOM slice for transfer pickers. Selection remains in
 * the full model; only row rendering is windowed.
 */
export function transferVirtualListWindow(
  options: TransferVirtualListWindowOptions,
): TransferVirtualListWindow {
  const itemCount = Math.max(0, Math.floor(options.itemCount));
  const rowHeight = Math.max(
    1,
    Math.floor(options.rowHeight ?? TRANSFER_LIST_ROW_HEIGHT),
  );
  const overscanRows = Math.max(
    0,
    Math.floor(options.overscanRows ?? TRANSFER_LIST_OVERSCAN_ROWS),
  );
  const viewportHeight = Math.max(0, options.viewportHeight);
  const totalHeight = itemCount * rowHeight;
  if (itemCount === 0 || viewportHeight === 0) {
    return { startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight };
  }

  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
  const scrollTop = Math.min(
    maxScrollTop,
    Math.max(0, Number.isFinite(options.scrollTop) ? options.scrollTop : 0),
  );
  const firstVisible = Math.floor(scrollTop / rowHeight);
  const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const startIndex = Math.max(0, firstVisible - overscanRows);
  const endIndex = Math.min(
    itemCount,
    firstVisible + visibleRows + overscanRows,
  );

  return {
    startIndex,
    endIndex,
    offsetTop: startIndex * rowHeight,
    totalHeight,
  };
}
