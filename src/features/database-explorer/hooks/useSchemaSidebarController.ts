import type {
  DatabaseMaintenanceTarget,
  SqliteBackupTarget,
} from "@/features/database-admin";
import { useExplorerActiveConnectionReveal } from "@/features/database-explorer/hooks/useExplorerActiveConnectionReveal";
import { useExplorerCatalogSearch } from "@/features/database-explorer/hooks/useExplorerCatalogSearch";
import { useExplorerCatalogVisibility } from "@/features/database-explorer/hooks/useExplorerCatalogVisibility";
import { useExplorerDataWorkspaces } from "@/features/database-explorer/hooks/useExplorerDataWorkspaces";
import { useExplorerExpandedMetadata } from "@/features/database-explorer/hooks/useExplorerExpandedMetadata";
import { useExplorerNamespaceLoading } from "@/features/database-explorer/hooks/useExplorerNamespaceLoading";
import { useExplorerObjectReveal } from "@/features/database-explorer/hooks/useExplorerObjectReveal";
import { useExplorerObjectWorkspace } from "@/features/database-explorer/hooks/useExplorerObjectWorkspace";
import { useExplorerRemoteCatalogReset } from "@/features/database-explorer/hooks/useExplorerRemoteCatalogReset";
import { useExplorerRemoteCatalogState } from "@/features/database-explorer/hooks/useExplorerRemoteCatalogState";
import { useExplorerSchemaObjects } from "@/features/database-explorer/hooks/useExplorerSchemaObjects";
import { useExplorerSourceContext } from "@/features/database-explorer/hooks/useExplorerSourceContext";
import { useExplorerSqlImport } from "@/features/database-explorer/hooks/useExplorerSqlImport";
import { useExplorerTabActions } from "@/features/database-explorer/hooks/useExplorerTabActions";
import { useExplorerTreePreferences } from "@/features/database-explorer/hooks/useExplorerTreePreferences";
import { useExplorerWorkspaceData } from "@/features/database-explorer/hooks/useExplorerWorkspaceData";
import { createExplorerCollectionActions } from "@/features/database-explorer/model/createExplorerCollectionActions";
import { createExplorerCollectionQueries } from "@/features/database-explorer/model/createExplorerCollectionQueries";
import { createExplorerConnectionActions } from "@/features/database-explorer/model/createExplorerConnectionActions";
import { createExplorerConnectionMetadataLookup } from "@/features/database-explorer/model/createExplorerConnectionMetadataLookup";
import { createExplorerConnectionRemoval } from "@/features/database-explorer/model/createExplorerConnectionRemoval";
import { createExplorerNamespaceActions } from "@/features/database-explorer/model/createExplorerNamespaceActions";
import { createExplorerRefreshActions } from "@/features/database-explorer/model/createExplorerRefreshActions";
import { createExplorerSchemaActivation } from "@/features/database-explorer/model/createExplorerSchemaActivation";
import { createExplorerTableBatchActions } from "@/features/database-explorer/model/createExplorerTableBatchActions";
import { createExplorerTableOpenActions } from "@/features/database-explorer/model/createExplorerTableOpenActions";
import { createExplorerTreeNavigation } from "@/features/database-explorer/model/createExplorerTreeNavigation";
import { type ExplorerTableBatchSelection } from "@/features/database-explorer/model/explorerSidebarTypes";
import { type TableBatchFailureDetail } from "@/features/database-explorer/model/tableBatchSelection";
import { useDatabaseNavigationStore } from "@/lib/databaseNavigation";
import type { SearchIndexMetadataKind } from "@/services/tauri/types";
import { useDeferredValue, useRef, useState } from "react";


