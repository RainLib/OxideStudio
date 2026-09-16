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
import {
  isDiagramRelationshipTable,
  shortObjectType,
} from "@/features/schema-diagram/model/diagramPresentation";
import { type SchemaDiagramNode } from "@/lib/schemaDiagram";
import {
  readSchemaDiagramColumnDrag,
  writeSchemaDiagramColumnDrag,
  type SchemaDiagramColumnEndpoint,
} from "@/lib/schemaDiagramRelationshipDrag";
import { cn } from "@/lib/utils";
import {
  Check,
  ExternalLink,
  FolderInput,
  FolderPlus,
  Network,
  Table2,
  X,
} from "lucide-react";
import {
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

export function DiagramRelationNode({
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
  onCreateRelationship,
}: {
  node: SchemaDiagramNode;
  selected: boolean;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onReveal: () => void;
  onContextSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  contextRelationNames: string[];
  areas: Array<{ id: string; name: string; relationNames: string[] }>;
  onCreateArea: (relationNames: readonly string[]) => void;
  onMoveToArea: (areaId: string, relationNames: readonly string[]) => void;
  onRemoveFromAreas: (relationNames: readonly string[]) => void;
  onCreateRelationship: (
    source: SchemaDiagramColumnEndpoint,
    target: SchemaDiagramColumnEndpoint,
  ) => void;
}) {
  const [dragTargetColumn, setDragTargetColumn] = useState<string | null>(null);
  const hasAssignedRelation = contextRelationNames.some((relationName) =>
    areas.some((area) => area.relationNames.includes(relationName)),
  );
  const relationshipEligible = isDiagramRelationshipTable(node.objectType);
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
                draggable={relationshipEligible}
                className={cn(
                  "group/column flex h-[21px] items-center border-b border-[hsl(var(--wb-border-subtle)/0.72)] px-2.5 text-[8px] last:border-b-0",
                  relationshipEligible && "cursor-grab active:cursor-grabbing",
                  dragTargetColumn === column.name &&
                    "bg-[hsl(var(--wb-active-strong))] ring-1 ring-inset ring-violet-400/45",
                )}
                title={
                  relationshipEligible
                    ? "Drag from a source column onto a target column to draft a foreign key"
                    : undefined
                }
                onDragStart={(event: ReactDragEvent<HTMLSpanElement>) => {
                  if (!relationshipEligible) return;
                  event.stopPropagation();
                  writeSchemaDiagramColumnDrag(event.dataTransfer, {
                    relationName: node.relationName,
                    columnName: column.name,
                  });
                }}
                onDragEnter={(event) => {
                  if (!relationshipEligible) return;
                  event.preventDefault();
                  setDragTargetColumn(column.name);
                }}
                onDragOver={(event) => {
                  if (!relationshipEligible) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "link";
                }}
                onDragLeave={() => {
                  setDragTargetColumn((current) =>
                    current === column.name ? null : current,
                  );
                }}
                onDrop={(event) => {
                  setDragTargetColumn(null);
                  if (!relationshipEligible) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const source = readSchemaDiagramColumnDrag(
                    event.dataTransfer,
                  );
                  if (!source) return;
                  onCreateRelationship(source, {
                    relationName: node.relationName,
                    columnName: column.name,
                  });
                }}
              >
                <span className="flex w-8 shrink-0 items-center gap-0.5 font-mono text-[7px]">
                  {column.primaryKey && (
                    <span className="text-amber-300">PK</span>
                  )}
                  {column.foreignKey && (
                    <span className="text-sky-300">FK</span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[9px]">
                  {column.name}
                </span>
                <span className="ml-2 max-w-24 truncate font-mono text-[7px] wb-muted">
                  {column.dataType}
                  {column.nullable ? " ?" : ""}
                </span>
                {relationshipEligible && (
                  <Network
                    size={8}
                    className="ml-1 shrink-0 opacity-0 transition-opacity group-hover/column:opacity-60"
                  />
                )}
              </span>
            ))
          )}
          {node.hiddenColumnCount > 0 && (
            <span className="flex h-6 items-center border-t border-[hsl(var(--wb-border-subtle))] px-3 text-[8px] wb-muted">
              +{node.hiddenColumnCount} hidden column
              {node.hiddenColumnCount === 1 ? "" : "s"}
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
            <FolderInput size={11} /> Move {contextRelationNames.length}{" "}
            relation
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
                  {!hasAssignedRelation && (
                    <Check className="ml-auto" size={11} />
                  )}
                </ContextMenuItem>
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}
