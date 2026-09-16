import {
  MIN_ZOOM,
  VIEWPORT_BUCKET,
  VIEWPORT_OVERSCAN,
  type DiagramViewportWindow,
} from "@/features/schema-diagram/model/diagramConstants";
import type { SchemaDiagramLayout } from "@/lib/schemaDiagram";
import {
  buildSchemaDiagramViewportIndex,
  querySchemaDiagramViewport,
} from "@/lib/schemaDiagramViewport";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface UseDiagramViewportContext {
  layout: SchemaDiagramLayout | null;
  canvasExtent: { width: number; height: number };
}

export function useDiagramViewport({
  layout,
  canvasExtent,
}: UseDiagramViewportContext) {
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportFrameRef = useRef<number | null>(null);
  const [viewportWindow, setViewportWindow] =
    useState<DiagramViewportWindow | null>(null);

  const updateViewportWindow = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // DOM test environments and an initially hidden tab report a zero-sized
    // viewport. Treat that as "not measured" so culling cannot hide valid
    // relations before the first real ResizeObserver measurement.
    if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) {
      setViewportWindow(null);
      return;
    }
    const logicalX = viewport.scrollLeft / zoom;
    const logicalY = viewport.scrollTop / zoom;
    const next = {
      x:
        Math.floor(logicalX / VIEWPORT_BUCKET) * VIEWPORT_BUCKET -
        VIEWPORT_OVERSCAN,
      y:
        Math.floor(logicalY / VIEWPORT_BUCKET) * VIEWPORT_BUCKET -
        VIEWPORT_OVERSCAN,
      width: viewport.clientWidth / zoom + VIEWPORT_OVERSCAN * 2,
      height: viewport.clientHeight / zoom + VIEWPORT_OVERSCAN * 2,
    };
    setViewportWindow((current) =>
      current &&
      current.x === next.x &&
      current.y === next.y &&
      current.width === next.width &&
      current.height === next.height
        ? current
        : next,
    );
  }, [zoom]);

  const scheduleViewportWindowUpdate = useCallback(() => {
    if (viewportFrameRef.current !== null) return;
    viewportFrameRef.current = window.requestAnimationFrame(() => {
      viewportFrameRef.current = null;
      updateViewportWindow();
    });
  }, [updateViewportWindow]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    scheduleViewportWindowUpdate();
    const resizeObserver = new ResizeObserver(scheduleViewportWindowUpdate);
    resizeObserver.observe(viewport);
    return () => {
      resizeObserver.disconnect();
      if (viewportFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportFrameRef.current);
        viewportFrameRef.current = null;
      }
    };
  }, [layout, scheduleViewportWindowUpdate]);

  const viewportIndex = useMemo(
    () =>
      layout
        ? buildSchemaDiagramViewportIndex(layout.nodes, layout.edges)
        : null,
    [layout],
  );
  const viewportResult = useMemo(() => {
    if (!viewportIndex) return { nodes: [], edges: [] };
    const windowBounds = viewportWindow || {
      x: -VIEWPORT_OVERSCAN,
      y: -VIEWPORT_OVERSCAN,
      width: 1600 + VIEWPORT_OVERSCAN * 2,
      height: 1000 + VIEWPORT_OVERSCAN * 2,
    };
    return querySchemaDiagramViewport(viewportIndex, windowBounds);
  }, [viewportIndex, viewportWindow]);
  const viewportNodes = viewportResult.nodes;
  const viewportEdges = viewportResult.edges;

  const fitDiagram = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !layout) return;
    const horizontal =
      Math.max(0, viewport.clientWidth - 32) / canvasExtent.width;
    const vertical =
      Math.max(0, viewport.clientHeight - 32) / canvasExtent.height;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(1, horizontal, vertical));
    setZoom(nextZoom);
    viewport.scrollTo({ left: 0, top: 0 });
  }, [canvasExtent.height, canvasExtent.width, layout]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(fitDiagram);
    return () => window.cancelAnimationFrame(frame);
  }, [fitDiagram]);

  return {
    zoom,
    setZoom,
    viewportRef,
    scheduleViewportWindowUpdate,
    viewportIndex,
    viewportNodes,
    viewportEdges,
    fitDiagram,
  };
}
