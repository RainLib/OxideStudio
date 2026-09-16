import { resolveToolbarOverflowState } from "@/lib/toolbarOverflow";
import type { QueryResult } from "@/services/tauri/types/query";
import type { GridTabSnapshot } from "../model/gridTypes";

import { useEffect, useRef, useState } from "react";

interface GridQueryToolbarOptions {
  activeTab: GridTabSnapshot | null;
  result: QueryResult | undefined;
  isTransposed: boolean;
}

export function useGridQueryToolbar({
  activeTab,
  result,
  isTransposed,
}: GridQueryToolbarOptions) {
  const queryToolbarRef = useRef<HTMLDivElement>(null);
  const queryToolbarExpandedWidthRef = useRef(0);
  const [queryToolbarCompact, setQueryToolbarCompact] = useState(false);

  const queryToolbarVisible = activeTab?.type !== "table" && Boolean(result);
  const queryToolbarStructureKey = [
    queryToolbarVisible,
    Boolean(result?.truncated),
    isTransposed,
  ].join(":");

  useEffect(() => {
    const toolbar = queryToolbarRef.current;
    if (!toolbar || !queryToolbarVisible) return;
    queryToolbarExpandedWidthRef.current = 0;
    setQueryToolbarCompact(false);

    const measure = () => {
      setQueryToolbarCompact((compact) => {
        const next = resolveToolbarOverflowState(
          {
            compact,
            expandedRequiredWidth: queryToolbarExpandedWidthRef.current,
          },
          toolbar.clientWidth,
          toolbar.scrollWidth,
        );
        queryToolbarExpandedWidthRef.current = next.expandedRequiredWidth;
        return next.compact;
      });
    };

    const frame = window.requestAnimationFrame(measure);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    resizeObserver?.observe(toolbar);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(measure);
    mutationObserver?.observe(toolbar, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [queryToolbarStructureKey, queryToolbarVisible]);

  return { queryToolbarRef, queryToolbarCompact };
}
