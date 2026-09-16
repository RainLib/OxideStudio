import type { ExplorerConnectionContents } from "@/features/database-explorer/ui/ExplorerConnectionContents";
import type { ExplorerConnectionMenu } from "@/features/database-explorer/ui/ExplorerConnectionMenu";
import type { useConnectionStore } from "@/store/useConnectionStore";
import type { useDatabaseExplorerStore } from "@/store/useDatabaseExplorerStore";
import type { useTabStore } from "@/store/useTabStore";

type TabState = ReturnType<typeof useTabStore.getState>;

type DatabaseExplorerState = ReturnType<
  typeof useDatabaseExplorerStore.getState
>;

type ConnectionState = ReturnType<typeof useConnectionStore.getState>;

export interface CreateConnectionTreeRendererContext {
  connectionVirtualWindow: import("@/features/database-explorer/runtime/explorerFlatTree").ExplorerVirtualWindow;
  activeConnectionId: ConnectionState["activeConnectionId"];
  selectedExplorerNodeIds: string[];
  connectingConnectionIds: string[];
  connectionRuntimeStates: ConnectionState["connectionRuntimeStates"];
  metadataForConnection: (
    connectionId: string,
    driver?: string | null | undefined,
  ) => {
    isActiveConnection: boolean;
    schemas: string[];
    currentSchema: string | null;
    defaultSchema: string | null;
    selectedTable: string | null;
    isLoading: boolean;
    nodeState: import("@/store/useSchemaStore").MetadataNodeState | undefined;
  };
  activeCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  schemaRows: string[];
  expandedConnectionIds: string[];
  deferredFilterText: string;
  explorerFilterMatches: (...values: unknown[]) => boolean;
  explorerFilterScope: import("@/store/useDatabaseExplorerStore").ExplorerFilterScope;
  explorerVisibilityFilters: Record<
    string,
    import("@/features/database-explorer/model/explorerVisibilityFilter").ExplorerVisibilityFilter
  >;
  schemaObjectsFor: (
    connectionId: string,
    driver: string | null | undefined,
    schema: string,
    databaseName?: string,
  ) => {
    tables: import("@/services/tauri/types").TableInfo[];
    collections: import("@/services/tauri/types").CollectionInfo[];
    functions: import("@/services/tauri/types").FunctionInfo[];
    pinnedTables: string[];
    hasSnapshot: boolean;
  };
  explorerConnectionGroupIds: Record<string, string>;
  explorerConnectionGroupById: Map<
    string,
    import("@/store/useDatabaseExplorerStore").ExplorerConnectionGroup
  >;
  visibleExplorerConnections: import("@/store/useConnectionStore").ConnectionConfig[];
  expandedObjectGroupKeys: string[];
  explorerConnectionGroupCounts: Map<string, number>;
  selectExplorerNode: React.ComponentProps<
    typeof ExplorerConnectionContents
  >["selectExplorerNode"];
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setConnectionGroupDraft: React.ComponentProps<
    typeof ExplorerConnectionMenu
  >["setConnectionGroupDraft"];
  handleNewDataSource: (
    driver: import("@/services/tauri/types").DatabaseDriver,
    connectionGroupId?: string | undefined,
  ) => void;
  moveExplorerConnectionsToGroup: DatabaseExplorerState["moveConnectionsToGroup"];
  explorerStateScope: string;
  placeExplorerConnectionGroup: DatabaseExplorerState["placeConnectionGroup"];
  deleteExplorerConnectionGroup: DatabaseExplorerState["deleteConnectionGroup"];
  setExplorerConnectionOrder: DatabaseExplorerState["setConnectionOrder"];
  setExplorerConnectionSortMode: DatabaseExplorerState["setConnectionSortMode"];
  connections: ConnectionState["connections"];
  handleConnectionSelect: React.ComponentProps<
    typeof ExplorerConnectionMenu
  >["handleConnectionSelect"];
  handleConnectionToggle: (
    connectionId: string,
    forceExpanded?: boolean | undefined,
  ) => Promise<void>;
  showExplorerHoverTooltips: boolean;
  connectedConnectionIds: ConnectionState["connectedConnectionIds"];
  databaseExplorerSettings: {
    activationMode: import("@/lib/appSettings").ExplorerActivationMode;
    refreshMode: "manual" | "cache-first";
    showOnlySelectedSchemas: boolean;
    showCacheBadges: boolean;
    showConnectionNotes: boolean;
    showHoverTooltips: boolean;
    allowHorizontalScroll: boolean;
    objectBrowserViewMode: "grid" | "list";
  };
  isLoading: boolean;
  isCollectionsLoading: boolean;
  renderSchemaVisibilityPicker: () => import("react").JSX.Element | null;

  setActiveConnection: ConnectionState["setActiveConnection"];
  disconnect: ConnectionState["disconnect"];
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  createTab: TabState["createTab"];
  renderSqlHistorySubmenu: React.ComponentProps<
    typeof ExplorerConnectionContents
  >["renderSqlHistorySubmenu"];

  currentSchema: string | null;
  canBrowseTables: boolean;

  setIsCreateDbDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  namespaceLabel: string;
  handleCreateTable: () => void;
  setIsCreateRedisKeyOpen: React.Dispatch<React.SetStateAction<boolean>>;
  copyText: (value: string) => Promise<void>;
  hideExplorerNodes: DatabaseExplorerState["hideNodes"];
  explorerConnectionFilterParentId: string;
  connectionIdsForExplorerAction: (connectionId: string) => string[];
  showOnlyExplorerNodes: DatabaseExplorerState["showOnlyNodes"];
  explorerConnectionVisibilityFilter:
    | import("@/features/database-explorer/model/explorerVisibilityFilter").ExplorerVisibilityFilter
    | undefined;
  clearExplorerVisibilityFilter: DatabaseExplorerState["clearVisibilityFilter"];
  openExplorerVisibilityFilter: (parentNodeId: string, label: string) => void;
  openDatabaseBrowser: TabState["openDatabaseBrowser"];
  openRocketMqWorkspace: TabState["openRocketMqWorkspace"];
  handleRefreshConnection: (connectionId: string) => Promise<void>;
  handleForgetConnectionMetadata: (
    connectionId: string,
    connectionName: string,
  ) => Promise<void>;
  handleOpenConnectionProperties: (connectionId: string) => void;
  handleDuplicateConnection: (
    connection: import("@/store/useConnectionStore").ConnectionConfig,
  ) => void;
  explorerConnectionGroups: import("@/store/useDatabaseExplorerStore").ExplorerConnectionGroup[];
  setDatabaseAdministrationConnectionId: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  setSqliteBackupTarget: React.ComponentProps<
    typeof ExplorerConnectionMenu
  >["setSqliteBackupTarget"];
  handleImportSqlScript: React.ComponentProps<
    typeof ExplorerConnectionContents
  >["handleImportSqlScript"];
  setDataSourceRemovalError: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  setPendingDataSourceRemoval: React.Dispatch<
    React.SetStateAction<{ id: string; name: string } | null>
  >;
  postgresDatabaseRefreshVersion: number;
  postgresDatabaseDiscovery: import("@/hooks/usePostgresDatabaseDiscovery").PostgresDatabaseDiscoveryState;
  schemaCountLabel: string;
  visiblePostgresDatabases: string[];
  postgresDatabaseMatchesFilter: (
    connectionId: string,
    database: string,
    currentDatabase: string,
    filter: string,
  ) => boolean;
  loadPostgresRemoteDatabase: (
    connectionId: string,
    database: string,
  ) => Promise<void>;
  postgresRemoteDatabases: import("@/features/database-explorer/model/explorerSidebarTypes").PostgresRemoteDatabaseState;
  openObjectBrowser: TabState["openObjectBrowser"];
  handleOpenDataTransfer: React.ComponentProps<
    typeof ExplorerConnectionContents
  >["handleOpenDataTransfer"];
  handleOpenDataCompare: React.ComponentProps<
    typeof ExplorerConnectionContents
  >["handleOpenDataCompare"];
  setSchemaSnapshotIdentity: React.Dispatch<
    React.SetStateAction<
      import("@/services/schemaSnapshotStore").SchemaSnapshotIdentity | null
    >
  >;
  activeProjectId: string;
  postgresRemoteRefreshRequest: {
    connectionId: string;
    database: string;
    version: number;
    schema?: string | undefined;
  } | null;
  handlePostgresRemoteTablesLoaded: React.ComponentProps<
    typeof ExplorerConnectionContents
  >["handlePostgresRemoteTablesLoaded"];
  explorerActivationMode: import("@/lib/appSettings").ExplorerActivationMode;
  setDatabaseMaintenanceTarget: React.ComponentProps<
    typeof ExplorerConnectionContents
  >["setDatabaseMaintenanceTarget"];
  handlePostgresRemoteTableOpen: React.ComponentProps<
    typeof ExplorerConnectionContents
  >["handlePostgresRemoteTableOpen"];
  namespaceLabelPlural: string;
  filterText: string;
  expandedSchemaKeys: string[];
  metadataNodeStates: Record<
    string,
    import("@/store/useSchemaStore").MetadataNodeState
  >;
  activateSchemaRow: React.ComponentProps<
    typeof ExplorerConnectionContents
  >["activateSchemaRow"];
  handleSchemaToggle: (
    connectionId: string,
    schema: string,
    isCurrentSchema: boolean,
    forceExpanded?: boolean | undefined,
  ) => Promise<void>;
  runForExplorerSchema: (
    connectionId: string,
    schema: string,
    action: () => void | Promise<void>,
  ) => Promise<void>;
  createTableTab: TabState["createTableTab"];
  setViewDialogMode: React.Dispatch<React.SetStateAction<"create" | "edit">>;
  setViewDialogKind: React.Dispatch<
    React.SetStateAction<"view" | "materializedView">
  >;
  setViewDialogInitialName: React.Dispatch<React.SetStateAction<string>>;
  setViewDialogInitialSql: React.Dispatch<React.SetStateAction<string>>;
  setIsCreateViewDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleRefreshSchema: (connectionId: string, schema: string) => Promise<void>;
  handleForgetSchemaMetadata: (
    connectionId: string,
    driver: string | null | undefined,
    schema: string,
  ) => Promise<void>;
  schemaDiagramLoadingKey: string | null;
  handleOpenSchemaDiagram: React.ComponentProps<
    typeof ExplorerConnectionContents
  >["handleOpenSchemaDiagram"];
  handleRenameDatabase: React.ComponentProps<
    typeof ExplorerConnectionContents
  >["handleRenameDatabase"];
  handleDropDatabase: React.ComponentProps<
    typeof ExplorerConnectionContents
  >["handleDropDatabase"];
  renderSchemaObjects: React.ComponentProps<
    typeof ExplorerConnectionContents
  >["renderSchemaObjects"];
}
