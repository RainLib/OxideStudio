import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  Check,
  Columns3,
  Crosshair,
  Download,
  ExternalLink,
  FileCode2,
  FolderInput,
  FolderPlus,
  GitCompareArrows,
  KeyRound,
  LayoutGrid,
  Minus,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  Search,
  Table2,
  Undo2,
  X,
} from "lucide-react";
import {
  buildSchemaDiagram,
  diagramColumnOffset,
  schemaDiagramRelatedRelationNames,
  type SchemaDiagramEdge,
  type SchemaDiagramNode,
} from "@/lib/schemaDiagram";
import {
  rasterizeSchemaDiagramSvg,
  serializeSchemaDiagramToSvg,
  type SchemaDiagramRasterFormat,
} from "@/lib/schemaDiagramSvg";
import {
  applySchemaDiagramAreas,
  autoArrangeSchemaDiagramArea,
  commitSchemaDiagramAreas,
  createSchemaDiagramAreaHistory,
  moveSchemaDiagramRelationsToArea,
  removeSchemaDiagramRelationsFromAreas,
  redoSchemaDiagramAreas,
  undoSchemaDiagramAreas,
} from "@/lib/schemaDiagramAreas";
import {
  buildSchemaDiagramViewportIndex,
  querySchemaDiagramViewport,
} from "@/lib/schemaDiagramViewport";
import { downloadBlob, downloadText } from "@/lib/exportUtils";
import { serializeSchemaSnapshotToDbml } from "@/features/schema-diff/model/schemaDbml";
import { SchemaDbmlDraftDialog } from "./SchemaDbmlDraftDialog";
import { requestDatabaseObjectReveal } from "@/lib/databaseNavigation";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useTabStore } from "@/store/useTabStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.6;
const VIEWPORT_OVERSCAN = 320;
const VIEWPORT_BUCKET = 160;
const EMPTY_AREA_HISTORY = createSchemaDiagramAreaHistory();
const loadSchemaStructuredDraftDialog = () =>
  import("./SchemaStructuredDraftDialog");
const SchemaStructuredDraftDialog = lazy(() =>
  loadSchemaStructuredDraftDialog().then((module) => ({
    default: module.SchemaStructuredDraftDialog,
  })),
);

