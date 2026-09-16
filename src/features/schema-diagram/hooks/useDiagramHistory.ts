import { isEditableKeyboardTarget } from "@/features/schema-diagram/model/diagramPresentation";
import type { TabData } from "@/features/workspace-tabs/model/types";
import type { SchemaDiagramArea } from "@/lib/schemaDiagramAreas";
import type { SchemaDiagramCanvasHistory } from "@/lib/schemaDiagramCanvasHistory";
import {
  redoSchemaDiagramCanvas,
  undoSchemaDiagramCanvas,
} from "@/lib/schemaDiagramCanvasHistory";
import { useCallback, useEffect } from "react";

interface UseDiagramHistoryContext {
  activeTab: Pick<TabData, "id" | "type"> | undefined;
  canvasHistory: SchemaDiagramCanvasHistory;
  setSchemaDiagramCanvasHistory: (
    tabId: string,
    history: SchemaDiagramCanvasHistory,
  ) => void;
  editingNoteId: string | null;
  renamingAreaId: string | null;
  dbmlDraftOpen: boolean;
  structuredDraftOpen: boolean;
  selectedAreaId: string;
  areas: SchemaDiagramArea[];
  selectSchemaDiagramArea: (tabId: string, areaId: string | null) => void;
  relationScope: "all" | "related" | "area";
  setRelationScope: React.Dispatch<
    React.SetStateAction<"all" | "related" | "area">
  >;
}

export function useDiagramHistory({
  activeTab,
  canvasHistory,
  setSchemaDiagramCanvasHistory,
  editingNoteId,
  renamingAreaId,
  dbmlDraftOpen,
  structuredDraftOpen,
  selectedAreaId,
  areas,
  selectSchemaDiagramArea,
  relationScope,
  setRelationScope,
}: UseDiagramHistoryContext) {
  const undoCanvas = useCallback(() => {
    if (!activeTab || canvasHistory.past.length === 0) return;
    setSchemaDiagramCanvasHistory(
      activeTab.id,
      undoSchemaDiagramCanvas(canvasHistory),
    );
  }, [activeTab, canvasHistory, setSchemaDiagramCanvasHistory]);

  const redoCanvas = useCallback(() => {
    if (!activeTab || canvasHistory.future.length === 0) return;
    setSchemaDiagramCanvasHistory(
      activeTab.id,
      redoSchemaDiagramCanvas(canvasHistory),
    );
  }, [activeTab, canvasHistory, setSchemaDiagramCanvasHistory]);

  useEffect(() => {
    if (!activeTab || activeTab.type !== "schema_diagram") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        isEditableKeyboardTarget(event.target) ||
        editingNoteId !== null ||
        renamingAreaId !== null ||
        dbmlDraftOpen ||
        structuredDraftOpen
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const wantsRedo = key === "y" || (key === "z" && event.shiftKey);
      const wantsUndo = key === "z" && !event.shiftKey;
      if (
        (!wantsUndo && !wantsRedo) ||
        (wantsUndo && canvasHistory.past.length === 0) ||
        (wantsRedo && canvasHistory.future.length === 0)
      ) {
        return;
      }
      event.preventDefault();
      if (wantsRedo) redoCanvas();
      else undoCanvas();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTab,
    canvasHistory.future.length,
    canvasHistory.past.length,
    dbmlDraftOpen,
    editingNoteId,
    redoCanvas,
    renamingAreaId,
    structuredDraftOpen,
    undoCanvas,
  ]);

  useEffect(() => {
    if (
      !activeTab ||
      !selectedAreaId ||
      areas.some((area) => area.id === selectedAreaId)
    ) {
      return;
    }
    selectSchemaDiagramArea(activeTab.id, null);
    if (relationScope === "area") setRelationScope("all");
  }, [
    activeTab,
    areas,
    relationScope,
    selectSchemaDiagramArea,
    selectedAreaId,
  ]);

  return { undoCanvas, redoCanvas };
}
