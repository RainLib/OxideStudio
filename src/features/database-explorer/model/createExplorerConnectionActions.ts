import type { ConnectionConfig } from "@/features/connections/model/types";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import type { TabData, TabType } from "@/features/workspace-tabs/model/types";
import {
  databaseDriverProfile,
  defaultDatabaseName,
  defaultDatabasePort,
} from "@/lib/databaseDialect";
import type { DatabaseDriver } from "@/services/tauri/types";
import { useTabStore } from "@/store/useTabStore";

interface CreateExplorerConnectionActionsContext {
  activeConnection: ConnectionConfig | undefined;
  createTab: (
    type?: TabType | undefined,
    title?: string | undefined,
    initialSql?: string | undefined,
    metadata?:
      | Partial<
          Pick<
            TabData,
            | "connectionId"
            | "databaseName"
            | "tableName"
            | "schemaName"
            | "objectType"
            | "queryLanguage"
            | "elasticsearchVariables"
            | "filters"
            | "fileProjectId"
            | "savedSqlProjectId"
            | "savedSqlFileId"
            | "fileRootPath"
            | "fileRelativePath"
            | "fileRevision"
            | "filePreview"
            | "isDirty"
            | "targetSchema"
            | "agentFileDiffPreview"
            | "gitFileDiffPreview"
          >
        >
      | undefined,
  ) => string;
  activeConnectionId: string | null;
  currentSchema: string | null;
  createNewConnection: () => ConnectionConfig;
  updateConnectionConfig: (updates: Partial<ConnectionConfig>) => void;
  moveExplorerConnectionsToGroup: (
    scopeId: string,
    connectionIds: readonly string[],
    groupId: string | null,
  ) => void;
  explorerStateScope: string;
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setIsDataSourceDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectConnection: (id: string | null) => void;
  connections: ConnectionConfig[];
  selectedExplorerNodeIds: string[];
}

export function createExplorerConnectionActions({
  activeConnection,
  createTab,
  activeConnectionId,
  currentSchema,
  createNewConnection,
  updateConnectionConfig,
  moveExplorerConnectionsToGroup,
  explorerStateScope,
  setExpandedObjectGroupKeys,
  setIsDataSourceDialogOpen,
  selectConnection,
  connections,
  selectedExplorerNodeIds,
}: CreateExplorerConnectionActionsContext) {
  const handleNewQueryConsole = () => {
    const queryNumber =
      useTabStore.getState().tabs.filter((tab) => tab.type === "query").length +
      1;
    const connectionName = activeConnection?.name;
    createTab(
      "query",
      connectionName ? `console [${connectionName}]` : `Query #${queryNumber}`,
      "",
      {
        connectionId: activeConnectionId || undefined,
        schemaName: currentSchema || undefined,
      },
    );
  };

  const handleNewDataSource = (
    driver: DatabaseDriver,
    connectionGroupId?: string,
  ) => {
    const draft = createNewConnection();
    const profile = databaseDriverProfile(driver);
    updateConnectionConfig({
      driver,
      name: `New ${profile.menuLabel} Connection`,
      port: defaultDatabasePort(driver) || undefined,
      database: defaultDatabaseName(driver),
      icon: profile.defaultIcon,
      connectionUrl: "",
    });
    if (connectionGroupId) {
      moveExplorerConnectionsToGroup(
        explorerStateScope,
        [draft.id],
        connectionGroupId,
      );
      setExpandedObjectGroupKeys((current) =>
        current.includes(connectionGroupId)
          ? current
          : [...current, connectionGroupId],
      );
    }
    setIsDataSourceDialogOpen(true);
  };

  const handleOpenConnectionProperties = (connectionId: string) => {
    selectConnection(connectionId);
    setIsDataSourceDialogOpen(true);
  };

  const handleDuplicateConnection = (
    connection: (typeof connections)[number],
  ) => {
    const draft = createNewConnection();
    updateConnectionConfig({
      ...connection,
      id: draft.id,
      name: `${connection.name} Copy`,
    });
    setIsDataSourceDialogOpen(true);
  };

  const connectionIdsForExplorerAction = (connectionId: string) => {
    const selectedConnectionIds = connections
      .filter((item) =>
        selectedExplorerNodeIds.includes(explorerNodeId("connection", item.id)),
      )
      .map((item) => item.id);
    return selectedConnectionIds.includes(connectionId)
      ? selectedConnectionIds
      : [connectionId];
  };

  return {
    handleNewQueryConsole,
    handleNewDataSource,
    handleOpenConnectionProperties,
    handleDuplicateConnection,
    connectionIdsForExplorerAction,
  };
}
