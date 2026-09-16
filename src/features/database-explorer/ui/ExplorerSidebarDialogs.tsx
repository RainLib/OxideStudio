import { SqlScriptImportDialog } from "@/components/workspace/SqlScriptImportDialog";
import { ExplorerConnectionGroupDialog } from "@/features/database-explorer/ui/ExplorerConnectionGroupDialog";
import { ExplorerObjectDialogs } from "@/features/database-explorer/ui/ExplorerObjectDialogs";
import { ExplorerRemoveDataSourceDialog } from "@/features/database-explorer/ui/ExplorerRemoveDataSourceDialog";
import { ExplorerTransferDialogs } from "@/features/database-explorer/ui/ExplorerTransferDialogs";
import { ExplorerVisibilityFilterDialog } from "@/features/database-explorer/ui/ExplorerVisibilityFilterDialog";

interface ExplorerSidebarDialogsContext {
  pendingSqlScriptImport:
    | import("@/features/sql-script-import/useSqlScriptImportController").PendingSqlScriptImport
    | null;
  isSqlScriptImporting: boolean;
  closeSqlScriptImport: (detail?: string | undefined) => void;
  handleConfirmSqlScriptImport: () => Promise<void>;
  connectionGroupDraft: {
    mode: "create" | "rename";
    groupId?: string | undefined;
    name: string;
  } | null;
  setConnectionGroupDraft: React.Dispatch<
    React.SetStateAction<{
      mode: "create" | "rename";
      groupId?: string | undefined;
      name: string;
    } | null>
  >;
  renameExplorerConnectionGroup: (
    scopeId: string,
    groupId: string,
    name: string,
  ) => void;
  explorerStateScope: string;
  createExplorerConnectionGroup: (
    scopeId: string,
    name: string,
    parentId?: string | null | undefined,
  ) => string;
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
  isDataSourceDialogOpen: boolean;
  setIsDataSourceDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  schemaSnapshotIdentity:
    | import("@/services/schemaSnapshotStore").SchemaSnapshotIdentity
    | null;
  setSchemaSnapshotIdentity: React.Dispatch<
    React.SetStateAction<
      import("@/services/schemaSnapshotStore").SchemaSnapshotIdentity | null
    >
  >;
  dataTransferRequest:
    | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerDataTransferRequest
    | null;
  activeProjectId: string;
  connections: import("@/features/connections/model/types").ConnectionConfig[];
  setDataTransferRequest: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerDataTransferRequest
      | null
    >
  >;
  handleRefreshSchema: (connectionId: string, schema: string) => Promise<void>;
  mongoCollectionTransferRequest:
    | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerMongoCollectionTransferRequest
    | null;
  setMongoCollectionTransferRequest: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerMongoCollectionTransferRequest
      | null
    >
  >;
  activeConnectionId: string | null;
  refreshCollectionObjects: () => Promise<void>;
  dataCompareRequest:
    | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerDataCompareRequest
    | null;
  setDataCompareRequest: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerDataCompareRequest
      | null
    >
  >;
  nacosConfigTransferRequest:
    | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerNacosConfigTransferRequest
    | null;
  setNacosConfigTransferRequest: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerNacosConfigTransferRequest
      | null
    >
  >;
  elasticsearchMetadataTarget: {
    connectionId: string;
    driver: string;
    index: string;
    kind: import("@/services/tauri/types/elasticsearch").SearchIndexMetadataKind;
  } | null;
  setElasticsearchMetadataTarget: React.Dispatch<
    React.SetStateAction<{
      connectionId: string;
      driver: string;
      index: string;
      kind: import("@/services/tauri/types/elasticsearch").SearchIndexMetadataKind;
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
    _result: import("@/services/tauri/types/elasticsearch").SearchIndexClearResult,
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
  clearExplorerVisibilityFilter: (
    scopeId: string,
    parentNodeId: string,
  ) => void;
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
  setDatabaseAdministrationConnectionId: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  activeDriver: import("@/services/tauri/types/database").DatabaseDriver;
  databaseMaintenanceTarget:
    | import("@/features/database-admin/ui/DatabaseMaintenanceDialog").DatabaseMaintenanceTarget
    | null;
  setDatabaseMaintenanceTarget: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-admin/ui/DatabaseMaintenanceDialog").DatabaseMaintenanceTarget
      | null
    >
  >;
  sqliteBackupTarget:
    | import("@/features/database-admin/ui/SqliteBackupDialog").SqliteBackupTarget
    | null;
  setSqliteBackupTarget: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-admin/ui/SqliteBackupDialog").SqliteBackupTarget
      | null
    >
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
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;
  ddlViewerOpen: boolean;
  setDdlViewerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  ddlContent: string;
  columnsDialogOpen: boolean;
  setColumnsDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentSchema: string | null;
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

export function ExplorerSidebarDialogs({
  pendingSqlScriptImport,
  isSqlScriptImporting,
  closeSqlScriptImport,
  handleConfirmSqlScriptImport,
  connectionGroupDraft,
  setConnectionGroupDraft,
  renameExplorerConnectionGroup,
  explorerStateScope,
  createExplorerConnectionGroup,
  setExpandedObjectGroupKeys,
  isDataSourceDialogOpen,
  setIsDataSourceDialogOpen,
  schemaSnapshotIdentity,
  setSchemaSnapshotIdentity,
  dataTransferRequest,
  activeProjectId,
  connections,
  setDataTransferRequest,
  handleRefreshSchema,
  mongoCollectionTransferRequest,
  setMongoCollectionTransferRequest,
  activeConnectionId,
  refreshCollectionObjects,
  dataCompareRequest,
  setDataCompareRequest,
  nacosConfigTransferRequest,
  setNacosConfigTransferRequest,
  elasticsearchMetadataTarget,
  setElasticsearchMetadataTarget,
  elasticsearchClearTarget,
  setElasticsearchClearTarget,
  handleElasticsearchIndexCleared,
  visibilityFilterDraft,
  setVisibilityFilterDraft,
  clearExplorerVisibilityFilter,
  setExplorerVisibilityPatterns,
  pendingDataSourceRemoval,
  isRemovingDataSource,
  setPendingDataSourceRemoval,
  setDataSourceRemovalError,
  dataSourceRemovalError,
  handleRemoveDataSource,
  databaseAdministrationConnectionId,
  setDatabaseAdministrationConnectionId,
  activeDriver,
  databaseMaintenanceTarget,
  setDatabaseMaintenanceTarget,
  sqliteBackupTarget,
  setSqliteBackupTarget,
  handleRefreshConnection,
  isCreateDbDialogOpen,
  setIsCreateDbDialogOpen,
  setExpandedConnectionIds,
  setExpandedSchemaKeys,
  renameDialogOpen,
  setRenameDialogOpen,
  activeTable,
  activeTableType,
  renameTable,
  ddlViewerOpen,
  setDdlViewerOpen,
  ddlContent,
  columnsDialogOpen,
  setColumnsDialogOpen,
  currentSchema,
  isCreateViewDialogOpen,
  setIsCreateViewDialogOpen,
  viewDialogMode,
  viewDialogKind,
  viewDialogInitialName,
  viewDialogInitialSql,
  isCreateRedisKeyOpen,
  collectionNamespace,
  setIsCreateRedisKeyOpen,
  handleCreateRedisKey,
}: ExplorerSidebarDialogsContext) {
  return (
    <>
      <SqlScriptImportDialog
        open={Boolean(pendingSqlScriptImport)}
        preview={pendingSqlScriptImport?.preview || null}
        target={pendingSqlScriptImport?.target.label || "selected data source"}
        isSubmitting={isSqlScriptImporting}
        onClose={closeSqlScriptImport}
        onImport={handleConfirmSqlScriptImport}
      />

      <ExplorerConnectionGroupDialog
        connectionGroupDraft={connectionGroupDraft}
        setConnectionGroupDraft={setConnectionGroupDraft}
        renameExplorerConnectionGroup={renameExplorerConnectionGroup}
        explorerStateScope={explorerStateScope}
        createExplorerConnectionGroup={createExplorerConnectionGroup}
        setExpandedObjectGroupKeys={setExpandedObjectGroupKeys}
      />

      <ExplorerTransferDialogs
        isDataSourceDialogOpen={isDataSourceDialogOpen}
        setIsDataSourceDialogOpen={setIsDataSourceDialogOpen}
        schemaSnapshotIdentity={schemaSnapshotIdentity}
        setSchemaSnapshotIdentity={setSchemaSnapshotIdentity}
        dataTransferRequest={dataTransferRequest}
        activeProjectId={activeProjectId}
        connections={connections}
        setDataTransferRequest={setDataTransferRequest}
        handleRefreshSchema={handleRefreshSchema}
        mongoCollectionTransferRequest={mongoCollectionTransferRequest}
        setMongoCollectionTransferRequest={setMongoCollectionTransferRequest}
        activeConnectionId={activeConnectionId}
        refreshCollectionObjects={refreshCollectionObjects}
        dataCompareRequest={dataCompareRequest}
        setDataCompareRequest={setDataCompareRequest}
        nacosConfigTransferRequest={nacosConfigTransferRequest}
        setNacosConfigTransferRequest={setNacosConfigTransferRequest}
        elasticsearchMetadataTarget={elasticsearchMetadataTarget}
        setElasticsearchMetadataTarget={setElasticsearchMetadataTarget}
        elasticsearchClearTarget={elasticsearchClearTarget}
        setElasticsearchClearTarget={setElasticsearchClearTarget}
        handleElasticsearchIndexCleared={handleElasticsearchIndexCleared}
      />

      <ExplorerVisibilityFilterDialog
        visibilityFilterDraft={visibilityFilterDraft}
        setVisibilityFilterDraft={setVisibilityFilterDraft}
        clearExplorerVisibilityFilter={clearExplorerVisibilityFilter}
        explorerStateScope={explorerStateScope}
        setExplorerVisibilityPatterns={setExplorerVisibilityPatterns}
      />

      <ExplorerRemoveDataSourceDialog
        pendingDataSourceRemoval={pendingDataSourceRemoval}
        isRemovingDataSource={isRemovingDataSource}
        setPendingDataSourceRemoval={setPendingDataSourceRemoval}
        setDataSourceRemovalError={setDataSourceRemovalError}
        dataSourceRemovalError={dataSourceRemovalError}
        handleRemoveDataSource={handleRemoveDataSource}
      />

      <ExplorerObjectDialogs
        databaseAdministrationConnectionId={databaseAdministrationConnectionId}
        setDatabaseAdministrationConnectionId={
          setDatabaseAdministrationConnectionId
        }
        connections={connections}
        activeDriver={activeDriver}
        databaseMaintenanceTarget={databaseMaintenanceTarget}
        setDatabaseMaintenanceTarget={setDatabaseMaintenanceTarget}
        sqliteBackupTarget={sqliteBackupTarget}
        setSqliteBackupTarget={setSqliteBackupTarget}
        handleRefreshConnection={handleRefreshConnection}
        isCreateDbDialogOpen={isCreateDbDialogOpen}
        setIsCreateDbDialogOpen={setIsCreateDbDialogOpen}
        activeConnectionId={activeConnectionId}
        setExpandedConnectionIds={setExpandedConnectionIds}
        setExpandedSchemaKeys={setExpandedSchemaKeys}
        setExpandedObjectGroupKeys={setExpandedObjectGroupKeys}
        renameDialogOpen={renameDialogOpen}
        setRenameDialogOpen={setRenameDialogOpen}
        activeTable={activeTable}
        activeTableType={activeTableType}
        renameTable={renameTable}
        ddlViewerOpen={ddlViewerOpen}
        setDdlViewerOpen={setDdlViewerOpen}
        ddlContent={ddlContent}
        columnsDialogOpen={columnsDialogOpen}
        setColumnsDialogOpen={setColumnsDialogOpen}
        currentSchema={currentSchema}
        isCreateViewDialogOpen={isCreateViewDialogOpen}
        setIsCreateViewDialogOpen={setIsCreateViewDialogOpen}
        viewDialogMode={viewDialogMode}
        viewDialogKind={viewDialogKind}
        viewDialogInitialName={viewDialogInitialName}
        viewDialogInitialSql={viewDialogInitialSql}
        isCreateRedisKeyOpen={isCreateRedisKeyOpen}
        collectionNamespace={collectionNamespace}
        setIsCreateRedisKeyOpen={setIsCreateRedisKeyOpen}
        handleCreateRedisKey={handleCreateRedisKey}
      />
    </>
  );
}