type DiagramViewportWindow = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function SchemaDiagramView() {
  const {
    tabs,
    activeTabId,
    selectSchemaDiagramRelation,
    setSchemaDiagramAreaHistory,
    selectSchemaDiagramArea,
    selectSchemaDiagramRelations,
  } = useTabStore();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection);
  const setActiveToolWindow = useWorkbenchLayoutStore(
    (state) => state.setActiveToolWindow,
  );
  const [query, setQuery] = useState("");
  const [keysOnly, setKeysOnly] = useState(false);
  const [relationScope, setRelationScope] = useState<"all" | "related" | "area">("all");
  const [zoom, setZoom] = useState(1);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [exportScope, setExportScope] = useState<"filtered" | "full">("filtered");
  const [exportBackground, setExportBackground] = useState<"dark" | "light" | "transparent">("dark");
  const [isRasterizing, setIsRasterizing] = useState(false);
  const [dbmlDraftOpen, setDbmlDraftOpen] = useState(false);
  const [structuredDraftOpen, setStructuredDraftOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportFrameRef = useRef<number | null>(null);
  const [viewportWindow, setViewportWindow] =
    useState<DiagramViewportWindow | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const snapshot = activeTab?.schemaDiagramSnapshot;
  const areaHistory = activeTab?.schemaDiagramAreaHistory || EMPTY_AREA_HISTORY;
  const selectedAreaId = activeTab?.selectedDiagramAreaId || "";
  const activeSelectedRelationName = activeTab?.selectedDiagramRelationName || null;
  const selectedRelationNames = useMemo(
    () =>
      new Set(
        activeTab?.selectedDiagramRelationNames?.length
          ? activeTab.selectedDiagramRelationNames
          : activeTab?.selectedDiagramRelationName
            ? [activeTab.selectedDiagramRelationName]
            : [],
      ),
    [
      activeTab?.selectedDiagramRelationName,
      activeTab?.selectedDiagramRelationNames,
    ],
  );
  const scopedRelationNames = useMemo(() => {
    if (!snapshot || relationScope === "all") return undefined;
    if (relationScope === "related") {
      return activeSelectedRelationName
        ? schemaDiagramRelatedRelationNames(snapshot, activeSelectedRelationName)
        : new Set<string>();
    }
    return new Set(
      areaHistory.present.find((area) => area.id === selectedAreaId)
        ?.relationNames || [],
    );
  }, [
    activeSelectedRelationName,
    areaHistory.present,
    relationScope,
    selectedAreaId,
    snapshot,
  ]);
  const baseLayout = useMemo(
    () =>
      snapshot
        ? buildSchemaDiagram(snapshot, {
            query,
            keysOnly,
            maxColumns: 18,
            relationNames: scopedRelationNames,
          })
        : null,
    [keysOnly, query, scopedRelationNames, snapshot],
  );
  const fullBaseLayout = useMemo(
    // Keep coordinates identical to the visible unfiltered layout. A second
    // 50-column layout made related-table focus scroll to the wrong location
    // and inflated work for wide schemas.
    () => (snapshot ? buildSchemaDiagram(snapshot, { maxColumns: 18 }) : null),
    [snapshot],
  );
  const areaLayout = useMemo(
    () =>
      baseLayout
        ? applySchemaDiagramAreas(baseLayout, areaHistory.present)
        : null,
    [areaHistory.present, baseLayout],
  );
  const fullAreaLayout = useMemo(
    () =>
      fullBaseLayout
        ? applySchemaDiagramAreas(fullBaseLayout, areaHistory.present)
        : null,
    [areaHistory.present, fullBaseLayout],
  );
  const layout = areaLayout?.layout || null;
  const fullLayout = fullAreaLayout?.layout || null;
  const areaBounds = areaLayout?.areaBounds || [];

  useEffect(() => {
    setRelationScope("all");
  }, [snapshot?.id]);

  const exportSvg = useCallback(() => {
    const exportLayout = exportScope === "full" ? fullLayout : layout;
    if (!snapshot || !exportLayout) return;
    const basename =
      `${snapshot.connectionName}-${snapshot.schemaName}-diagram`
        .replace(/[^A-Za-z0-9._-]+/gu, "-")
        .replace(/^-+|-+$/gu, "") || "schema-diagram";
    downloadText(
      serializeSchemaDiagramToSvg(exportLayout, {
        title: `${snapshot.connectionName} / ${snapshot.schemaName}`,
        background:
          exportBackground === "dark"
            ? "#11151c"
            : exportBackground === "light"
              ? "#ffffff"
              : "transparent",
      }),
      `${basename}.svg`,
      "image/svg+xml;charset=utf-8",
    );
  }, [exportBackground, exportScope, fullLayout, layout, snapshot]);

  const exportRaster = useCallback(async (format: SchemaDiagramRasterFormat) => {
    const exportLayout = exportScope === "full" ? fullLayout : layout;
    if (!snapshot || !exportLayout || isRasterizing) return;
    const basename =
      `${snapshot.connectionName}-${snapshot.schemaName}-diagram`
        .replace(/[^A-Za-z0-9._-]+/gu, "-")
        .replace(/^-+|-+$/gu, "") || "schema-diagram";
    const background = format === "jpeg" && exportBackground === "transparent"
      ? "#ffffff"
      : exportBackground === "dark"
        ? "#11151c"
        : exportBackground === "light"
          ? "#ffffff"
          : "transparent";
    setIsRasterizing(true);
    try {
      const svg = serializeSchemaDiagramToSvg(exportLayout, {
        title: `${snapshot.connectionName} / ${snapshot.schemaName}`,
        background,
      });
      const blob = await rasterizeSchemaDiagramSvg(
        svg,
        exportLayout.width,
        exportLayout.height,
        format,
      );
      downloadBlob(blob, `${basename}.${format === "jpeg" ? "jpg" : "png"}`);
    } finally {
      setIsRasterizing(false);
    }
  }, [exportBackground, exportScope, fullLayout, isRasterizing, layout, snapshot]);

  const exportDbml = useCallback(() => {
    if (!snapshot) return;
    const basename =
      `${snapshot.connectionName}-${snapshot.schemaName}-schema`
        .replace(/[^A-Za-z0-9._-]+/gu, "-")
        .replace(/^-+|-+$/gu, "") || "schema";
    const artifact = serializeSchemaSnapshotToDbml(snapshot);
    downloadText(
      artifact.content,
      `${basename}.dbml`,
      "text/plain;charset=utf-8",
    );
  }, [snapshot]);

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
    const horizontal = Math.max(0, viewport.clientWidth - 32) / layout.width;
    const vertical = Math.max(0, viewport.clientHeight - 32) / layout.height;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(1, horizontal, vertical));
    setZoom(nextZoom);
    viewport.scrollTo({ left: 0, top: 0 });
  }, [layout]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(fitDiagram);
    return () => window.cancelAnimationFrame(frame);
  }, [fitDiagram]);

  if (
    !activeTab ||
    activeTab.type !== "schema_diagram" ||
    !snapshot ||
    !layout ||
    !fullLayout ||
    !viewportIndex
  ) {
    return null;
  }

  const selectedRelation = snapshot.relations.find(
    (relation) => relation.name === activeTab.selectedDiagramRelationName,
  ) || null;
  const selectedName = selectedRelation?.name || null;
  const selectedIsHidden = Boolean(
    selectedName && !layout.nodes.some((node) => node.relationName === selectedName),
  );
  const selectedArea = areaHistory.present.find(
    (area) => area.id === selectedAreaId,
  ) || null;
  const relatedEdges = selectedName
    ? fullLayout.edges.filter(
        (edge) =>
          edge.sourceRelation === selectedName || edge.targetRelation === selectedName,
      )
    : [];

  const selectRelation = (relationName: string, additive = false) => {
    let next: Set<string>;
    if (!additive) {
      next = new Set([relationName]);
    } else {
      next = new Set(selectedRelationNames);
      if (next.has(relationName)) next.delete(relationName);
      else next.add(relationName);
    }
    selectSchemaDiagramRelations(activeTab.id, [...next]);
    selectSchemaDiagramRelation(activeTab.id, relationName);
  };

  const createArea = (relationNames: readonly string[] = []) => {
    const sequence = areaHistory.present.length + 1;
    const id = `area-${Date.now().toString(36)}-${sequence}`;
    const nextAreas = [
      ...areaHistory.present,
      { id, name: `Area ${sequence}`, relationNames: [] },
    ];
    setSchemaDiagramAreaHistory(
      activeTab.id,
      commitSchemaDiagramAreas(
        areaHistory,
        relationNames.length > 0
          ? moveSchemaDiagramRelationsToArea(nextAreas, relationNames, id)
          : nextAreas,
      ),
    );
    selectSchemaDiagramArea(activeTab.id, id);
  };

  const removeArea = (areaId: string) => {
    if (!areaId) return;
    setSchemaDiagramAreaHistory(
      activeTab.id,
      commitSchemaDiagramAreas(
        areaHistory,
        areaHistory.present.filter((area) => area.id !== areaId),
      ),
    );
    if (selectedAreaId === areaId) {
      selectSchemaDiagramArea(activeTab.id, null);
      if (relationScope === "area") setRelationScope("all");
    }
  };

  const moveRelationsToArea = (
    areaId: string,
    relationNames: readonly string[],
  ) => {
    if (!areaId || relationNames.length === 0) return;
    setSchemaDiagramAreaHistory(
      activeTab.id,
      commitSchemaDiagramAreas(
        areaHistory,
        moveSchemaDiagramRelationsToArea(
          areaHistory.present,
          relationNames,
          areaId,
        ),
      ),
    );
  };

  const removeRelationsFromAreas = (relationNames: readonly string[]) => {
    if (relationNames.length === 0) return;
    setSchemaDiagramAreaHistory(
      activeTab.id,
      commitSchemaDiagramAreas(
        areaHistory,
        removeSchemaDiagramRelationsFromAreas(
          areaHistory.present,
          relationNames,
        ),
      ),
    );
  };

  const autoArrangeArea = (areaId: string) => {
    if (!areaId) return;
    setSchemaDiagramAreaHistory(
      activeTab.id,
      commitSchemaDiagramAreas(
        areaHistory,
        autoArrangeSchemaDiagramArea(
          areaHistory.present,
          areaId,
          fullLayout.edges,
        ),
      ),
    );
  };

  const removeSelectedArea = () => removeArea(selectedAreaId);
  const moveSelectionToArea = () =>
    moveRelationsToArea(selectedAreaId, [...selectedRelationNames]);
  const autoArrangeSelectedArea = () => autoArrangeArea(selectedAreaId);

  const revealRelation = async (relationName: string) => {
    selectRelation(relationName);
    const connectionError = await setActiveConnection(snapshot.connectionId);
    if (connectionError) return;
    setActiveToolWindow("databaseExplorer");
    requestDatabaseObjectReveal({
      projectId: activeProjectId,
      connectionId: snapshot.connectionId,
      databaseName: snapshot.databaseName || undefined,
      schemaName: snapshot.schemaName,
      objectName: relationName,
    });
  };

  const focusRelatedRelation = (relationName: string) => {
    setQuery("");
    setRelationScope("all");
    selectRelation(relationName);
    window.requestAnimationFrame(() => {
      const node = fullLayout.nodes.find(
        (candidate) => candidate.relationName === relationName,
      );
      const viewport = viewportRef.current;
      if (!node || !viewport) return;
      viewport.scrollTo({
        left: Math.max(0, node.x * zoom - viewport.clientWidth / 2),
        top: Math.max(0, node.y * zoom - viewport.clientHeight / 2),
      });
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--wb-editor))] text-[hsl(var(--wb-text))]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] bg-[hsl(var(--wb-active-strong))] text-violet-300">
            <Network size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[12px] font-semibold">
              <span className="truncate">{snapshot.connectionName}</span>
              {snapshot.databaseName && (
                <>
                  <span className="font-normal wb-muted">/</span>
                  <span className="truncate">{snapshot.databaseName}</span>
                </>
              )}
              <span className="font-normal wb-muted">/</span>
              <span className="truncate font-mono">{snapshot.schemaName}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[9px] wb-muted">
              <span>{layout.totalRelationCount} relations</span>
              <span>·</span>
              <span>{layout.totalRelationshipCount} foreign keys</span>
              {layout.externalRelationshipCount > 0 && (
                <>
                  <span>·</span>
                  <span>{layout.externalRelationshipCount} external</span>
                </>
              )}
              <span>·</span>
              <span>{formatTimestamp(snapshot.capturedAt)}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="wb-text-button h-7 gap-1.5 px-2.5 text-[10px]"
          disabled={!selectedName}
          onClick={() => selectedName && void revealRelation(selectedName)}
        >
          <ExternalLink size={11} /> Reveal selected
        </button>
      </header>

      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.62)] px-3">
        <label className="relative block w-56">
          <Search
            size={11}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 wb-muted"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find relation or column"
            className="h-6 w-full rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] pl-6 pr-6 text-[9px] outline-none placeholder:text-[hsl(var(--wb-text-muted)/0.65)] focus:border-[hsl(var(--wb-accent)/0.55)]"
          />
          {query && (
            <button
              type="button"
              className="absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center wb-muted hover:text-[hsl(var(--wb-text))]"
              onClick={() => setQuery("")}
              aria-label="Clear diagram search"
            >
              <X size={10} />
            </button>
          )}
        </label>
        <button
          type="button"
          className={cn(
            "wb-text-button h-6 gap-1.5 px-2 text-[9px]",
            keysOnly && "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]",
          )}
          onClick={() => setKeysOnly((current) => !current)}
          aria-pressed={keysOnly}
        >
          {keysOnly ? <Check size={10} /> : <KeyRound size={10} />}
          Keys only
        </button>
        <select
          aria-label="Diagram relation scope"
          value={relationScope}
          onChange={(event) =>
            setRelationScope(event.target.value as "all" | "related" | "area")
          }
          className="h-6 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-1.5 text-[8px] outline-none focus:border-[hsl(var(--wb-accent)/0.55)]"
        >
          <option value="all">All relations</option>
          <option value="related" disabled={!selectedName}>Selected + related</option>
          <option value="area" disabled={!selectedArea}>Selected area</option>
        </select>
        <span className="h-4 w-px bg-[hsl(var(--wb-border-subtle))]" />
        <button
          type="button"
          className="wb-icon-button h-6 w-6"
          onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current - 0.1))}
          aria-label="Zoom out"
        >
          <Minus size={11} />
        </button>
        <button
          type="button"
          className="wb-text-button h-6 min-w-12 px-1.5 font-mono text-[9px]"
          onClick={() => setZoom(1)}
          title="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="wb-icon-button h-6 w-6"
          onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current + 0.1))}
          aria-label="Zoom in"
        >
          <Plus size={11} />
        </button>
        <button
          type="button"
          className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
          onClick={fitDiagram}
        >
          <Crosshair size={10} /> Fit
        </button>
        <select
          aria-label="Diagram export scope"
          value={exportScope}
          onChange={(event) => setExportScope(event.target.value as "filtered" | "full")}
          className="h-6 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-1 text-[8px] outline-none"
        >
          <option value="filtered">Filtered</option>
          <option value="full">Full</option>
        </select>
        <select
          aria-label="Diagram export background"
          value={exportBackground}
          onChange={(event) => setExportBackground(event.target.value as "dark" | "light" | "transparent")}
          className="h-6 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-1 text-[8px] outline-none"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="transparent">Transparent</option>
        </select>
        <button
          type="button"
          className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
          onClick={exportSvg}
          disabled={layout.nodes.length === 0}
          title="Export the current filtered diagram as SVG"
        >
          <Download size={10} /> SVG
        </button>
        <button
          type="button"
          className="wb-text-button h-6 px-2 text-[9px]"
          onClick={() => void exportRaster("png")}
          disabled={layout.nodes.length === 0 || isRasterizing}
        >
          PNG
        </button>
        <button
          type="button"
          className="wb-text-button h-6 px-2 text-[9px]"
          onClick={() => void exportRaster("jpeg")}
          disabled={layout.nodes.length === 0 || isRasterizing}
          title={exportBackground === "transparent" ? "JPEG uses a white background" : undefined}
        >
          JPG
        </button>
        <button
          type="button"
          className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
          onClick={exportDbml}
          title="Export the complete snapshot as review-only DBML"
        >
          <FileCode2 size={10} /> DBML
        </button>
        <button
          type="button"
          className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
          onClick={() => setStructuredDraftOpen(true)}
          onPointerEnter={() => void loadSchemaStructuredDraftDialog()}
          onFocus={() => void loadSchemaStructuredDraftDialog()}
          title="Edit tables, columns, indexes and constraints in a local review-only draft"
        >
          <Table2 size={10} /> Structure
        </button>
        <button
          type="button"
          className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
          onClick={() => setDbmlDraftOpen(true)}
          title="Edit a local DBML draft and open a review-only schema diff"
        >
          <GitCompareArrows size={10} /> DBML Draft
        </button>
        <button
          type="button"
          className="wb-icon-button h-6 w-6"
          onClick={() => setInspectorCollapsed((current) => !current)}
          aria-label={
            inspectorCollapsed
              ? "Show diagram inspector"
              : "Hide diagram inspector"
          }
          aria-pressed={!inspectorCollapsed}
        >
          {inspectorCollapsed ? (
            <PanelRightOpen size={11} />
          ) : (
            <PanelRightClose size={11} />
          )}
        </button>
        {selectedIsHidden && selectedName && (
          <button
            type="button"
            className="ml-auto wb-text-button h-6 gap-1.5 px-2 text-[9px] text-amber-200"
            onClick={() => focusRelatedRelation(selectedName)}
            title="Clear search/scope filters and center the selected relation"
          >
            <Crosshair size={10} /> Show hidden selection
          </button>
        )}
        <span className={cn("text-[9px] wb-muted", !selectedIsHidden && "ml-auto")}>
          {layout.nodes.length}/{layout.totalRelationCount} visible · double-click to reveal
        </span>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel)/0.72)] px-3">
        <span className="mr-1 text-[8px] uppercase tracking-[0.12em] wb-muted">
          Areas
        </span>
        <button
          type="button"
          className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
          onClick={() => createArea()}
        >
          <FolderPlus size={10} /> New
        </button>
        <select
          aria-label="Selected diagram area"
          value={selectedAreaId}
          onChange={(event) =>
            selectSchemaDiagramArea(activeTab.id, event.target.value || null)
          }
          disabled={areaHistory.present.length === 0}
          className="h-6 min-w-32 max-w-44 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-1.5 text-[9px] outline-none focus:border-[hsl(var(--wb-accent)/0.55)] disabled:opacity-50"
        >
          <option value="">Select area</option>
          {areaHistory.present.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name} ({area.relationNames.length})
            </option>
          ))}
        </select>
        <button
          type="button"
          className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
          disabled={!selectedArea || selectedRelationNames.size === 0}
          onClick={moveSelectionToArea}
          title="Move the current selection to this area. Ctrl/Cmd-click or Shift-click tables to select several."
        >
          <FolderInput size={10} /> Move {selectedRelationNames.size || "selected"}
        </button>
        <button
          type="button"
          className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
          disabled={!selectedArea || selectedArea.relationNames.length < 2}
          onClick={autoArrangeSelectedArea}
          title="Arrange parents before dependent tables inside this area"
        >
          <LayoutGrid size={10} /> Auto-arrange
        </button>
        <button
          type="button"
          className="wb-icon-button h-6 w-6"
          disabled={!selectedArea}
          onClick={removeSelectedArea}
          aria-label="Remove selected area"
          title="Remove area; contained relations remain on the diagram"
        >
          <X size={10} />
        </button>
        <span className="mx-1 h-4 w-px bg-[hsl(var(--wb-border-subtle))]" />
        <button
          type="button"
          className="wb-icon-button h-6 w-6"
          disabled={areaHistory.past.length === 0}
          onClick={() =>
            setSchemaDiagramAreaHistory(
              activeTab.id,
              undoSchemaDiagramAreas(areaHistory),
            )
          }
          aria-label="Undo diagram area change"
        >
          <Undo2 size={10} />
        </button>
        <button
          type="button"
          className="wb-icon-button h-6 w-6"
          disabled={areaHistory.future.length === 0}
          onClick={() =>
            setSchemaDiagramAreaHistory(
              activeTab.id,
              redoSchemaDiagramAreas(areaHistory),
            )
          }
          aria-label="Redo diagram area change"
        >
          <Redo2 size={10} />
        </button>
        <span className="ml-auto text-[8px] wb-muted">
          {areaHistory.present.length} area{areaHistory.present.length === 1 ? "" : "s"} · {selectedRelationNames.size} selected
        </span>
      </div>

      <div
        className={cn(
          "grid min-h-0 flex-1",
          inspectorCollapsed
            ? "grid-cols-[minmax(0,1fr)]"
            : "grid-cols-[minmax(0,1fr)_260px]",
        )}
      >
        <div
          ref={viewportRef}
          onScroll={scheduleViewportWindowUpdate}
          className="min-h-0 overflow-auto bg-[radial-gradient(circle_at_center,hsl(var(--wb-border-subtle)/0.42)_0.75px,transparent_0.75px)] bg-[length:18px_18px]"
        >
          {layout.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[10px] wb-muted">
              No relation or column matches “{query}”.
            </div>
          ) : (
            <div
              style={{ width: layout.width * zoom, height: layout.height * zoom }}
            >
              <div
                className="relative"
                style={{
                  width: layout.width,
                  height: layout.height,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                }}
              >
                {areaBounds.map((area) => (
                  <div
                    key={area.id}
                    className={cn(
                      "pointer-events-none absolute rounded-[8px] border border-dashed bg-violet-400/[0.025]",
                      area.id === selectedAreaId
                        ? "border-violet-400/60"
                        : "border-violet-300/25",
                    )}
                    style={{
                      left: area.x,
                      top: area.y,
                      width: area.width,
                      height: area.height,
                    }}
                  >
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <button
                          type="button"
                          className="pointer-events-auto absolute left-2 top-1 rounded px-1 py-0.5 text-[9px] font-medium text-violet-200/85 outline-none hover:bg-violet-300/10 focus-visible:ring-1 focus-visible:ring-violet-300/60"
                          onClick={() =>
                            selectSchemaDiagramArea(activeTab.id, area.id)
                          }
                        >
                          {area.name} · {area.visibleRelationCount}/
                          {area.relationNames.length}
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-48 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
                        <ContextMenuItem
                          className="gap-2 text-[10px]"
                          disabled={area.relationNames.length < 2}
                          onClick={() => autoArrangeArea(area.id)}
                        >
                          <LayoutGrid size={11} /> Auto-arrange area
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className="gap-2 text-[10px] text-red-300 focus:text-red-200"
                          onClick={() => removeArea(area.id)}
                        >
                          <X size={11} /> Remove area
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </div>
                ))}
                <DiagramEdges
                  nodesByName={viewportIndex.nodesByName}
                  edges={viewportEdges}
                  selectedRelation={selectedName}
                />
                {viewportNodes.map((node) => (
                  <DiagramRelationNode
                    key={node.id}
                    node={node}
                    selected={selectedRelationNames.has(node.relationName)}
                    onSelect={(event) =>
                      selectRelation(
                        node.relationName,
                        event.ctrlKey || event.metaKey || event.shiftKey,
                      )
                    }
                    onReveal={() => void revealRelation(node.relationName)}
                    onContextSelect={() => {
                      if (!selectedRelationNames.has(node.relationName)) {
                        selectRelation(node.relationName);
                      }
                    }}
                    contextRelationNames={
                      selectedRelationNames.has(node.relationName) &&
                      selectedRelationNames.size > 1
                        ? [...selectedRelationNames]
                        : [node.relationName]
                    }
                    areas={areaHistory.present}
                    onCreateArea={createArea}
                    onMoveToArea={moveRelationsToArea}
                    onRemoveFromAreas={removeRelationsFromAreas}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {!inspectorCollapsed && (
        <aside className="min-h-0 overflow-auto border-l border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel)/0.72)]">
          {selectedRelation ? (
            <>
              <div className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-3">
                <div className="flex items-center gap-2">
                  <Table2 size={12} className="text-violet-300" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold">
                    {selectedRelation.name}
                  </span>
                </div>
                <div className="mt-1 text-[8px] uppercase tracking-[0.12em] wb-muted">
                  {selectedRelation.objectType || "relation"} · {selectedRelation.columns.length} columns
                </div>
              </div>
              <InspectorSection title="Columns" icon={Columns3}>
                {selectedRelation.columns.map((column) => (
                  <div
                    key={column.name}
                    className="flex items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-1.5 text-[9px] last:border-b-0"
                  >
                    <span className="w-5 shrink-0 font-mono text-[8px] text-amber-300">
                      {column.is_primary_key ? "PK" : ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono">{column.name}</span>
                    <span className="max-w-24 truncate font-mono text-[8px] wb-muted">
                      {column.data_type}
                    </span>
                  </div>
                ))}
              </InspectorSection>
              <InspectorSection title={`Relationships ${relatedEdges.length}`} icon={Network}>
                {relatedEdges.length === 0 ? (
                  <div className="px-3 py-2 text-[9px] wb-muted">No in-schema foreign keys.</div>
                ) : (
                  relatedEdges.map((edge) => {
                    const outgoing = edge.sourceRelation === selectedRelation.name;
                    const other = outgoing ? edge.targetRelation : edge.sourceRelation;
                    return (
                      <button
                        type="button"
                        key={edge.id}
                        className="block w-full border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-left last:border-b-0 hover:bg-[hsl(var(--wb-hover))]"
                        onClick={() => focusRelatedRelation(other)}
                      >
                        <span className="flex items-center gap-1.5 text-[9px]">
                          <span className="wb-muted">{outgoing ? "→" : "←"}</span>
                          <span className="truncate font-mono">{other}</span>
                        </span>
                        <span className="mt-1 block truncate font-mono text-[8px] wb-muted">
                          {edge.constraintName} · {edge.sourceColumns.join(", ")} → {edge.targetColumns.join(", ")}
                        </span>
                      </button>
                    );
                  })
                )}
              </InspectorSection>
            </>
          ) : (
            <div className="flex h-full items-center justify-center px-5 text-center text-[9px] leading-4 wb-muted">
              Select a relation to inspect its columns and foreign keys.
            </div>
          )}
        </aside>
        )}
      </div>
      <SchemaDbmlDraftDialog
        open={dbmlDraftOpen}
        snapshot={snapshot}
        onClose={() => setDbmlDraftOpen(false)}
      />
      {structuredDraftOpen && (
        <Suspense fallback={null}>
          <SchemaStructuredDraftDialog
            open
            snapshot={snapshot}
            initialRelationName={selectedName}
            onClose={() => setStructuredDraftOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

function DiagramRelationNode({
  node,
  selected,
  onSelect,
  onReveal,
  onContextSelect,
  contextRelationNames,
  areas,
  onCreateArea,
  onMoveToArea,
  onRemoveFromAreas,
}: {
  node: SchemaDiagramNode;
  selected: boolean;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onReveal: () => void;
  onContextSelect: () => void;
  contextRelationNames: string[];
  areas: Array<{ id: string; name: string; relationNames: string[] }>;
  onCreateArea: (relationNames: readonly string[]) => void;
  onMoveToArea: (areaId: string, relationNames: readonly string[]) => void;
  onRemoveFromAreas: (relationNames: readonly string[]) => void;
}) {
  const hasAssignedRelation = contextRelationNames.some((relationName) =>
    areas.some((area) => area.relationNames.includes(relationName)),
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          data-schema-diagram-relation={node.relationName}
          className={cn(
            "absolute overflow-hidden rounded-[5px] border bg-[hsl(var(--wb-panel-raised))] text-left shadow-[0_5px_14px_rgba(0,0,0,0.22)] outline-none",
            selected
              ? "border-violet-400/70 ring-1 ring-violet-400/25"
              : "border-[hsl(var(--wb-border))] hover:border-[hsl(var(--wb-accent)/0.5)]",
          )}
          style={{
            left: node.x,
            top: node.y,
            width: node.width,
            height: node.height,
          }}
          onClick={onSelect}
          onDoubleClick={onReveal}
          onContextMenu={onContextSelect}
        >
      <span className="flex h-[38px] items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3">
        <Table2 size={12} className="shrink-0 text-violet-300" />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold">
          {node.relationName}
        </span>
        <span className="shrink-0 text-[7px] uppercase tracking-wider wb-muted">
          {shortObjectType(node.objectType)}
        </span>
      </span>
      {node.columns.length === 0 ? (
        <span className="flex h-[21px] items-center px-3 text-[8px] italic wb-muted">
          No key columns
        </span>
      ) : (
        node.columns.map((column) => (
          <span
            key={column.name}
            className="flex h-[21px] items-center border-b border-[hsl(var(--wb-border-subtle)/0.72)] px-2.5 text-[8px] last:border-b-0"
          >
            <span className="flex w-8 shrink-0 items-center gap-0.5 font-mono text-[7px]">
              {column.primaryKey && <span className="text-amber-300">PK</span>}
              {column.foreignKey && <span className="text-sky-300">FK</span>}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[9px]">
              {column.name}
            </span>
            <span className="ml-2 max-w-24 truncate font-mono text-[7px] wb-muted">
              {column.dataType}
              {column.nullable ? " ?" : ""}
            </span>
          </span>
        ))
      )}
      {node.hiddenColumnCount > 0 && (
        <span className="flex h-6 items-center border-t border-[hsl(var(--wb-border-subtle))] px-3 text-[8px] wb-muted">
          +{node.hiddenColumnCount} hidden column{node.hiddenColumnCount === 1 ? "" : "s"}
        </span>
      )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
        <ContextMenuItem className="gap-2 text-[10px]" onClick={onReveal}>
          <ExternalLink size={11} /> Reveal in Explorer
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2 text-[10px]">
            <FolderInput size={11} /> Move {contextRelationNames.length} relation
            {contextRelationNames.length === 1 ? "" : "s"} to area
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 w-52 overflow-y-auto border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
            <ContextMenuItem
              className="gap-2 text-[10px]"
              onClick={() => onCreateArea(contextRelationNames)}
            >
              <FolderPlus size={11} /> New area
            </ContextMenuItem>
            {areas.length > 0 && <ContextMenuSeparator />}
            {areas.map((area) => {
              const containsSelection = contextRelationNames.every((name) =>
                area.relationNames.includes(name),
              );
              return (
                <ContextMenuItem
                  key={area.id}
                  className="gap-2 text-[10px]"
                  onClick={() => onMoveToArea(area.id, contextRelationNames)}
                >
                  <span className="h-2 w-2 rounded-full bg-violet-400/70" />
                  <span className="min-w-0 flex-1 truncate">{area.name}</span>
                  {containsSelection && <Check size={11} />}
                </ContextMenuItem>
              );
            })}
            {areas.length > 0 && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="gap-2 text-[10px]"
                  disabled={!hasAssignedRelation}
                  onClick={() => onRemoveFromAreas(contextRelationNames)}
                >
                  <X size={11} /> No area
                  {!hasAssignedRelation && <Check className="ml-auto" size={11} />}
                </ContextMenuItem>
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function DiagramEdges({
  nodesByName,
  edges,
  selectedRelation,
}: {
  nodesByName: ReadonlyMap<string, SchemaDiagramNode>;
  edges: SchemaDiagramEdge[];
  selectedRelation: string | null;
}) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      {edges.map((edge) => {
        const source = nodesByName.get(edge.sourceRelation);
        const target = nodesByName.get(edge.targetRelation);
        if (!source || !target) return null;
        const targetOnRight = target.x > source.x;
        const sourceX = targetOnRight ? source.x + source.width : source.x;
        const targetX = targetOnRight ? target.x : target.x + target.width;
        const sourceY = source.y + diagramColumnOffset(source, edge.sourceColumns[0]);
        const targetY = target.y + diagramColumnOffset(target, edge.targetColumns[0]);
        const middleX = (sourceX + targetX) / 2;
        const selected =
          selectedRelation === edge.sourceRelation ||
          selectedRelation === edge.targetRelation;
        return (
          <g key={edge.id}>
            <title>{`${edge.constraintName}: ${edge.sourceRelation}.${edge.sourceColumns.join(",")} → ${edge.targetRelation}.${edge.targetColumns.join(",")}`}</title>
            <path
              d={`M ${sourceX} ${sourceY} C ${middleX} ${sourceY}, ${middleX} ${targetY}, ${targetX} ${targetY}`}
              fill="none"
              stroke={selected ? "hsl(var(--wb-accent))" : "hsl(var(--wb-text-muted) / 0.42)"}
              strokeWidth={selected ? 1.8 : 1.15}
            />
            <circle
              cx={sourceX}
              cy={sourceY}
              r={selected ? 3 : 2.25}
              fill={selected ? "hsl(var(--wb-accent))" : "hsl(var(--wb-text-muted))"}
            />
            <path
              d={targetOnRight
                ? `M ${targetX - 6} ${targetY - 4} L ${targetX} ${targetY} L ${targetX - 6} ${targetY + 4}`
                : `M ${targetX + 6} ${targetY - 4} L ${targetX} ${targetY} L ${targetX + 6} ${targetY + 4}`}
              fill="none"
              stroke={selected ? "hsl(var(--wb-accent))" : "hsl(var(--wb-text-muted))"}
              strokeWidth={selected ? 1.8 : 1.15}
            />
          </g>
        );
      })}
    </svg>
  );
}

function InspectorSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Columns3;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[hsl(var(--wb-border-subtle))]">
      <div className="flex h-8 items-center gap-1.5 border-b border-[hsl(var(--wb-border-subtle))] px-3 text-[9px] font-medium">
        <Icon size={10} className="wb-muted" /> {title}
      </div>
      {children}
    </section>
  );
}

function shortObjectType(value?: string | null) {
  const normalized = value?.toUpperCase() || "TABLE";
  if (normalized.includes("MATERIALIZED")) return "MVIEW";
  if (normalized.includes("VIEW")) return "VIEW";
  if (normalized.includes("FOREIGN")) return "FOREIGN";
  return "TABLE";
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
