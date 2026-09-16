import { canvasPersistenceLabel } from "@/features/schema-diagram/model/diagramPresentation";
import type { TabData } from "@/features/workspace-tabs/model/types";
import type { SchemaDiagramArea } from "@/lib/schemaDiagramAreas";
import type { SchemaDiagramCanvasHistory } from "@/lib/schemaDiagramCanvasHistory";
import type { SchemaDiagramNote } from "@/services/schemaDiagramCanvasStore";
import {
  FolderInput,
  FolderPlus,
  LayoutGrid,
  Pencil,
  Redo2,
  Undo2,
  X,
} from "lucide-react";

interface DiagramAreaToolbarContext {
  createArea: (relationNames?: readonly string[]) => void;
  selectedAreaId: string;
  selectSchemaDiagramArea: (tabId: string, areaId: string | null) => void;
  activeTab: Pick<TabData, "id">;
  areas: SchemaDiagramArea[];
  selectedArea: SchemaDiagramArea | null;
  selectedRelationNames: Set<string>;
  moveSelectionToArea: () => void;
  autoArrangeSelectedArea: () => void;
  beginRenameArea: (areaId: string) => void;
  removeSelectedArea: () => void;
  canvasHistory: SchemaDiagramCanvasHistory;
  undoCanvas: () => void;
  redoCanvas: () => void;
  diagramNotes: SchemaDiagramNote[];
  canvasPersistenceState: "loading" | "ready" | "saving" | "error";
}

export function DiagramAreaToolbar({
  createArea,
  selectedAreaId,
  selectSchemaDiagramArea,
  activeTab,
  areas,
  selectedArea,
  selectedRelationNames,
  moveSelectionToArea,
  autoArrangeSelectedArea,
  beginRenameArea,
  removeSelectedArea,
  canvasHistory,
  undoCanvas,
  redoCanvas,
  diagramNotes,
  canvasPersistenceState,
}: DiagramAreaToolbarContext) {
  return (
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
        disabled={areas.length === 0}
        className="h-6 min-w-32 max-w-44 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-1.5 text-[9px] outline-none focus:border-[hsl(var(--wb-accent)/0.55)] disabled:opacity-50"
      >
        <option value="">Select area</option>
        {areas.map((area) => (
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
        <FolderInput size={10} /> Move{" "}
        {selectedRelationNames.size || "selected"}
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
        onClick={() => selectedArea && beginRenameArea(selectedArea.id)}
        aria-label="Rename selected area"
        title="Rename selected area"
      >
        <Pencil size={10} />
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
        disabled={canvasHistory.past.length === 0}
        onClick={undoCanvas}
        aria-label="Undo diagram canvas change"
        title="Undo canvas change (Ctrl/Cmd+Z)"
      >
        <Undo2 size={10} />
      </button>
      <button
        type="button"
        className="wb-icon-button h-6 w-6"
        disabled={canvasHistory.future.length === 0}
        onClick={redoCanvas}
        aria-label="Redo diagram canvas change"
        title="Redo canvas change (Ctrl/Cmd+Shift+Z)"
      >
        <Redo2 size={10} />
      </button>
      <span className="ml-auto text-[8px] wb-muted">
        {areas.length} area{areas.length === 1 ? "" : "s"} ·{" "}
        {diagramNotes.length} note{diagramNotes.length === 1 ? "" : "s"} ·{" "}
        {selectedRelationNames.size} selected ·{" "}
        {canvasPersistenceLabel(canvasPersistenceState)}
      </span>
    </div>
  );
}