export function useSchemaSidebarController() {
  const workspaceData = useExplorerWorkspaceData();
  const {
    activeProjectId,
    connectedConnectionIds,
    connections,
    activeConnectionId,
    connectionAvailabilityKey,
    setActiveConnection,
    bumpMetadataVersion,
    loadSchemas,
    loadTables,
    metadataVersion,
    currentSchema,
    defaultSchema,
    schemas,
    connectionSnapshots,
    selectedTable,
    isLoading,
    metadataNodeStates,
    hydrateConnectionMetadataFromCache,
    hydrateSchemaObjectsFromCache,
    loadCollections,
    loadFunctions,
    collections,
    functions,
    objectSnapshots,
    pinnedTables,
    tables,
    createNewConnection,
    updateConnectionConfig,
    selectConnection,
    removeConnection,
    forgetConnectionMetadata,
    setCurrentSchema,
    selectTable,
    forgetSchemaMetadata,
    loadSchemaObjectsForSearch,
  } = workspaceData;

  const [filterText, setFilterText] = useState("");
  const deferredFilterText = useDeferredValue(filterText);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [showConnectedConnectionsOnly, setShowConnectedConnectionsOnly] =
    useState(false);
  const [isDataSourceDialogOpen, setIsDataSourceDialogOpen] = useState(false);
  const [isCreateDbDialogOpen, setIsCreateDbDialogOpen] = useState(false);
  const [isCreateRedisKeyOpen, setIsCreateRedisKeyOpen] = useState(false);
  const [connectionGroupDraft, setConnectionGroupDraft] = useState<{
    mode: "create" | "rename";
    groupId?: string;
    name: string;
  } | null>(null);
  const [visibilityFilterDraft, setVisibilityFilterDraft] = useState<{
    parentNodeId: string;
    label: string;
    includePatterns: string;
    excludePatterns: string;
  } | null>(null);
  const [
    databaseAdministrationConnectionId,
    setDatabaseAdministrationConnectionId,
  ] = useState<string | null>(null);
  const [databaseMaintenanceTarget, setDatabaseMaintenanceTarget] =
    useState<DatabaseMaintenanceTarget | null>(null);
  const [sqliteBackupTarget, setSqliteBackupTarget] =
    useState<SqliteBackupTarget | null>(null);
  const [connectingConnectionIds, setConnectingConnectionIds] = useState<
    string[]
  >([]);
  const treePreferences = useExplorerTreePreferences({
    activeProjectId,
    deferredFilterText,
    setVisibilityFilterDraft,
    connectedConnectionIds,
    connections,
    showConnectedConnectionsOnly,
    setShowConnectedConnectionsOnly,
  });
  const {
    setExpandedConnectionIds,
    explorerConnectionGroupIds,
    setExpandedObjectGroupKeys,
    expandedObjectGroupKeys,
    expandedSchemaKeys,
    explorerRegexSearch,
    explorerFilterMatches,
    explorerVisibilityFilters,
    moveExplorerConnectionsToGroup,
    explorerStateScope,
    selectedExplorerNodeIds,
    setExpandedSchemaKeys,
    selectExplorerNode,
    expandedConnectionIds,
    explorerSearchMode,
    explorerFilterScope,
  } = treePreferences;
  useExplorerActiveConnectionReveal({
    activeConnectionId,
    setExpandedConnectionIds,
    explorerConnectionGroupIds,
    setExpandedObjectGroupKeys,
  });

  const databaseRevealRequest = useDatabaseNavigationStore(
    (state) => state.revealRequest,
  );
  const clearDatabaseReveal = useDatabaseNavigationStore(
    (state) => state.clearReveal,
  );
  const [elasticsearchMetadataTarget, setElasticsearchMetadataTarget] =
    useState<{
      connectionId: string;
      driver: string;
      index: string;
      kind: SearchIndexMetadataKind;
    } | null>(null);
  const [elasticsearchClearTarget, setElasticsearchClearTarget] = useState<{
    connectionId: string;
    driver: string;
    schema: string;
    index: string;
  } | null>(null);
  const remoteCatalog = useExplorerRemoteCatalogState();
  const {
    setPostgresDatabaseRefreshVersion,
    postgresDatabaseRefreshVersion,
    postgresRemoteContextVersion,
    setPostgresRemoteDatabases,
    postgresRemoteDatabases,
    postgresRemoteRefreshVersionRef,
    setPostgresRemoteRefreshRequest,
    postgresRemoteRequestCounter,
    postgresRemoteRequestIds,
  } = remoteCatalog;

  const [namespaceError, setNamespaceError] = useState<string | null>(null);
  const {
    pendingSqlScriptImport,
    isSqlScriptImporting,
    requestSqlScriptImport,
    handleConfirmSqlScriptImport,
    closeSqlScriptImport,
  } = useExplorerSqlImport({
    connectionAvailabilityKey,
    connections,
    setActiveConnection,
    bumpMetadataVersion,
    setPostgresDatabaseRefreshVersion,
    loadSchemas,
    loadTables,
    setNamespaceError,
  });

  const [pendingDataSourceRemoval, setPendingDataSourceRemoval] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isRemovingDataSource, setIsRemovingDataSource] = useState(false);
  const [dataSourceRemovalError, setDataSourceRemovalError] = useState<
    string | null
  >(null);
  const [tableBatchSelection, setTableBatchSelection] =
    useState<ExplorerTableBatchSelection | null>(null);
  const [tableBatchAction, setTableBatchAction] = useState<{
    scopeKey: string;
    running: boolean;
    message: string;
    cancelId?: string;
    failures?: TableBatchFailureDetail[];
    omittedFailures?: number;
  } | null>(null);
  const sourceContext = useExplorerSourceContext({
    metadataVersion,
    connections,
    activeConnectionId,
    connectedConnectionIds,
    activeProjectId,
    postgresDatabaseRefreshVersion,
    currentSchema,
    expandedObjectGroupKeys,
    expandedSchemaKeys,
  });
  const {
    activeDriver,
    activeConnection,
    canBrowseDatabaseCatalogs,
    postgresDatabaseDiscovery,
    shouldLimitVisibleSchemas,
    isActiveConnectionReady,
    shouldAutoIntrospect,
    isActiveNamespaceExpanded,
    canBrowseTables,
    activeCapabilities,
    canBrowseCollections,
    collectionNamespace,
    tableTabReuseMode,
    collectionNamespaceForTemplate,
    collectionLabel,
    namespaceLabel,
  } = sourceContext;
  const catalogVisibility = useExplorerCatalogVisibility({
    activeConnectionId,
    activeProjectId,
    activeDriver,
    activeConnection,
    canBrowseDatabaseCatalogs,
    postgresDatabaseDiscovery,
    currentSchema,
    defaultSchema,
    schemas,
    shouldLimitVisibleSchemas,
  });
  const { visiblePostgresDatabases, activePostgresDatabase } =
    catalogVisibility;
  const objectWorkspace = useExplorerObjectWorkspace();
  const {
    copyText,
    setActiveTable,
    setActiveTableType,
    setDdlContent,
    setDdlViewerOpen,
    setViewDialogMode,
    setViewDialogKind,
    setViewDialogInitialName,
    setViewDialogInitialSql,
    setIsCreateViewDialogOpen,
  } = objectWorkspace;
  const { metadataForConnection } = createExplorerConnectionMetadataLookup({
    activeConnectionId,
    connectionSnapshots,
    schemas,
    currentSchema,
    defaultSchema,
    selectedTable,
    isLoading,
    metadataNodeStates,
  });

  useExplorerNamespaceLoading({
    activeConnectionId,
    isActiveConnectionReady,
    shouldAutoIntrospect,
    activeDriver,
    loadSchemas,
    hydrateConnectionMetadataFromCache,
  });

  useExplorerRemoteCatalogReset({
    postgresRemoteContextVersion,
    setPostgresRemoteDatabases,
    canBrowseDatabaseCatalogs,
    activeConnectionId,
    activeDriver,
    postgresDatabaseRefreshVersion,
  });
  const {
    setIsSchemaObjectDescriptorsLoading,
    setSchemaObjectDescriptors,
    setSchemaObjectDescriptorScope,
    schemaObjectDescriptors,
    schemaObjectDescriptorScope,
    isSchemaObjectDescriptorsLoading,
  } = useExplorerExpandedMetadata({
    shouldAutoIntrospect,
    isActiveConnectionReady,
    isLoading,
    activeConnectionId,
    currentSchema,
    isActiveNamespaceExpanded,
    canBrowseTables,
    loadTables,
    activeCapabilities,
    activeDriver,
    hydrateSchemaObjectsFromCache,
    canBrowseCollections,
    loadCollections,
    collectionNamespace,
    explorerRegexSearch,
    filterText,
    loadFunctions,
  });

  const { schemaObjectsFor, postgresDatabaseMatchesFilter } =
    useExplorerSchemaObjects({
      activeCapabilities,
      activeConnectionId,
      canBrowseCollections,
      canBrowseTables,
      collections,
      currentSchema,
      deferredFilterText,
      explorerFilterMatches,
      explorerVisibilityFilters,
      functions,
      objectSnapshots,
      pinnedTables,
      tables,
      schemas,
      postgresRemoteDatabases,
    });

  const tabActions = useExplorerTabActions();
  const {
    createTab,
    openSchemaDiagramTab,
    findOrCreateTableTab,
    loadTablePage,
    runTabQuery,
    findOrCreateObjectDataTab,
    loadDocumentPage,
    createTableTab,
  } = tabActions;

  const {
    handleNewQueryConsole,
    handleNewDataSource,
    handleOpenConnectionProperties,
    handleDuplicateConnection,
    connectionIdsForExplorerAction,
  } = createExplorerConnectionActions({
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
  });

  const { handleRemoveDataSource } = createExplorerConnectionRemoval({
    pendingDataSourceRemoval,
    isRemovingDataSource,
    setNamespaceError,
    setDataSourceRemovalError,
    setIsRemovingDataSource,
    removeConnection,
    forgetConnectionMetadata,
    setExpandedConnectionIds,
    setExpandedSchemaKeys,
    setExpandedObjectGroupKeys,
    setPendingDataSourceRemoval,
  });

  const {
    handleCollapseAll,
    handleExpandActiveConnection,
    handleRevealActiveConnection,
  } = createExplorerTreeNavigation({
    setExpandedConnectionIds,
    setExpandedSchemaKeys,
    setExpandedObjectGroupKeys,
    activeConnectionId,
    hydrateConnectionMetadataFromCache,
    explorerConnectionGroupIds,
  });
  const dataWorkspaces = useExplorerDataWorkspaces({
    connections,
    setNamespaceError,
    setActiveConnection,
    currentSchema,
    openSchemaDiagramTab,
  });

  const handleSchemaSelect = async (schema: string) => {
    await setCurrentSchema(schema);
    setFilterText("");
  };

  const {
    handleTableSelect,
    handleTableDoubleClick,
    handleTableCsvImport,
    handleTableJsonImport,
    handleTableXlsxImport,
    handlePostgresRemoteTableOpen,
  } = createExplorerTableOpenActions({
    selectTable,
    currentSchema,
    activeConnectionId,
    connectedConnectionIds,
    setActiveConnection,
    setNamespaceError,
    handleSchemaSelect,
    connections,
    findOrCreateTableTab,
    tableTabReuseMode,
    loadTablePage,
  });

  const {
    handleCollectionSelect,
    collectionPreviewSql,
    collectionDeleteSql,
    collectionCreateSql,
    refreshCollectionObjects,
    runCollectionMutation,
    handleCollectionDoubleClick,
  } = createExplorerCollectionQueries({
    selectTable,
    activeCapabilities,
    collectionNamespaceForTemplate,
    activeConnectionId,
    canBrowseCollections,
    loadCollections,
    collectionNamespace,
    bumpMetadataVersion,
    runTabQuery,
    findOrCreateObjectDataTab,
    loadDocumentPage,
  });

  const {
    refreshSelectedTableMetadata,
    exportSelectedTablesSql,
    cancelSelectedTableExport,
    copySelectedTableNames,
    showSelectedTableDdl,
  } = createExplorerTableBatchActions({
    tableBatchAction,
    setTableBatchAction,
    setActiveConnection,
    activeProjectId,
    bumpMetadataVersion,
    copyText,
    setActiveTable,
    setActiveTableType,
    setDdlContent,
    setDdlViewerOpen,
  });

  const {
    handleCopyCollectionPreview,
    handleElasticsearchIndexCleared,
    handleDeleteCollectionClick,
    handleCreateCollectionClick,
    handleCreateRedisKey,
  } = createExplorerCollectionActions({
    collectionPreviewSql,
    elasticsearchClearTarget,
    loadCollections,
    bumpMetadataVersion,
    loadDocumentPage,
    activeConnectionId,
    collectionDeleteSql,
    activeCapabilities,
    collectionLabel,
    createTab,
    collectionNamespace,
    runCollectionMutation,
    activeConnection,
    setIsCreateRedisKeyOpen,
    collectionCreateSql,
    refreshCollectionObjects,
    selectTable,
  });

  const {
    handleCreateTable,
    handleCreateView,
    handleCreateMaterializedView,
    handleCreateDatabase,
    handleRenameDatabase,
    handleDropDatabase,
  } = createExplorerNamespaceActions({
    activeConnectionId,
    currentSchema,
    canBrowseTables,
    activeCapabilities,
    createTableTab,
    setViewDialogMode,
    setViewDialogKind,
    setViewDialogInitialName,
    setViewDialogInitialSql,
    setIsCreateViewDialogOpen,
    setNamespaceError,
    namespaceLabel,
    setIsCreateDbDialogOpen,
    activeDriver,
    setActiveConnection,
    loadSchemas,
    setCurrentSchema,
    bumpMetadataVersion,
  });

  const {
    handleRefresh,
    handleRefreshConnection,
    handleRefreshSchema,
    handleExplorerKeyDownCapture,
    handleForgetConnectionMetadata,
    handleForgetSchemaMetadata,
    runForExplorerSchema,
    handleImportSqlScript,
    handleConnectionSelect,
    handleConnectionToggle,
    loadPostgresRemoteDatabase,
    handlePostgresRemoteTablesLoaded,
  } = createExplorerRefreshActions({
    handleSchemaSelect,
    activeConnectionId,
    canBrowseDatabaseCatalogs,
    setPostgresDatabaseRefreshVersion,
    loadSchemas,
    currentSchema,
    canBrowseTables,
    loadTables,
    activeCapabilities,
    loadFunctions,
    canBrowseCollections,
    loadCollections,
    collectionNamespace,
    filterText,
    connections,
    setActiveConnection,
    postgresRemoteRefreshVersionRef,
    setPostgresRemoteRefreshRequest,
    setNamespaceError,
    refreshSelectedTableMetadata,
    forgetConnectionMetadata,
    setExpandedSchemaKeys,
    setExpandedObjectGroupKeys,
    forgetSchemaMetadata,
    setCurrentSchema,
    setFilterText,
    requestSqlScriptImport,
    selectExplorerNode,
    connectedConnectionIds,
    setConnectingConnectionIds,
    expandedConnectionIds,
    setExpandedConnectionIds,
    postgresRemoteRequestCounter,
    postgresRemoteContextVersion,
    postgresRemoteRequestIds,
    setPostgresRemoteDatabases,
  });
  useExplorerCatalogSearch({
    deferredFilterText,
    activeConnection,
    explorerFilterMatches,
    explorerRegexSearch,
    explorerSearchMode,
    explorerFilterScope,
    activeConnectionId,
    isActiveConnectionReady,
    activeCapabilities,
    schemas,
    currentSchema,
    objectSnapshots,
    activeDriver,
    loadSchemaObjectsForSearch,
    canBrowseDatabaseCatalogs,
    postgresRemoteContextVersion,
    visiblePostgresDatabases,
    activePostgresDatabase,
    postgresRemoteDatabases,
    setPostgresRemoteDatabases,
    filterText,
  });

  const { activateSchemaRow, handleSchemaToggle } =
    createExplorerSchemaActivation({
      connections,
      selectExplorerNode,
      activeConnectionId,
      setActiveConnection,
      handleSchemaSelect,
      shouldAutoIntrospect,
      hydrateSchemaObjectsFromCache,
      setNamespaceError,
      namespaceLabel,
      activeDriver,
      expandedSchemaKeys,
      setExpandedSchemaKeys,
      setExpandedObjectGroupKeys,
    });

  useExplorerObjectReveal({
    databaseRevealRequest,
    activeProjectId,
    connections,
    clearDatabaseReveal,
    setActiveConnection,
    setExpandedConnectionIds,
    loadPostgresRemoteDatabase,
    setFilterText,
    handleSchemaSelect,
    shouldAutoIntrospect,
    hydrateSchemaObjectsFromCache,
    setExpandedSchemaKeys,
    setExpandedObjectGroupKeys,
    selectTable,
    setNamespaceError,
  });


  const presentationProps = {
    ...workspaceData,
    ...treePreferences,
    ...remoteCatalog,
    ...sourceContext,
    ...catalogVisibility,
    ...objectWorkspace,
    ...tabActions,
    ...dataWorkspaces,
    canBrowseDatabaseCatalogs,
    handleRefresh,
    tableBatchSelection,
    handleCreateTable,
    handleCreateView,
    handleCreateMaterializedView,
    setTableBatchAction,
    setTableBatchSelection,
    handleCreateCollectionClick,
    runForExplorerSchema,
    setNamespaceError,
    schemaObjectsFor,
    schemaObjectDescriptorScope,
    schemaObjectDescriptors,
    filterText,
    handleTableDoubleClick,
    handleTableSelect,
    setIsSchemaObjectDescriptorsLoading,
    setSchemaObjectDescriptors,
    setSchemaObjectDescriptorScope,
    isSchemaObjectDescriptorsLoading,
    collectionDeleteSql,
    handleCollectionDoubleClick,
    handleCollectionSelect,
    collectionPreviewSql,
    handleCopyCollectionPreview,
    setElasticsearchMetadataTarget,
    setElasticsearchClearTarget,
    handleDeleteCollectionClick,
    tableBatchAction,
    setDatabaseMaintenanceTarget,
    handleTableCsvImport,
    handleTableJsonImport,
    handleTableXlsxImport,
    handleImportSqlScript,
    handleRefreshSchema,
    setFilterText,
    refreshSelectedTableMetadata,
    copySelectedTableNames,
    showSelectedTableDdl,
    exportSelectedTablesSql,
    cancelSelectedTableExport,
    connectingConnectionIds,
    metadataForConnection,
    deferredFilterText,
    setConnectionGroupDraft,
    handleNewDataSource,
    handleConnectionSelect,
    handleConnectionToggle,
    setIsCreateDbDialogOpen,
    setIsCreateRedisKeyOpen,
    connectionIdsForExplorerAction,
    handleRefreshConnection,
    handleForgetConnectionMetadata,
    handleOpenConnectionProperties,
    handleDuplicateConnection,
    setDatabaseAdministrationConnectionId,
    setSqliteBackupTarget,
    setDataSourceRemovalError,
    setPendingDataSourceRemoval,
    postgresDatabaseMatchesFilter,
    loadPostgresRemoteDatabase,
    handlePostgresRemoteTablesLoaded,
    handlePostgresRemoteTableOpen,
    activateSchemaRow,
    handleSchemaToggle,
    handleForgetSchemaMetadata,
    handleRenameDatabase,
    handleDropDatabase,
    handleExplorerKeyDownCapture,
    handleRevealActiveConnection,
    handleExpandActiveConnection,
    handleCollapseAll,
    handleNewQueryConsole,
    handleCreateDatabase,
    filterInputRef,
    showConnectedConnectionsOnly,
    setShowConnectedConnectionsOnly,
    namespaceError,
    pendingSqlScriptImport,
    isSqlScriptImporting,
    closeSqlScriptImport,
    handleConfirmSqlScriptImport,
    connectionGroupDraft,
    isDataSourceDialogOpen,
    setIsDataSourceDialogOpen,
    refreshCollectionObjects,
    elasticsearchMetadataTarget,
    elasticsearchClearTarget,
    handleElasticsearchIndexCleared,
    visibilityFilterDraft,
    setVisibilityFilterDraft,
    pendingDataSourceRemoval,
    isRemovingDataSource,
    dataSourceRemovalError,
    handleRemoveDataSource,
    databaseAdministrationConnectionId,
    databaseMaintenanceTarget,
    sqliteBackupTarget,
    isCreateDbDialogOpen,
    isCreateRedisKeyOpen,
    handleCreateRedisKey,
  };

  return { presentationProps };
}

export type SchemaSidebarController = ReturnType<typeof useSchemaSidebarController>;
