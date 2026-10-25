import { showMessage } from "@/lib/appDialogs";
import { connectionCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";
import {
  explorerDirectoryGroupForObjectType,
  explorerDirectoryNodeKind,
} from "@/features/database-explorer/model/explorerDirectory";
import {
  objectGroupKey,
  supportsDatabaseCatalogTree,
} from "@/features/database-explorer/model/explorerSidebarPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import { explorerNodePassesVisibilityFilter } from "@/features/database-explorer/model/explorerVisibilityFilter";
import { pruneTableBatchSelection } from "@/features/database-explorer/model/tableBatchSelection";
import { createCollectionTreeRenderer } from "@/features/database-explorer/ui/createCollectionTreeRenderer";
import { createRoutineTreeRenderer } from "@/features/database-explorer/ui/createRoutineTreeRenderer";
import { createSchemaDescriptorRenderer } from "@/features/database-explorer/ui/createSchemaDescriptorRenderer";
import { createTableTreeRenderer } from "@/features/database-explorer/ui/createTableTreeRenderer";
import { createViewTreeRenderer } from "@/features/database-explorer/ui/createViewTreeRenderer";
import type { CreateSchemaObjectsRendererContext } from "@/features/database-explorer/ui/schemaObjectsRendererTypes";
import { SchemaObjectsTree } from "@/features/database-explorer/ui/SchemaObjectsTree";
import { createExplorerTableReferencePayload } from "@/features/query-editor/model/explorerTableReferenceDrop";
import { isViewObject, supportsTableWorkspace } from "@/lib/databaseDialect";
import { databaseObjectPreviewProvider } from "@/lib/databaseObjectPreview";
import { type RedisKeyTreeNode } from "@/lib/redisKey";
import { schemaService } from "@/services/tauri";
import type { DatabaseCapabilities } from "@/services/tauri/types";
import type {
  CollectionInfo,
  SchemaObjectInfo,
} from "@/services/tauri/types/schemaCatalog";
import {
  APP_EVENT_OPEN_ASSISTANT,
  useAssistantComposerStore,
} from "@/store/useAssistantComposerStore";
import {
  getSchemaMetadataNodeKey,
  REDIS_KEY_PAGE_SIZE,
  useSchemaStore,
} from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { type ReactNode } from "react";

export function createSchemaObjectsRenderer({
  activeConnectionId,
  currentSchema,
  connections,
  runForExplorerSchema,
  setActiveConnection,
  setNamespaceError,
  createTab,
  schemaObjectsFor,
  explorerVisibilityFilters,
  collectionTotal,
  expandedObjectGroupKeys,
  tableBatchSelection,
  metadataNodeStates,
  isLoading,
  setCurrentSchema,
  schemaObjectDescriptorScope,
  schemaObjectDescriptors,
  explorerFilterMatches,
  setActiveTable,
  setDdlContent,
  setDdlViewerOpen,
  setExpandedObjectGroupKeys,
  collectionNextCursor,
  isCollectionsLoading,
  loadMoreCollections,
  selectedExplorerNodeIds,
  copyText,
  activeDriver,
  activeProjectId,
  activeConnection,
  hideExplorerNodes,
  explorerStateScope,
  showOnlyExplorerNodes,
  clearExplorerVisibilityFilter,
  openExplorerVisibilityFilter,
  selectExplorerNode,
  showExplorerHoverTooltips,
  highlightMatch,
  filterText,
  isFunctionsLoading,
  loadFunctions,
  explorerTreeRowHeight,
  selectedTable,
  expandedTableKeys,
  explorerActivationMode,
  handleTableDoubleClick,
  handleTableSelect,
  setExpandedTableKeys,
  renderSqlHistorySubmenu,
  handleDdlClick,
  handleEditViewClick,
  handleRefreshMaterializedViewClick,
  handleCopyTableDdl,
  loadTables,
  handleCreateView,
  handleCreateMaterializedView,
  setIsSchemaObjectDescriptorsLoading,
  setSchemaObjectDescriptors,
  setSchemaObjectDescriptorScope,
  expandedSchemaObjectMemberKeys,
  schemaObjectMemberStates,
  setExpandedSchemaObjectMemberKeys,
  setSchemaObjectMemberStates,
  isSchemaObjectDescriptorsLoading,
  collectionDeleteSql,
  handleCollectionDoubleClick,
  handleCollectionSelect,
  collectionPreviewSql,
  handleCopyCollectionPreview,
  setElasticsearchMetadataTarget,
  setNacosConfigTransferRequest,
  setMongoCollectionTransferRequest,
  setElasticsearchClearTarget,
  handleDeleteCollectionClick,
  suppressTableReferenceClickRef,
  tableBatchAction,
  setTableBatchSelection,
  setTableBatchAction,
  togglePinTable,
  findOrCreateTableTab,
  loadTablePage,
  setSchemaSnapshotIdentity,
  loadCollections,
  setTableMetadata,
  handleRenameClick,
  handleEditColumnsClick,
  handleTruncateClick,
  setDatabaseMaintenanceTarget,
  handleTableCsvImport,
  importTableData,
  handleTableJsonImport,
  handleTableXlsxImport,
  handleImportSqlScript,
  exportTableData,
  activeTableExport,
  cancelActiveTableExport,
  handleOpenDataTransfer,
  handleOpenDataCompare,
  handleDropClick,
  setIsTablesHovered,
  isTablesHovered,
  renderObjectActions,
  createTableTab,
  handleCreateCollectionClick,
  openObjectBrowser,
  handleRefreshSchema,
  setFilterText,
  refreshSelectedTableMetadata,
  copySelectedTableNames,
  showSelectedTableDdl,
  schemaDiagramLoadingKey,
  handleOpenSchemaDiagram,
  exportSelectedTablesSql,
  cancelSelectedTableExport,
  namespaceLabel,
}: CreateSchemaObjectsRendererContext) {
  const renderSchemaObjects = (
    connectionId: string,
    driver: string | null | undefined,
    schema: string,
    _connectionColor: string,
    activeCapabilities: DatabaseCapabilities,
  ) => {
    // Cached subtrees retain their own driver's hierarchy when another
    // connection becomes active.
    const canBrowseTables = supportsTableWorkspace(activeCapabilities);
    const canBrowseCollections =
      activeCapabilities.supportsCollectionBrowsing ||
      activeCapabilities.supportsKeyValueBrowsing;
    const collectionPreviewProvider =
      databaseObjectPreviewProvider(activeCapabilities);
    const collectionLabel = collectionPreviewProvider.objectLabel;
    const collectionLabelPlural =
      collectionPreviewProvider.objectPluralLabel || `${collectionLabel}s`;
    const objectSectionLabel = canBrowseTables
      ? "Tables"
      : canBrowseCollections
        ? collectionLabelPlural
        : "Objects";
    const isCurrentSchema =
      connectionId === activeConnectionId && schema === currentSchema;
    const objectConnection = connections.find(
      (connection) => connection.id === connectionId,
    );
    const objectDriver = objectConnection?.driver;
    const navigationDatabaseName =
      objectConnection && supportsDatabaseCatalogTree(objectConnection.driver)
        ? connectionCatalogDatabaseName(objectConnection)
        : undefined;
    // Every action created below is bound to this rendered node's connection,
    // not whichever data source happens to be globally active when clicked.
    const runForSchema = (
      targetSchema: string,
      action: () => void | Promise<void>,
    ) => runForExplorerSchema(connectionId, targetSchema, action);
    const openScopedQueryConsole = () => {
      void setActiveConnection(connectionId).then((error) => {
        if (error) {
          setNamespaceError(error);
          return;
        }
        createTab(
          "query",
          `console [${objectConnection?.name || "Database"}]`,
          "",
          {
            connectionId,
            databaseName: navigationDatabaseName,
            schemaName: schema,
          },
        );
      });
    };
    const schemaObjects = schemaObjectsFor(
      connectionId,
      driver,
      schema,
      navigationDatabaseName,
    );
    const objectVisibilityParentId = explorerNodeId(
      "folder",
      "schema-objects",
      connectionId,
      navigationDatabaseName,
      schema,
    );
    const objectVisibilityFilter =
      explorerVisibilityFilters[objectVisibilityParentId];
    const tableRelations = schemaObjects.tables.filter(
      (table) => !isViewObject(table.type),
    );
    const tableRelationNames = tableRelations.map((table) => table.name);
    const virtualViews = schemaObjects.tables.filter((table) =>
      isViewObject(table.type),
    );
    const schemaObjectCount = canBrowseTables
      ? tableRelations.length
      : canBrowseCollections
        ? schemaObjects.collections.length
        : 0;
    const schemaObjectCountLabel =
      activeCapabilities.dataModel === "keyValue" &&
      isCurrentSchema &&
      collectionTotal !== null
        ? `${schemaObjectCount}/${collectionTotal}`
        : schemaObjectCount;
    const hasSchemaObjectContext = canBrowseTables
      ? Boolean(schema)
      : canBrowseCollections;
    const groupKey = objectGroupKey(connectionId, driver, schema, "objects");
    const isObjectGroupExpanded = expandedObjectGroupKeys.includes(groupKey);
    const isTableBatchSelectionActive =
      tableBatchSelection?.scopeKey === groupKey;
    const scopedTableBatchSelection = isTableBatchSelectionActive
      ? pruneTableBatchSelection(tableBatchSelection, tableRelationNames)
      : { names: [], anchor: null };
    const selectedTableBatchNames = scopedTableBatchSelection.names;
    const selectedTableBatchSet = new Set(selectedTableBatchNames);
    const allVisibleTablesSelected =
      tableRelationNames.length > 0 &&
      tableRelationNames.every((name) => selectedTableBatchSet.has(name));
    const schemaNodeState =
      metadataNodeStates[
        getSchemaMetadataNodeKey(connectionId, driver, schema)
      ];
    const isSchemaObjectsLoading =
      schemaNodeState?.status === "loading" ||
      (isCurrentSchema && isLoading && schemaObjects.tables.length === 0);

    const addTablesToAssistant = async (tableNames: readonly string[]) => {
      if (!objectConnection || tableNames.length === 0) return;
      const targetDatabase =
        navigationDatabaseName || objectConnection.database || undefined;
      const tabStateBefore = useTabStore.getState();
      const activeTabBefore = tabStateBefore.tabs.find(
        (tab) => tab.id === tabStateBefore.activeTabId,
      );
      const matchesTargetContext = (tab: typeof activeTabBefore) =>
        Boolean(
          tab &&
            tab.connectionId === connectionId &&
            (tab.databaseName || objectConnection.database || "") ===
              (targetDatabase || "") &&
            (tab.schemaName || "") === schema,
        );
      const contextChanged = !matchesTargetContext(activeTabBefore);
      const connectionError = await setActiveConnection(connectionId);
      if (connectionError) {
        setNamespaceError(connectionError);
        return;
      }
      if (schema !== useSchemaStore.getState().currentSchema) {
        await setCurrentSchema(schema);
      }
      const tabState = useTabStore.getState();
      if (!matchesTargetContext(activeTabBefore)) {
        const contextTab = tabState.tabs.find(
          (tab) => tab.type === "query" && matchesTargetContext(tab),
        );
        if (contextTab) {
          tabState.setActiveTab(contextTab.id);
        } else {
          tabState.createTab("query", "New Query", "", {
            connectionId,
            databaseName: targetDatabase,
            schemaName: schema,
          });
        }
      }
      const request = useAssistantComposerStore.getState().queueDatabaseTables(
        tableNames.map((table) => ({
          connectionId,
          connectionName: objectConnection.name,
          database: targetDatabase,
          schema,
          table,
        })),
        { replaceExisting: contextChanged },
      );
      if (!request) return;
      setNamespaceError(null);
      window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_ASSISTANT));
    };

    const tableReferencePayload = (tableNames: readonly string[]) =>
      createExplorerTableReferencePayload({
        connectionId,
        database:
          navigationDatabaseName || objectConnection?.database || undefined,
        schema,
        tables: tableNames,
        identifierQuote: activeCapabilities.identifierQuote,
      });

    const descriptorObjects =
      isCurrentSchema &&
      schemaObjectDescriptorScope === `${connectionId}:${schema}`
        ? schemaObjectDescriptors
            .filter((object) => {
              const directoryKind = explorerDirectoryGroupForObjectType(
                object.objectType,
              );
              if (!directoryKind) return true;
              return explorerNodePassesVisibilityFilter(
                objectVisibilityFilter,
                explorerNodeId(
                  explorerDirectoryNodeKind(directoryKind),
                  connectionId,
                  navigationDatabaseName,
                  schema,
                  object.name,
                  object.objectType,
                  object.parentName,
                ),
                object.name,
              );
            })
            .filter((object) =>
              explorerFilterMatches(
                object.name,
                object.objectType,
                object.parentName,
              ),
            )
            .sort((left, right) =>
              left.objectType === right.objectType
                ? left.name.localeCompare(right.name)
                : left.objectType.localeCompare(right.objectType),
            )
        : [];
    const triggersByRelation = new Map<string, SchemaObjectInfo[]>();
    for (const object of descriptorObjects) {
      if (
        explorerDirectoryGroupForObjectType(object.objectType) !== "triggers" ||
        !object.parentName
      ) {
        continue;
      }
      const relationName = object.parentName.toLocaleLowerCase();
      const triggers = triggersByRelation.get(relationName) || [];
      triggers.push(object);
      triggersByRelation.set(relationName, triggers);
    }

    const viewSchemaObjectSource = (object: SchemaObjectInfo) => {
      void schemaService
        .getSchemaObjectSource(
          connectionId,
          schema,
          object.name,
          object.objectType,
          object.parentName,
        )
        .then((definitions) => {
          const definition = definitions.find(
            (value) => value.trim().length > 0,
          );
          if (!definition) {
            throw new Error(
              "This driver does not provide a source definition for the selected object.",
            );
          }
          setActiveTable(object.name);
          setDdlContent(definition);
          setDdlViewerOpen(true);
        })
        .catch((error) => {
          showMessage(
            `Unable to load ${object.objectType.toLowerCase()} definition: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    };

    const toggleObjectGroup = (key: string) => {
      setExpandedObjectGroupKeys((current) =>
        current.includes(key)
          ? current.filter((item) => item !== key)
          : [...current, key],
      );
    };

    const renderLoadMoreKeys = () =>
      isCurrentSchema &&
      activeCapabilities.dataModel === "keyValue" &&
      collectionNextCursor ? (
        <button
          type="button"
          className="wb-text-button ml-1 mt-1 h-6 px-2 text-[10px] text-[hsl(var(--wb-accent))]"
          disabled={isCollectionsLoading}
          onClick={() => void loadMoreCollections(connectionId, schema)}
        >
          {isCollectionsLoading
            ? "Loading…"
            : `Load next ${REDIS_KEY_PAGE_SIZE} keys`}
        </button>
      ) : null;

    const { renderRoutines } = createRoutineTreeRenderer({
      activeCapabilities,
      connectionId,
      navigationDatabaseName,
      schema,
      selectedExplorerNodeIds,
      createTab,
      objectConnection,
      setActiveTable,
      setDdlContent,
      setDdlViewerOpen,

      copyText,
      activeConnectionId,
      activeDriver,
      activeProjectId,
      activeConnection,

      hideExplorerNodes,
      explorerStateScope,
      objectVisibilityParentId,
      showOnlyExplorerNodes,
      objectVisibilityFilter,
      clearExplorerVisibilityFilter,
      openExplorerVisibilityFilter,
      selectExplorerNode,
      showExplorerHoverTooltips,
      highlightMatch,
      filterText,
      driver,
      expandedObjectGroupKeys,
      isFunctionsLoading,
      toggleObjectGroup,
      loadFunctions,
      isCurrentSchema,
      explorerTreeRowHeight,
      schemaObjects,
    });

    const { renderVirtualViews } = createViewTreeRenderer({
      canBrowseTables,
      activeCapabilities,
      isCurrentSchema,
      selectedTable,
      connectionId,
      navigationDatabaseName,
      schema,
      selectedExplorerNodeIds,
      driver,
      activeDriver,
      expandedTableKeys,
      selectExplorerNode,
      explorerActivationMode,
      handleTableDoubleClick,
      runForSchema,
      handleTableSelect,
      setExpandedTableKeys,
      showExplorerHoverTooltips,

      createTab,
      objectConnection,
      objectDriver,
      renderSqlHistorySubmenu,
      handleDdlClick,
      handleEditViewClick,
      handleRefreshMaterializedViewClick,

      copyText,
      handleCopyTableDdl,
      activeProjectId,
      expandedObjectGroupKeys,
      toggleObjectGroup,
      loadTables,
      handleCreateView,
      handleCreateMaterializedView,
      filterText,
      explorerTreeRowHeight,
      virtualViews,
    });

    const { renderSchemaObjectDescriptors } = createSchemaDescriptorRenderer({
      isCurrentSchema,
      activeCapabilities,
      descriptorObjects,
      setIsSchemaObjectDescriptorsLoading,
      connectionId,
      schema,
      setSchemaObjectDescriptors,
      setSchemaObjectDescriptorScope,
      setNamespaceError,
      driver,
      expandedObjectGroupKeys,
      toggleObjectGroup,
      explorerTreeRowHeight,
      expandedSchemaObjectMemberKeys,
      navigationDatabaseName,
      selectedExplorerNodeIds,
      schemaObjectMemberStates,
      setExpandedSchemaObjectMemberKeys,
      setSchemaObjectMemberStates,

      viewSchemaObjectSource,

      copyText,

      hideExplorerNodes,
      explorerStateScope,
      objectVisibilityParentId,
      showOnlyExplorerNodes,
      objectVisibilityFilter,
      clearExplorerVisibilityFilter,
      openExplorerVisibilityFilter,
      selectExplorerNode,
      showExplorerHoverTooltips,
      highlightMatch,
      filterText,
      isSchemaObjectDescriptorsLoading,
    });

    const { renderCollectionItem } = createCollectionTreeRenderer({
      collectionDeleteSql,
      driver,
      activeDriver,
      activeCapabilities,
      isCurrentSchema,
      selectedTable,
      connectionId,
      navigationDatabaseName,
      schema,
      expandedTableKeys,
      selectedExplorerNodeIds,
      schemaObjects,
      selectExplorerNode,
      explorerActivationMode,
      runForSchema,
      handleCollectionDoubleClick,
      handleCollectionSelect,
      showExplorerHoverTooltips,
      setExpandedTableKeys,
      highlightMatch,
      filterText,

      collectionPreviewSql,
      createTab,
      objectConnection,

      copyText,
      handleCopyCollectionPreview,

      hideExplorerNodes,
      explorerStateScope,
      objectVisibilityParentId,
      showOnlyExplorerNodes,
      objectVisibilityFilter,
      clearExplorerVisibilityFilter,
      openExplorerVisibilityFilter,
      setElasticsearchMetadataTarget,
      setNacosConfigTransferRequest,
      connections,
      setMongoCollectionTransferRequest,
      setElasticsearchClearTarget,
      handleDeleteCollectionClick,
      collectionLabel,
      activeProjectId,
    });

    const renderRedisKeyNodes = (
      nodes: RedisKeyTreeNode<CollectionInfo>[],
      depth = 0,
    ): ReactNode =>
      nodes.map((node) => {
        if (node.children.length === 0 && node.key) {
          return renderCollectionItem(node.key, node.segment, depth);
        }

        const key = objectGroupKey(
          connectionId,
          driver,
          schema,
          `redis:${node.path}`,
        );
        const isExpanded = expandedObjectGroupKeys.includes(key);
        return (
          <div key={`redis-group:${node.path}`}>
            <button
              type="button"
              className="flex h-7 w-full items-center gap-1.5 rounded-[3px] pr-2 text-left text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
              style={{ paddingLeft: `${6 + depth * 14}px` }}
              onClick={() => toggleObjectGroup(key)}
              title={node.path}
            >
              {isExpanded ? (
                <ChevronDown size={12} className="shrink-0 wb-muted" />
              ) : (
                <ChevronRight size={12} className="shrink-0 wb-muted" />
              )}
              <Folder size={12} className="shrink-0 text-amber-400/80" />
              <span className="min-w-0 flex-1 truncate">
                {node.segment || "(empty)"}
              </span>
              <span className="shrink-0 text-[9px] tabular-nums wb-muted">
                {node.keyCount}
              </span>
            </button>
            {isExpanded && (
              <div>
                {node.key && renderCollectionItem(node.key, "(key)", depth + 1)}
                {renderRedisKeyNodes(node.children, depth + 1)}
              </div>
            )}
          </div>
        );
      });

    const { renderTableItem } = createTableTreeRenderer({
      schemaObjects,
      isCurrentSchema,
      selectedTable,
      connectionId,
      navigationDatabaseName,
      schema,
      selectedExplorerNodeIds,
      driver,
      expandedTableKeys,
      activeCapabilities,
      activeDriver,
      selectedTableBatchSet,
      selectedTableBatchNames,
      tableRelations,
      objectDriver,
      createTab,
      runForSchema,
      handleTableSelect,
      explorerActivationMode,
      selectExplorerNode,
      suppressTableReferenceClickRef,
      isTableBatchSelectionActive,
      tableBatchAction,
      setTableBatchSelection,
      groupKey,
      scopedTableBatchSelection,
      tableRelationNames,
      setTableBatchAction,
      handleTableDoubleClick,
      tableReferencePayload,
      showExplorerHoverTooltips,

      setExpandedTableKeys,
      togglePinTable,

      findOrCreateTableTab,
      loadTablePage,
      renderSqlHistorySubmenu,

      objectConnection,
      setActiveConnection,
      setNamespaceError,
      setSchemaSnapshotIdentity,
      activeProjectId,
      addTablesToAssistant,

      copyText,
      handleCopyTableDdl,
      hideExplorerNodes,
      explorerStateScope,
      objectVisibilityParentId,
      showOnlyExplorerNodes,
      objectVisibilityFilter,
      clearExplorerVisibilityFilter,
      openExplorerVisibilityFilter,
      activeConnectionId,
      canBrowseTables,
      loadTables,
      loadFunctions,
      canBrowseCollections,
      loadCollections,
      setTableMetadata,
      isLoading,
      handleRenameClick,
      handleDdlClick,
      handleEditColumnsClick,
      handleTruncateClick,
      setDatabaseMaintenanceTarget,
      handleEditViewClick,
      handleRefreshMaterializedViewClick,
      handleTableCsvImport,
      importTableData,
      handleTableJsonImport,
      handleTableXlsxImport,
      handleImportSqlScript,
      connections,
      exportTableData,
      activeTableExport,
      cancelActiveTableExport,
      handleOpenDataTransfer,
      handleOpenDataCompare,
      handleDropClick,
      triggersByRelation,
      viewSchemaObjectSource,
    });

    return (
      <SchemaObjectsTree
        setIsTablesHovered={setIsTablesHovered}
        connectionId={connectionId}
        navigationDatabaseName={navigationDatabaseName}
        schema={schema}
        setExpandedObjectGroupKeys={setExpandedObjectGroupKeys}
        groupKey={groupKey}
        isObjectGroupExpanded={isObjectGroupExpanded}
        activeCapabilities={activeCapabilities}
        objectSectionLabel={objectSectionLabel}
        hasSchemaObjectContext={hasSchemaObjectContext}
        schemaObjectCountLabel={schemaObjectCountLabel}
        schemaNodeState={schemaNodeState}
        isCurrentSchema={isCurrentSchema}
        isTablesHovered={isTablesHovered}
        renderObjectActions={renderObjectActions}
        canBrowseTables={canBrowseTables}
        runForSchema={runForSchema}
        createTableTab={createTableTab}
        canBrowseCollections={canBrowseCollections}
        handleCreateCollectionClick={handleCreateCollectionClick}
        collectionLabel={collectionLabel}
        copyText={copyText}
        openObjectBrowser={openObjectBrowser}
        objectConnection={objectConnection}
        openScopedQueryConsole={openScopedQueryConsole}
        renderSqlHistorySubmenu={renderSqlHistorySubmenu}
        tableRelationNames={tableRelationNames}
        addTablesToAssistant={addTablesToAssistant}
        isLoading={isLoading}
        isCollectionsLoading={isCollectionsLoading}
        handleRefreshSchema={handleRefreshSchema}
        tableRelations={tableRelations}
        setTableBatchSelection={setTableBatchSelection}
        filterText={filterText}
        setFilterText={setFilterText}
        isTableBatchSelectionActive={isTableBatchSelectionActive}
        tableBatchAction={tableBatchAction}
        allVisibleTablesSelected={allVisibleTablesSelected}
        selectedTableBatchNames={selectedTableBatchNames}
        scopedTableBatchSelection={scopedTableBatchSelection}
        refreshSelectedTableMetadata={refreshSelectedTableMetadata}
        driver={driver}
        activeDriver={activeDriver}
        copySelectedTableNames={copySelectedTableNames}
        showSelectedTableDdl={showSelectedTableDdl}
        schemaDiagramLoadingKey={schemaDiagramLoadingKey}
        handleOpenSchemaDiagram={handleOpenSchemaDiagram}
        activeProjectId={activeProjectId}
        objectDriver={objectDriver}
        exportSelectedTablesSql={exportSelectedTablesSql}
        handleOpenDataTransfer={handleOpenDataTransfer}
        handleOpenDataCompare={handleOpenDataCompare}
        cancelSelectedTableExport={cancelSelectedTableExport}
        setTableBatchAction={setTableBatchAction}
        namespaceLabel={namespaceLabel}
        schemaObjects={schemaObjects}
        collectionLabelPlural={collectionLabelPlural}
        collectionNextCursor={collectionNextCursor}
        objectVisibilityFilter={objectVisibilityFilter}
        clearExplorerVisibilityFilter={clearExplorerVisibilityFilter}
        explorerStateScope={explorerStateScope}
        objectVisibilityParentId={objectVisibilityParentId}
        renderLoadMoreKeys={renderLoadMoreKeys}
        renderRedisKeyNodes={renderRedisKeyNodes}
        explorerTreeRowHeight={explorerTreeRowHeight}
        renderCollectionItem={renderCollectionItem}
        expandedTableKeys={expandedTableKeys}
        isSchemaObjectsLoading={isSchemaObjectsLoading}
        renderTableItem={renderTableItem}
        renderVirtualViews={renderVirtualViews}
        renderRoutines={renderRoutines}
        renderSchemaObjectDescriptors={renderSchemaObjectDescriptors}
      />
    );
  };

  return { renderSchemaObjects };
}
