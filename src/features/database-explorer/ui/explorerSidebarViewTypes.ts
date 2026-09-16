import type { ConnectionConfig } from "@/features/connections/model/types";
import type { DatabaseMaintenanceTarget } from "@/features/database-admin/ui/DatabaseMaintenanceDialog";
import type { SqliteBackupTarget } from "@/features/database-admin/ui/SqliteBackupDialog";
import type { ExplorerGroupDropPlacement } from "@/features/database-explorer/model/explorerGroupOrder";
import type { ExplorerSearchPattern } from "@/features/database-explorer/model/explorerSearchPattern";
import type {
  ExplorerDataCompareRequest,
  ExplorerDataTransferRequest,
  ExplorerMongoCollectionTransferRequest,
  ExplorerNacosConfigTransferRequest,
} from "@/features/database-explorer/model/explorerSidebarTypes";
import type { ExplorerVisibilityFilter } from "@/features/database-explorer/model/explorerVisibilityFilter";
import type { ExplorerVirtualWindow } from "@/features/database-explorer/runtime/explorerFlatTree";
import type { WorkbenchToolWindowId } from "@/features/settings/model/settingsTypes";
import type { PendingSqlScriptImport } from "@/features/sql-script-import/useSqlScriptImportController";
import type { TableOperationTarget } from "@/hooks/useTableOperations";
import type { SchemaSnapshotIdentity } from "@/services/schemaSnapshotStore";
import type {
  DatabaseCapabilities,
  DatabaseDriver,
} from "@/services/tauri/types/database";
import type {
  SearchIndexClearResult,
  SearchIndexMetadataKind,
} from "@/services/tauri/types/elasticsearch";
import type { ConnectionDisplaySummary } from "@/startup/dataSourceDisplayCache";
import type {
  ExplorerConnectionGroup,
  ExplorerConnectionSortMode,
  ExplorerFilterScope,
  ExplorerSearchMode,
  ExplorerViewMode,
} from "@/store/useDatabaseExplorerStore";
import type { JSX } from "react";
export interface ExplorerSidebarViewContext {
  explorerViewMode: ExplorerViewMode;
  allowExplorerHorizontalScroll: boolean;
  handleExplorerKeyDownCapture: (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void;
  isLoading: boolean;
  handleRevealActiveConnection: () => void;
  handleExpandActiveConnection: () => void;
  handleCollapseAll: () => void;
  handleRefresh: () => Promise<void>;
  setToolWindowVisible: (id: WorkbenchToolWindowId, visible: boolean) => void;
  explorerFilterScope: ExplorerFilterScope;
  explorerConnectionSortMode: ExplorerConnectionSortMode;
  setExplorerViewMode: (scopeId: string, viewMode: ExplorerViewMode) => void;
  explorerStateScope: string;
  setExplorerFilterScope: (
    scopeId: string,
    filterScope: ExplorerFilterScope,
  ) => void;
  setExplorerConnectionSortMode: (
    scopeId: string,
    sortMode: ExplorerConnectionSortMode,
  ) => void;
  namespaceLabel: string;
  activeCapabilities: DatabaseCapabilities;
  currentSchema: string | null;
  canBrowseTables: boolean;
  activeConnectionId: string | null;
  activeDriver: DatabaseDriver;
  handleNewQueryConsole: () => void;
  handleNewDataSource: (
    driver: DatabaseDriver,
    connectionGroupId?: string | undefined,
  ) => void;
  setConnectionGroupDraft: React.Dispatch<
    React.SetStateAction<{
      mode: "create" | "rename";
      groupId?: string | undefined;
      name: string;
    } | null>
  >;
  handleCreateDatabase: () => void;
  handleCreateTable: () => void;
  handleCreateView: () => void;
  filterInputRef: React.RefObject<HTMLInputElement | null>;
  setDatabaseAdministrationConnectionId: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  filterText: string;
  setFilterText: React.Dispatch<React.SetStateAction<string>>;
  explorerSearchPattern: ExplorerSearchPattern;
  explorerRegexSearch: boolean;
  setExplorerRegexSearch: (scopeId: string, regexSearch: boolean) => void;
  explorerSearchMode: ExplorerSearchMode;
  setExplorerSearchMode: (
    scopeId: string,
    searchMode: ExplorerSearchMode,
  ) => void;
  explorerConnectionVisibilityFilter: ExplorerVisibilityFilter | undefined;
  clearExplorerVisibilityFilter: (
    scopeId: string,
    parentNodeId: string,
  ) => void;
  explorerConnectionFilterParentId: string;
  showConnectedConnectionsOnly: boolean;
  connectedConnectionIds: string[];
  setShowConnectedConnectionsOnly: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  explorerTreeRowHeight: 22 | 28;
  explorerScrollRef: React.RefObject<HTMLDivElement | null>;
  connectionVirtualizationArmed: boolean;
  setExplorerScrollMetrics: React.Dispatch<
    React.SetStateAction<{ scrollTop: number; viewportHeight: number }>
  >;
  connections: ConnectionConfig[];
  connectionDisplayCache: ConnectionDisplaySummary[];
  connectionLoadError: string | null;
  loadConnections: () => Promise<void>;
  connectionsLoading: boolean;
  hasConnectionDisplayCache: boolean;
  moveExplorerConnectionsToGroup: (
    scopeId: string,
    connectionIds: readonly string[],
    groupId: string | null,
  ) => void;
  moveExplorerConnectionGroup: (
    scopeId: string,
    groupId: string,
    parentId: string | null,
  ) => void;
  connectionVirtualWindow: ExplorerVirtualWindow;
  visibleExplorerConnections: ConnectionConfig[];
  deferredFilterText: string;
  orderedExplorerConnectionGroups: ExplorerConnectionGroup[];
  explorerConnectionGroupById: Map<string, ExplorerConnectionGroup>;
  expandedObjectGroupKeys: string[];
  explorerConnectionGroupCounts: Map<string, number>;
  explorerConnectionGroupIds: Record<string, string>;
  selectedExplorerNodeIds: string[];
  selectExplorerNode: (
    nodeId: string,
    event?:
      | {
          currentTarget: HTMLElement;
          ctrlKey: boolean;
          metaKey: boolean;
          shiftKey: boolean;
        }
      | undefined,
  ) => void;
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
  placeExplorerConnectionGroup: (
    scopeId: string,
    groupId: string,
    targetGroupId: string,
    placement: ExplorerGroupDropPlacement,
  ) => void;
  deleteExplorerConnectionGroup: (scopeId: string, groupId: string) => void;
  renderedExplorerConnections: ConnectionConfig[];
  renderConnection: (
    connection: ConnectionConfig,
    renderedConnectionIndex: number,
  ) => JSX.Element;
  namespaceError: string | null;
  pendingSqlScriptImport: PendingSqlScriptImport | null;
  isSqlScriptImporting: boolean;
  closeSqlScriptImport: (detail?: string) => void;
  handleConfirmSqlScriptImport: () => Promise<void>;
  connectionGroupDraft: {
    mode: "create" | "rename";
    groupId?: string | undefined;
    name: string;
  } | null;
  renameExplorerConnectionGroup: (
    scopeId: string,
    groupId: string,
    name: string,
  ) => void;
  createExplorerConnectionGroup: (
    scopeId: string,
    name: string,
    parentId?: string | null | undefined,
  ) => string;
  isDataSourceDialogOpen: boolean;
  setIsDataSourceDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  schemaSnapshotIdentity: SchemaSnapshotIdentity | null;
  setSchemaSnapshotIdentity: React.Dispatch<
    React.SetStateAction<SchemaSnapshotIdentity | null>
  >;
  dataTransferRequest: ExplorerDataTransferRequest | null;
  activeProjectId: string;
  setDataTransferRequest: React.Dispatch<
    React.SetStateAction<ExplorerDataTransferRequest | null>
  >;
  handleRefreshSchema: (connectionId: string, schema: string) => Promise<void>;
  mongoCollectionTransferRequest: ExplorerMongoCollectionTransferRequest | null;
  setMongoCollectionTransferRequest: React.Dispatch<
    React.SetStateAction<ExplorerMongoCollectionTransferRequest | null>
  >;
  refreshCollectionObjects: () => Promise<void>;
  dataCompareRequest: ExplorerDataCompareRequest | null;
  setDataCompareRequest: React.Dispatch<
    React.SetStateAction<ExplorerDataCompareRequest | null>
  >;
  nacosConfigTransferRequest: ExplorerNacosConfigTransferRequest | null;
  setNacosConfigTransferRequest: React.Dispatch<
    React.SetStateAction<ExplorerNacosConfigTransferRequest | null>
  >;
  elasticsearchMetadataTarget: {
    connectionId: string;
    driver: string;
    index: string;
    kind: SearchIndexMetadataKind;
  } | null;
  setElasticsearchMetadataTarget: React.Dispatch<
    React.SetStateAction<{
      connectionId: string;
      driver: string;
      index: string;
      kind: SearchIndexMetadataKind;
    } | null>
  >;
  elasticsearchClearTarget: {
    connectionId: string;
    driver: string;
    schema: string;
    index: string;
  } | null;
  setElasticsearchClearTarget: React.Dispatch<
    React.SetStateAction<{
      connectionId: string;
      driver: string;
      schema: string;
      index: string;
    } | null>
  >;
  handleElasticsearchIndexCleared: (
    _result: SearchIndexClearResult,
    clearedIndex: string,
  ) => Promise<void>;
  visibilityFilterDraft: {
    parentNodeId: string;
    label: string;
    includePatterns: string;
    excludePatterns: string;
  } | null;
  setVisibilityFilterDraft: React.Dispatch<
    React.SetStateAction<{
      parentNodeId: string;
      label: string;
      includePatterns: string;
      excludePatterns: string;
    } | null>
  >;
  setExplorerVisibilityPatterns: (
    scopeId: string,
    parentNodeId: string,
    includePatterns: readonly string[],
    excludePatterns: readonly string[],
  ) => void;
  pendingDataSourceRemoval: { id: string; name: string } | null;
  isRemovingDataSource: boolean;
  setPendingDataSourceRemoval: React.Dispatch<
    React.SetStateAction<{ id: string; name: string } | null>
  >;
  setDataSourceRemovalError: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  dataSourceRemovalError: string | null;
  handleRemoveDataSource: () => Promise<void>;
  databaseAdministrationConnectionId: string | null;
  databaseMaintenanceTarget: DatabaseMaintenanceTarget | null;
  setDatabaseMaintenanceTarget: React.Dispatch<
    React.SetStateAction<DatabaseMaintenanceTarget | null>
  >;
  sqliteBackupTarget: SqliteBackupTarget | null;
  setSqliteBackupTarget: React.Dispatch<
    React.SetStateAction<SqliteBackupTarget | null>
  >;
  handleRefreshConnection: (connectionId: string) => Promise<void>;
  isCreateDbDialogOpen: boolean;
  setIsCreateDbDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setExpandedConnectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedSchemaKeys: React.Dispatch<React.SetStateAction<string[]>>;
  renameDialogOpen: boolean;
  setRenameDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeTable: string;
  activeTableType: string | null;
  renameTable: (
    oldName: string,
    newName: string,
    objectType?: string | null | undefined,
    target?: TableOperationTarget | undefined,
  ) => Promise<void>;
  ddlViewerOpen: boolean;
  setDdlViewerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  ddlContent: string;
  columnsDialogOpen: boolean;
  setColumnsDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isCreateViewDialogOpen: boolean;
  setIsCreateViewDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  viewDialogMode: "create" | "edit";
  viewDialogKind: "view" | "materializedView";
  viewDialogInitialName: string;
  viewDialogInitialSql: string;
  isCreateRedisKeyOpen: boolean;
  collectionNamespace: string;
  setIsCreateRedisKeyOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleCreateRedisKey: (name: string, command: string) => Promise<void>;
}
