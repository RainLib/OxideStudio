import {
  createContext,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EXPLORER_TREE_ROW_HEIGHT,
  explorerVirtualWindow,
  nextExplorerVirtualizationState,
} from "../runtime/explorerFlatTree";
import { cn } from "@/lib/utils";

interface ExplorerVirtualListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  rowHeight?: number;
  disabled?: boolean;
  className?: string;
}

interface ExplorerSegmentedVirtualListProps<T> extends Omit<
  ExplorerVirtualListProps<T>,
  "disabled"
> {
  isExpanded: (item: T, index: number) => boolean;
}

interface ViewportMetrics {
  scrollTop: number;
  viewportHeight: number;
}

interface ExplorerVirtualizationContextValue {
  readonly windowAllDirectories: boolean;
  readonly registerDirectory: (id: string, rowCount: number) => void;
  readonly unregisterDirectory: (id: string) => void;
}

const ExplorerVirtualizationContext =
  createContext<ExplorerVirtualizationContextValue | null>(null);

/**
 * Coordinates every fixed-height directory in one explorer viewport. Once
 * their combined visible rows cross the DBX threshold, even individually
 * small directories participate in windowing instead of accumulating DOM.
 */
export function ExplorerVirtualizationHost({
  children,
}: {
  children: ReactNode;
}) {
  const [directoryCounts, setDirectoryCounts] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const totalRows = useMemo(
    () =>
      [...directoryCounts.values()].reduce(
        (sum, rowCount) => sum + rowCount,
        0,
      ),
    [directoryCounts],
  );
  const [windowAllDirectories, setWindowAllDirectories] = useState(false);
  useEffect(() => {
    setWindowAllDirectories((current) =>
      nextExplorerVirtualizationState(current, totalRows),
    );
  }, [totalRows]);
  const registerDirectory = useCallback((id: string, rowCount: number) => {
    setDirectoryCounts((current) => {
      if (current.get(id) === rowCount) return current;
      const next = new Map(current);
      next.set(id, rowCount);
      return next;
    });
  }, []);
  const unregisterDirectory = useCallback((id: string) => {
    setDirectoryCounts((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);
  const value = useMemo(
    () => ({
      windowAllDirectories,
      registerDirectory,
      unregisterDirectory,
    }),
    [registerDirectory, unregisterDirectory, windowAllDirectories],
  );
  return (
    <ExplorerVirtualizationContext.Provider value={value}>
      {children}
    </ExplorerVirtualizationContext.Provider>
  );
}

const INITIAL_METRICS: ViewportMetrics = {
  scrollTop: 0,
  viewportHeight: 480,
};

/**
 * Windows a fixed-height explorer directory against the shared sidebar
 * scroller. It deliberately has no nested scrollbar, so wheel, keyboard and
 * reveal behaviour remain identical to a normal tree.
 */
export function ExplorerVirtualList<T>({
  items,
  getKey,
  renderItem,
  rowHeight = EXPLORER_TREE_ROW_HEIGHT,
  disabled = false,
  className,
}: ExplorerVirtualListProps<T>) {
  const directoryId = useId();
  const virtualization = useContext(ExplorerVirtualizationContext);
  const registerDirectory = virtualization?.registerDirectory;
  const unregisterDirectory = virtualization?.unregisterDirectory;
  const hostRef = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(
    () => !disabled && nextExplorerVirtualizationState(false, items.length),
  );
  const [metrics, setMetrics] = useState(INITIAL_METRICS);

  useLayoutEffect(() => {
    if (!registerDirectory || !unregisterDirectory) return;
    registerDirectory(directoryId, disabled ? 0 : items.length);
    return () => unregisterDirectory(directoryId);
  }, [
    directoryId,
    disabled,
    items.length,
    registerDirectory,
    unregisterDirectory,
  ]);

  const shouldWindow =
    !disabled && (armed || Boolean(virtualization?.windowAllDirectories));
  const updateMetrics = useCallback(() => {
    const host = hostRef.current;
    const scroller = host?.closest<HTMLElement>("[data-explorer-scroll-root]");
    if (!host || !scroller) return;
    const hostRect = host.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const hostOffset = hostRect.top - scrollerRect.top + scroller.scrollTop;
    const next = {
      scrollTop: scroller.scrollTop - hostOffset,
      viewportHeight: scroller.clientHeight,
    };
    setMetrics((current) =>
      current.scrollTop === next.scrollTop &&
      current.viewportHeight === next.viewportHeight
        ? current
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    setArmed((current) =>
      disabled ? false : nextExplorerVirtualizationState(current, items.length),
    );
  }, [disabled, items.length]);

  useLayoutEffect(() => {
    if (!shouldWindow) return;
    const host = hostRef.current;
    const scroller = host?.closest<HTMLElement>("[data-explorer-scroll-root]");
    if (!host || !scroller) return;
    updateMetrics();
    scroller.addEventListener("scroll", updateMetrics, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateMetrics);
    observer?.observe(scroller);
    observer?.observe(host);
    return () => {
      scroller.removeEventListener("scroll", updateMetrics);
      observer?.disconnect();
    };
  }, [shouldWindow, updateMetrics]);

  if (!shouldWindow) {
    return (
      <div ref={hostRef} className={className} data-virtualized="false">
        {items.map(renderItem)}
      </div>
    );
  }

  const window = explorerVirtualWindow(
    items.length,
    metrics.scrollTop,
    metrics.viewportHeight,
    rowHeight,
  );
  const visibleItems = items.slice(window.start, window.end);
  const hostStyle: CSSProperties = { height: window.totalHeight };
  const windowStyle: CSSProperties = {
    transform: `translateY(${window.offsetTop}px)`,
  };
  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>("[data-explorer-virtual-index]");
    if (!row) return;
    const index = Number(row.dataset.explorerVirtualIndex);
    const targetIndex = index + (event.key === "ArrowDown" ? 1 : -1);
    if (
      !Number.isInteger(index) ||
      targetIndex < 0 ||
      targetIndex >= items.length ||
      (targetIndex >= window.start && targetIndex < window.end)
    ) {
      return;
    }
    const host = hostRef.current;
    const scroller = host?.closest<HTMLElement>("[data-explorer-scroll-root]");
    if (!host || !scroller) return;
    event.preventDefault();
    event.stopPropagation();
    const hostRect = host.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const hostOffset = hostRect.top - scrollerRect.top + scroller.scrollTop;
    scroller.scrollTop =
      hostOffset +
      targetIndex * rowHeight -
      (event.key === "ArrowDown" ? scroller.clientHeight - rowHeight : 0);
    scroller.dispatchEvent(new Event("scroll"));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const nextRow = host.querySelector<HTMLElement>(
          `[data-explorer-virtual-index="${targetIndex}"]`,
        );
        nextRow
          ?.querySelector<HTMLElement>(
            '[role="treeitem"],button,[tabindex]:not([tabindex="-1"])',
          )
          ?.focus();
      });
    });
  };

  return (
    <div
      ref={hostRef}
      className={cn("relative", className)}
      style={hostStyle}
      data-virtualized="true"
      data-row-count={items.length}
      onKeyDownCapture={handleKeyDownCapture}
    >
      <div className="absolute inset-x-0 top-0" style={windowStyle}>
        {visibleItems.map((item, offset) => {
          const index = window.start + offset;
          return (
            <div
              key={getKey(item, index)}
              data-explorer-virtual-index={index}
              style={{ height: rowHeight }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Keeps expanded variable-height rows in normal flow while windowing every
 * fixed-height run around them. This avoids disabling an entire 10k-object
 * directory merely because one table has its metadata open.
 */
export function ExplorerSegmentedVirtualList<T>({
  items,
  getKey,
  renderItem,
  isExpanded,
  rowHeight,
  className,
}: ExplorerSegmentedVirtualListProps<T>) {
  const segments: Array<
    | { kind: "fixed"; start: number; items: readonly T[] }
    | { kind: "expanded"; index: number; item: T }
  > = [];
  let fixedStart = 0;
  for (let index = 0; index < items.length; index += 1) {
    if (!isExpanded(items[index]!, index)) continue;
    if (fixedStart < index) {
      segments.push({
        kind: "fixed",
        start: fixedStart,
        items: items.slice(fixedStart, index),
      });
    }
    segments.push({ kind: "expanded", index, item: items[index]! });
    fixedStart = index + 1;
  }
  if (fixedStart < items.length) {
    segments.push({
      kind: "fixed",
      start: fixedStart,
      items: fixedStart === 0 ? items : items.slice(fixedStart),
    });
  }

  return (
    <div className={className} data-explorer-segmented-list>
      {segments.map((segment) => {
        if (segment.kind === "expanded") {
          return (
            <div key={`expanded:${getKey(segment.item, segment.index)}`}>
              {renderItem(segment.item, segment.index)}
            </div>
          );
        }
        return (
          <ExplorerVirtualList
            key={`fixed:${segment.start}:${segment.items.length}`}
            items={segment.items}
            rowHeight={rowHeight}
            getKey={(item, index) => getKey(item, segment.start + index)}
            renderItem={(item, index) =>
              renderItem(item, segment.start + index)
            }
          />
        );
      })}
    </div>
  );
}
