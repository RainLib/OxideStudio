import type { WorkbenchToolWindowId } from "@/features/settings/model/settingsTypes";
import type { TabData } from "@/features/workspace-tabs/model/types";
import { requestDatabaseObjectReveal } from "@/lib/databaseNavigation";
import type { SchemaDiagramLayout } from "@/lib/schemaDiagram";
import type { SchemaSnapshot } from "@/services/tauri/types/schemaDiff";

interface CreateDiagramNavigationActionsContext {
  selectedRelationNames: Set<string>;
  selectSchemaDiagramRelations: (
    tabId: string,
    relationNames: string[],
  ) => void;
  activeTab: Pick<TabData, "id">;
  selectSchemaDiagramRelation: (
    tabId: string,
    relationName: string | null,
  ) => void;
  setActiveConnection: (id: string) => Promise<string | null>;
  snapshot: SchemaSnapshot;
  setActiveToolWindow: (id: WorkbenchToolWindowId | "editor") => void;
  activeProjectId: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  setRelationScope: React.Dispatch<
    React.SetStateAction<"all" | "related" | "area">
  >;
  fullLayout: SchemaDiagramLayout;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
}

export function createDiagramNavigationActions({
  selectedRelationNames,
  selectSchemaDiagramRelations,
  activeTab,
  selectSchemaDiagramRelation,
  setActiveConnection,
  snapshot,
  setActiveToolWindow,
  activeProjectId,
  setQuery,
  setRelationScope,
  fullLayout,
  viewportRef,
  zoom,
}: CreateDiagramNavigationActionsContext) {
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

  return { selectRelation, revealRelation, focusRelatedRelation };
}
