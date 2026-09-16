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
import { SchemaDiagramNoteNode } from "@/components/workspace/SchemaDiagramNoteNode";
import type { SchemaStructuredDraftForeignKeySeed } from "@/components/workspace/SchemaStructuredDraftDialog";
import { isDiagramRelationshipTable } from "@/features/schema-diagram/model/diagramPresentation";
import { DiagramAreaMenu } from "@/features/schema-diagram/ui/DiagramAreaMenu";
import { DiagramEdges } from "@/features/schema-diagram/ui/DiagramEdges";
import { DiagramRelationNode } from "@/features/schema-diagram/ui/DiagramRelationNode";
import type { TabData } from "@/features/workspace-tabs/model/types";
import type {
  SchemaDiagramEdge,
  SchemaDiagramLayout,
  SchemaDiagramNode,
} from "@/lib/schemaDiagram";
import type {
  SchemaDiagramArea,
  SchemaDiagramAreaBounds,
} from "@/lib/schemaDiagramAreas";
import type { SchemaDiagramViewportIndex } from "@/lib/schemaDiagramViewport";
import { cn } from "@/lib/utils";
import type { SchemaDiagramNote } from "@/services/schemaDiagramCanvasStore";
import type { SchemaSnapshot } from "@/services/tauri/types/schemaDiff";
import { Check, FolderInput, FolderPlus, LayoutGrid, X } from "lucide-react";

interface DiagramWorkspaceCanvasContext {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  scheduleViewportWindowUpdate: () => void;
  layout: SchemaDiagramLayout;
  diagramNotes: SchemaDiagramNote[];
  query: string;
  canvasExtent: { width: number; height: number };
  zoom: number;
  areaBounds: SchemaDiagramAreaBounds[];
  selectedAreaId: string;
  selectSchemaDiagramArea: (tabId: string, areaId: string | null) => void;
  activeTab: Pick<TabData, "id">;
  beginRenameArea: (areaId: string) => void;
  autoArrangeArea: (areaId: string) => void;
  removeArea: (areaId: string) => void;
  viewportIndex: SchemaDiagramViewportIndex;
  viewportEdges: SchemaDiagramEdge[];
  selectedName: string | null;
  viewportNodes: SchemaDiagramNode[];
  selectedRelationNames: Set<string>;
  selectRelation: (relationName: string, additive?: boolean) => void;
  revealRelation: (relationName: string) => Promise<void>;
  areas: SchemaDiagramArea[];
  createArea: (relationNames?: readonly string[]) => void;
  moveRelationsToArea: (
    areaId: string,
    relationNames: readonly string[],
  ) => void;
  removeRelationsFromAreas: (relationNames: readonly string[]) => void;
  snapshot: SchemaSnapshot;
  setForeignKeySeed: React.Dispatch<
    React.SetStateAction<SchemaStructuredDraftForeignKeySeed | null>
  >;
  setStructuredDraftOpen: React.Dispatch<React.SetStateAction<boolean>>;
  beginEditNote: (note: SchemaDiagramNote) => void;
  moveNote: (noteId: string, x: number, y: number) => void;
  resizeNote: (noteId: string, width: number, height: number) => void;
  selectedRelationList: string[];
  autoArrangeAllAreas: () => void;
}

