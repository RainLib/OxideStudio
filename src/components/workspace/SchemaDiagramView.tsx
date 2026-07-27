import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  Columns3,
  Crosshair,
  ExternalLink,
  KeyRound,
  Minus,
  Network,
  Plus,
  Search,
  Table2,
  X,
} from "lucide-react";
import {
  buildSchemaDiagram,
  diagramColumnOffset,
  type SchemaDiagramEdge,
  type SchemaDiagramNode,
} from "@/lib/schemaDiagram";
import { requestDatabaseObjectReveal } from "@/lib/databaseNavigation";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useTabStore } from "@/store/useTabStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.6;

export function SchemaDiagramView() {
  const { tabs, activeTabId, selectSchemaDiagramRelation } = useTabStore();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection);
  const setActiveToolWindow = useWorkbenchLayoutStore(
    (state) => state.setActiveToolWindow,
  );
  const [query, setQuery] = useState("");
  const [keysOnly, setKeysOnly] = useState(false);
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const snapshot = activeTab?.schemaDiagramSnapshot;
  const layout = useMemo(
    () =>
      snapshot
        ? buildSchemaDiagram(snapshot, { query, keysOnly, maxColumns: 18 })
        : null,
    [keysOnly, query, snapshot],
  );
  const fullLayout = useMemo(
    () => (snapshot ? buildSchemaDiagram(snapshot, { maxColumns: 50 }) : null),
    [snapshot],
  );

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
    !fullLayout
  ) {
    return null;
  }

  const selectedRelation = snapshot.relations.find(
    (relation) => relation.name === activeTab.selectedDiagramRelationName,
  ) || null;
  const selectedName = selectedRelation?.name || null;
  const relatedEdges = selectedName
    ? fullLayout.edges.filter(
        (edge) =>
          edge.sourceRelation === selectedName || edge.targetRelation === selectedName,
      )
    : [];

  const selectRelation = (relationName: string) => {
    selectSchemaDiagramRelation(activeTab.id, relationName);
  };

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
        <span className="ml-auto text-[9px] wb-muted">
          {layout.nodes.length}/{layout.totalRelationCount} visible · double-click to reveal
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px]">
        <div
          ref={viewportRef}
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
                <DiagramEdges
                  nodes={layout.nodes}
                  edges={layout.edges}
                  selectedRelation={selectedName}
                />
                {layout.nodes.map((node) => (
                  <DiagramRelationNode
                    key={node.id}
                    node={node}
                    selected={node.relationName === selectedName}
                    onSelect={() => selectRelation(node.relationName)}
                    onReveal={() => void revealRelation(node.relationName)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

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
      </div>
    </div>
  );
}

function DiagramRelationNode({
  node,
  selected,
  onSelect,
  onReveal,
}: {
  node: SchemaDiagramNode;
  selected: boolean;
  onSelect: () => void;
  onReveal: () => void;
}) {
  return (
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
  );
}

function DiagramEdges({
  nodes,
  edges,
  selectedRelation,
}: {
  nodes: SchemaDiagramNode[];
  edges: SchemaDiagramEdge[];
  selectedRelation: string | null;
}) {
  const nodesByName = new Map(nodes.map((node) => [node.relationName, node]));
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
