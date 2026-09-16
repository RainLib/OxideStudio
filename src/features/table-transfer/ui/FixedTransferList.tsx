import {
  TRANSFER_LIST_ROW_HEIGHT,
  TRANSFER_LIST_VIRTUALIZATION_THRESHOLD,
  transferVirtualListWindow,
} from "@/features/database-explorer/model/transferListVirtualization";
import { useEffect, useMemo, useState, type ReactNode } from "react";

interface FixedTransferListProps<T> {
  items: readonly T[];
  scopeKey: string;
  viewportHeight: number;
  className?: string;
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}

export function FixedTransferList<T>({
  items,
  scopeKey,
  viewportHeight,
  className,
  itemKey,
  renderItem,
}: FixedTransferListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const virtualized = items.length > TRANSFER_LIST_VIRTUALIZATION_THRESHOLD;
  const window = useMemo(
    () =>
      transferVirtualListWindow({
        itemCount: items.length,
        scrollTop,
        viewportHeight,
      }),
    [items.length, scrollTop, viewportHeight],
  );

  useEffect(() => setScrollTop(0), [scopeKey]);

  if (!virtualized) {
    return (
      <div className={className}>
        {items.map((item) => (
          <div key={itemKey(item)}>{renderItem(item)}</div>
        ))}
      </div>
    );
  }

  const visibleItems = items.slice(window.startIndex, window.endIndex);
  return (
    <div
      className={className}
      data-transfer-list-virtualized="true"
      style={{
        height: Math.min(viewportHeight, window.totalHeight),
        overflowY: "auto",
      }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: window.totalHeight, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: window.offsetTop,
          }}
        >
          {visibleItems.map((item) => (
            <div
              key={itemKey(item)}
              style={{ height: TRANSFER_LIST_ROW_HEIGHT }}
            >
              {renderItem(item)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
