import type { TabData } from "@/features/workspace-tabs/model/types";
import type { SchemaDiagramLayout } from "@/lib/schemaDiagram";
import type { SchemaDiagramArea } from "@/lib/schemaDiagramAreas";
import {
  autoArrangeSchemaDiagramArea,
  autoArrangeSchemaDiagramAreas,
  moveSchemaDiagramRelationsToArea,
  removeSchemaDiagramRelationsFromAreas,
  renameSchemaDiagramArea,
} from "@/lib/schemaDiagramAreas";
import type { SchemaDiagramCanvasHistory } from "@/lib/schemaDiagramCanvasHistory";
import { commitSchemaDiagramCanvas } from "@/lib/schemaDiagramCanvasHistory";

interface CreateDiagramAreaActionsContext {
  areas: SchemaDiagramArea[];
  setSchemaDiagramCanvasHistory: (
    tabId: string,
    history: SchemaDiagramCanvasHistory,
  ) => void;
  activeTab: Pick<TabData, "id">;
  canvasHistory: SchemaDiagramCanvasHistory;
  selectSchemaDiagramArea: (tabId: string, areaId: string | null) => void;
  selectedAreaId: string;
  relationScope: "all" | "related" | "area";
  setRelationScope: React.Dispatch<
    React.SetStateAction<"all" | "related" | "area">
  >;
  fullLayout: SchemaDiagramLayout;
  setAreaNameDraft: React.Dispatch<React.SetStateAction<string>>;
  setRenamingAreaId: React.Dispatch<React.SetStateAction<string | null>>;
  areaNameDraft: string;
  renamingAreaId: string | null;
  selectedRelationNames: Set<string>;
}

export function createDiagramAreaActions({
  areas,
  setSchemaDiagramCanvasHistory,
  activeTab,
  canvasHistory,
  selectSchemaDiagramArea,
  selectedAreaId,
  relationScope,
  setRelationScope,
  fullLayout,
  setAreaNameDraft,
  setRenamingAreaId,
  areaNameDraft,
  renamingAreaId,
  selectedRelationNames,
}: CreateDiagramAreaActionsContext) {
  const commitAreas = (nextAreas: typeof areas) => {
    setSchemaDiagramCanvasHistory(
      activeTab.id,
      commitSchemaDiagramCanvas(canvasHistory, { areas: nextAreas }),
    );
  };

  const createArea = (relationNames: readonly string[] = []) => {
    const sequence = areas.length + 1;
    const id = `area-${Date.now().toString(36)}-${sequence}`;
    const nextAreas = [
      ...areas,
      { id, name: `Area ${sequence}`, relationNames: [] },
    ];
    commitAreas(
      relationNames.length > 0
        ? moveSchemaDiagramRelationsToArea(nextAreas, relationNames, id)
        : nextAreas,
    );
    selectSchemaDiagramArea(activeTab.id, id);
  };

  const removeArea = (areaId: string) => {
    if (!areaId) return;
    commitAreas(areas.filter((area) => area.id !== areaId));
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
    commitAreas(moveSchemaDiagramRelationsToArea(areas, relationNames, areaId));
  };

  const removeRelationsFromAreas = (relationNames: readonly string[]) => {
    if (relationNames.length === 0) return;
    commitAreas(removeSchemaDiagramRelationsFromAreas(areas, relationNames));
  };

  const autoArrangeArea = (areaId: string) => {
    if (!areaId) return;
    commitAreas(autoArrangeSchemaDiagramArea(areas, areaId, fullLayout.edges));
  };

  const autoArrangeAllAreas = () => {
    commitAreas(autoArrangeSchemaDiagramAreas(areas, fullLayout.edges));
  };

  const beginRenameArea = (areaId: string) => {
    const area = areas.find((candidate) => candidate.id === areaId);
    if (!area) return;
    setAreaNameDraft(area.name);
    setRenamingAreaId(area.id);
  };

  const areaName = areaNameDraft.trim();
  const areaNameConflict = Boolean(
    renamingAreaId &&
      areas.some(
        (area) =>
          area.id !== renamingAreaId &&
          area.name.localeCompare(areaName, undefined, {
            sensitivity: "accent",
          }) === 0,
      ),
  );
  const areaNameError = !areaName
    ? "Area name is required."
    : areaNameConflict
      ? "Another area already uses this name."
      : null;
  const commitAreaRename = () => {
    if (!renamingAreaId || areaNameError) return;
    commitAreas(renameSchemaDiagramArea(areas, renamingAreaId, areaName));
    setRenamingAreaId(null);
  };

  const removeSelectedArea = () => removeArea(selectedAreaId);
  const moveSelectionToArea = () =>
    moveRelationsToArea(selectedAreaId, [...selectedRelationNames]);
  const autoArrangeSelectedArea = () => autoArrangeArea(selectedAreaId);

  return {
    createArea,
    removeArea,
    moveRelationsToArea,
    removeRelationsFromAreas,
    autoArrangeArea,
    autoArrangeAllAreas,
    beginRenameArea,
    areaNameError,
    commitAreaRename,
    removeSelectedArea,
    moveSelectionToArea,
    autoArrangeSelectedArea,
  };
}