export function DiagramWorkspaceCanvas({
  viewportRef,
  scheduleViewportWindowUpdate,
  layout,
  diagramNotes,
  query,
  canvasExtent,
  zoom,
  areaBounds,
  selectedAreaId,
  selectSchemaDiagramArea,
  activeTab,
  beginRenameArea,
  autoArrangeArea,
  removeArea,
  viewportIndex,
  viewportEdges,
  selectedName,
  viewportNodes,
  selectedRelationNames,
  selectRelation,
  revealRelation,
  areas,
  createArea,
  moveRelationsToArea,
  removeRelationsFromAreas,
  snapshot,
  setForeignKeySeed,
  setStructuredDraftOpen,
  beginEditNote,
  moveNote,
  resizeNote,
  selectedRelationList,
  autoArrangeAllAreas,
}: DiagramWorkspaceCanvasContext) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={viewportRef}
          data-schema-diagram-canvas
          onScroll={scheduleViewportWindowUpdate}
          className="min-h-0 overflow-auto bg-[radial-gradient(circle_at_center,hsl(var(--wb-border-subtle)/0.42)_0.75px,transparent_0.75px)] bg-[length:18px_18px]"
        >
          {layout.nodes.length === 0 && diagramNotes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[10px] wb-muted">
              No relation or column matches “{query}”.
            </div>
          ) : (
            <div
              style={{
                width: canvasExtent.width * zoom,
                height: canvasExtent.height * zoom,
              }}
            >
              <div
                className="relative"
                style={{
                  width: canvasExtent.width,
                  height: canvasExtent.height,
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
                    <DiagramAreaMenu
                      selectSchemaDiagramArea={selectSchemaDiagramArea}
                      activeTab={activeTab}
                      area={area}
                      beginRenameArea={beginRenameArea}
                      autoArrangeArea={autoArrangeArea}
                      removeArea={removeArea}
                    />
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
                    onContextSelect={(event) => {
                      event.stopPropagation();
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
                    areas={areas}
                    onCreateArea={createArea}
                    onMoveToArea={moveRelationsToArea}
                    onRemoveFromAreas={removeRelationsFromAreas}
                    onCreateRelationship={(source, target) => {
                      const sourceRelation = snapshot.relations.find(
                        (relation) => relation.name === source.relationName,
                      );
                      const targetRelation = snapshot.relations.find(
                        (relation) => relation.name === target.relationName,
                      );
                      if (
                        !sourceRelation ||
                        !targetRelation ||
                        !isDiagramRelationshipTable(
                          sourceRelation.objectType,
                        ) ||
                        !isDiagramRelationshipTable(
                          targetRelation.objectType,
                        ) ||
                        !sourceRelation.columns.some(
                          (column) => column.name === source.columnName,
                        ) ||
                        !targetRelation.columns.some(
                          (column) => column.name === target.columnName,
                        )
                      ) {
                        return;
                      }
                      setForeignKeySeed({
                        sourceRelation: source.relationName,
                        sourceColumn: source.columnName,
                        targetRelation: target.relationName,
                        targetColumn: target.columnName,
                      });
                      setStructuredDraftOpen(true);
                    }}
                  />
                ))}
                {diagramNotes.map((note) => (
                  <SchemaDiagramNoteNode
                    key={note.id}
                    note={note}
                    zoom={zoom}
                    onEdit={() => beginEditNote(note)}
                    onMove={(x, y) => moveNote(note.id, x, y)}
                    onResize={(width, height) =>
                      resizeNote(note.id, width, height)
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
        <ContextMenuItem
          className="gap-2 text-[10px]"
          onClick={() => createArea()}
        >
          <FolderPlus size={11} /> New area
        </ContextMenuItem>
        {selectedRelationList.length > 0 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2 text-[10px]">
                <FolderInput size={11} /> Move {selectedRelationList.length}{" "}
                selected relation
                {selectedRelationList.length === 1 ? "" : "s"} to area
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-72 w-52 overflow-y-auto border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
                <ContextMenuItem
                  className="gap-2 text-[10px]"
                  onClick={() => createArea(selectedRelationList)}
                >
                  <FolderPlus size={11} /> New area with selection
                </ContextMenuItem>
                {areas.length > 0 && <ContextMenuSeparator />}
                {areas.map((area) => {
                  const containsSelection = selectedRelationList.every((name) =>
                    area.relationNames.includes(name),
                  );
                  return (
                    <ContextMenuItem
                      key={area.id}
                      className="gap-2 text-[10px]"
                      onClick={() =>
                        moveRelationsToArea(area.id, selectedRelationList)
                      }
                    >
                      <span className="h-2 w-2 rounded-full bg-violet-400/70" />
                      <span className="min-w-0 flex-1 truncate">
                        {area.name}
                      </span>
                      {containsSelection && <Check size={11} />}
                    </ContextMenuItem>
                  );
                })}
                {areas.length > 0 && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="gap-2 text-[10px]"
                      disabled={
                        !selectedRelationList.some((name) =>
                          areas.some((area) =>
                            area.relationNames.includes(name),
                          ),
                        )
                      }
                      onClick={() =>
                        removeRelationsFromAreas(selectedRelationList)
                      }
                    >
                      <X size={11} /> No area
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          className="gap-2 text-[10px]"
          disabled={!areas.some((area) => area.relationNames.length > 1)}
          onClick={autoArrangeAllAreas}
        >
          <LayoutGrid size={11} /> Auto-arrange diagram areas
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
