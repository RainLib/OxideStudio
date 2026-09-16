import { TabData } from "@/features/workspace-tabs/model/types";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
} from "@/lib/databaseDialect";
import {
  isProjectSqlFile,
  rememberProjectSqlFileTarget,
} from "@/lib/projectSqlFileTarget";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";

export function fileNameFromPath(relativePath: string) {
  const segments = relativePath.split("/").filter(Boolean);
  return segments[segments.length - 1] || relativePath;
}

export function persistProjectSqlFileTargetForTab(tab: TabData) {
  if (
    !tab.fileProjectId ||
    !tab.fileRelativePath ||
    !isProjectSqlFile(tab.fileRelativePath) ||
    tab.filePreview ||
    tab.agentFileDiffPreview ||
    tab.gitFileDiffPreview
  ) {
    return;
  }
  const connectionState = useConnectionStore.getState();
  const connectionId = tab.connectionId || connectionState.activeConnectionId;
  if (!connectionId) return;
  const connection = connectionState.connections.find(
    (candidate) => candidate.id === connectionId,
  );
  rememberProjectSqlFileTarget(tab.fileProjectId, tab.fileRelativePath, {
    connectionId,
    databaseName: tab.databaseName || connection?.database,
    schemaName:
      tab.targetSchema ??
      tab.schemaName ??
      (connectionId === connectionState.activeConnectionId
        ? useSchemaStore.getState().currentSchema || undefined
        : undefined),
  });
}

export function normalizedDatabaseName(
  databaseName: string | null | undefined,
) {
  return databaseName === "" || databaseName == null ? undefined : databaseName;
}

export function tabMatchesDatabase(
  tab: Pick<TabData, "databaseName">,
  databaseName: string | null | undefined,
) {
  return (
    normalizedDatabaseName(tab.databaseName) ===
    normalizedDatabaseName(databaseName)
  );
}

export function querySchemaContextForTab(
  tab: Pick<
    TabData,
    "targetSchema" | "schemaName" | "tableName" | "objectType"
  >,
  currentSchema: string | null | undefined,
  driver: string = DEFAULT_DATABASE_DRIVER,
) {
  const capabilities = defaultDatabaseCapabilities(driver);
  if (
    capabilities.dataModel === "search" &&
    tab.tableName &&
    !tab.targetSchema &&
    (tab.objectType === "index" ||
      !tab.schemaName ||
      tab.schemaName === "default")
  ) {
    return tab.tableName;
  }

  return tab.targetSchema || tab.schemaName || currentSchema || undefined;
}
