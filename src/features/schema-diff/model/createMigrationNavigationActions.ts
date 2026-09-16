import type { WorkbenchToolWindowId } from "@/features/settings/model/settingsTypes";
import type { TabData } from "@/features/workspace-tabs/model/types";
import { requestDatabaseObjectReveal } from "@/lib/databaseNavigation";
import type { SchemaChange } from "@/services/tauri/types";
import type { SchemaDiffPlan } from "@/services/tauri/types/schemaDiff";

interface CreateMigrationNavigationActionsContext {
  selectSchemaDiffChange: (tabId: string, changeId: string | null) => void;
  activeTab: Pick<TabData, "id">;
  setActiveToolWindow: (id: WorkbenchToolWindowId | "editor") => void;
  setActiveConnection: (id: string) => Promise<string | null>;
  plan: SchemaDiffPlan;
  activeProjectId: string;
}

export function createMigrationNavigationActions({
  selectSchemaDiffChange,
  activeTab,
  setActiveToolWindow,
  setActiveConnection,
  plan,
  activeProjectId,
}: CreateMigrationNavigationActionsContext) {
  const revealChange = async (change: SchemaChange) => {
    selectSchemaDiffChange(activeTab.id, change.id);
    if (change.kind === "relationCreate") {
      setActiveToolWindow("editor");
      return;
    }
    const connectionError = await setActiveConnection(plan.targetConnectionId);
    if (connectionError) return;
    setActiveToolWindow("databaseExplorer");
    requestDatabaseObjectReveal({
      projectId: activeProjectId,
      connectionId: plan.targetConnectionId,
      databaseName: plan.targetDatabaseName || undefined,
      schemaName: change.schemaName,
      objectType: change.objectType || undefined,
      objectName: change.relationName,
    });
  };

  return { revealChange };
}
