import { confirmAction } from "@/lib/appDialogs";
import { ConnectionGlyph } from "@/components/icons/ConnectionGlyph";
import {
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { connectionCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";
import { reorderExplorerConnectionIds } from "@/features/database-explorer/model/explorerConnectionOrder";
import {
  connectionRegionStyle,
  connectionTreeColor,
  supportsDatabaseCatalogTree,
} from "@/features/database-explorer/model/explorerSidebarPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import { explorerNodePassesVisibilityFilter } from "@/features/database-explorer/model/explorerVisibilityFilter";
import { ExplorerConnectionContents } from "@/features/database-explorer/ui/ExplorerConnectionContents";
import {
  EXPLORER_CONNECTION_DRAG_TYPE,
  explorerConnectionGroupAncestorsExpanded,
  explorerConnectionGroupDepth,
  ExplorerConnectionGroupRow,
  readExplorerDraggedConnectionIds,
} from "@/features/database-explorer/ui/ExplorerConnectionGroupRow";
import { ExplorerConnectionMenu } from "@/features/database-explorer/ui/ExplorerConnectionMenu";
import { ExplorerSharedContextMenu } from "@/features/database-explorer/ui/ExplorerContextMenuHost";
import {
  ConnectionRuntimeBadge,
  MetadataNodeBadge,
} from "@/features/database-explorer/ui/ExplorerStatusBadges";
import { EXPLORER_MENU_CONTENT_CLASS as menuContentClass } from "@/features/database-explorer/ui/explorerStyles";
import { moveExplorerTreeFocus } from "@/features/database-explorer/ui/explorerTreeDom";
import {
  databaseDriverProfile,
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
} from "@/lib/databaseDialect";
import { cn } from "@/lib/utils";
import type { ConnectionConfig } from "@/store/useConnectionStore";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Fragment } from "react";

import type { CreateConnectionTreeRendererContext } from "./types";

export function createConnectionTreeRowRenderer({
  connectionVirtualWindow,
  activeConnectionId,
  selectedExplorerNodeIds,
  connectingConnectionIds,
  connectionRuntimeStates,
  metadataForConnection,
  activeCapabilities,
  schemaRows,
  expandedConnectionIds,
  deferredFilterText,
  explorerFilterMatches,
  explorerFilterScope,
  explorerVisibilityFilters,
  schemaObjectsFor,
  explorerConnectionGroupIds,
  explorerConnectionGroupById,
  visibleExplorerConnections,
  expandedObjectGroupKeys,
  explorerConnectionGroupCounts,
  selectExplorerNode,
  setExpandedObjectGroupKeys,
  setConnectionGroupDraft,
  handleNewDataSource,
  moveExplorerConnectionsToGroup,
  explorerStateScope,
  placeExplorerConnectionGroup,
  deleteExplorerConnectionGroup,
  setExplorerConnectionOrder,
  setExplorerConnectionSortMode,
  connections,
  handleConnectionSelect,
  handleConnectionToggle,
  showExplorerHoverTooltips,
  connectedConnectionIds,
  databaseExplorerSettings,
  isLoading,
  isCollectionsLoading,
  renderSchemaVisibilityPicker,

  setActiveConnection,
  disconnect,
  setNamespaceError,
  createTab,
  renderSqlHistorySubmenu,

  currentSchema,
  canBrowseTables,

  setIsCreateDbDialogOpen,
  namespaceLabel,
  handleCreateTable,
  setIsCreateRedisKeyOpen,
  copyText,
  hideExplorerNodes,
  explorerConnectionFilterParentId,
  connectionIdsForExplorerAction,
  showOnlyExplorerNodes,
  explorerConnectionVisibilityFilter,
  clearExplorerVisibilityFilter,
  openExplorerVisibilityFilter,
  openDatabaseBrowser,
  openRocketMqWorkspace,
  handleRefreshConnection,
  handleForgetConnectionMetadata,
  handleOpenConnectionProperties,
  handleDuplicateConnection,
  explorerConnectionGroups,
  setDatabaseAdministrationConnectionId,
  setSqliteBackupTarget,
  handleImportSqlScript,
  setDataSourceRemovalError,
  setPendingDataSourceRemoval,
  postgresDatabaseRefreshVersion,
  postgresDatabaseDiscovery,
  schemaCountLabel,
  visiblePostgresDatabases,
  postgresDatabaseMatchesFilter,
  loadPostgresRemoteDatabase,
  postgresRemoteDatabases,
  openObjectBrowser,
  handleOpenDataTransfer,
  handleOpenDataCompare,
  setSchemaSnapshotIdentity,
  activeProjectId,
  postgresRemoteRefreshRequest,
  handlePostgresRemoteTablesLoaded,
  explorerActivationMode,
  setDatabaseMaintenanceTarget,
  handlePostgresRemoteTableOpen,
  namespaceLabelPlural,
  filterText,
  expandedSchemaKeys,
  metadataNodeStates,
  activateSchemaRow,
  handleSchemaToggle,
  runForExplorerSchema,
  createTableTab,
  setViewDialogMode,
  setViewDialogKind,
  setViewDialogInitialName,
  setViewDialogInitialSql,
  setIsCreateViewDialogOpen,
  handleRefreshSchema,
  handleForgetSchemaMetadata,
  schemaDiagramLoadingKey,
  handleOpenSchemaDiagram,
  handleRenameDatabase,
  handleDropDatabase,
  renderSchemaObjects,
}: CreateConnectionTreeRendererContext) {
  const renderConnection = (
    connection: ConnectionConfig,
    renderedConnectionIndex: number,
  ) => {
    const connectionIndex =
      connectionVirtualWindow.start + renderedConnectionIndex;
    const isManagedConnection = connection.origin === "managed";
    const connectionColor = connectionTreeColor(
      connection.driver,
      connection.color,
    );
    const isActive = connection.id === activeConnectionId;
    const isConnectionSelected = selectedExplorerNodeIds.includes(
      explorerNodeId("connection", connection.id),
    );
    const isConnecting = connectingConnectionIds.includes(connection.id);
    const connectionRuntime = connectionRuntimeStates[connection.id];
    const connectionMetadata = metadataForConnection(
      connection.id,
      connection.driver,
    );
    const connectionCapabilities = isActive
      ? activeCapabilities
      : defaultDatabaseCapabilities(connection.driver);
    const connectionSchemas = isActive
      ? schemaRows
      : connectionMetadata.schemas;
    const isConnectionExpanded = expandedConnectionIds.includes(connection.id);
    const isFlatKeyValueTree =
      defaultDatabaseCapabilities(connection.driver).dataModel === "keyValue";
    const connectionCanBrowseDatabaseCatalogs = supportsDatabaseCatalogTree(
      connection.driver,
    );
    const connectedPostgresDatabase = connectionCanBrowseDatabaseCatalogs
      ? connectionCatalogDatabaseName(connection)
      : "";
    const normalizedObjectFilter = deferredFilterText
      .trim()
      .toLocaleLowerCase();
    const connectionMatchesFilter = Boolean(
      normalizedObjectFilter &&
        explorerFilterMatches(
          connection.name,
          connection.driver,
          connection.database,
        ),
    );
    const descendantFilterText =
      explorerFilterScope === "connections" ||
      (explorerFilterScope === "all" && connectionMatchesFilter)
        ? ""
        : deferredFilterText;
    const normalizedDescendantFilter = descendantFilterText
      .trim()
      .toLocaleLowerCase();
    const schemaVisibilityParentId = connectionCanBrowseDatabaseCatalogs
      ? explorerNodeId("database", connection.id, connectedPostgresDatabase)
      : explorerNodeId("connection", connection.id);
    const schemaVisibilityFilter =
      explorerVisibilityFilters[schemaVisibilityParentId];
    const visibilityFilteredConnectionSchemas = connectionSchemas.filter(
      (schema) =>
        explorerNodePassesVisibilityFilter(
          schemaVisibilityFilter,
          explorerNodeId(
            "schema",
            connection.id,
            connectionCanBrowseDatabaseCatalogs
              ? connectedPostgresDatabase
              : "",
            schema,
          ),
          schema,
        ),
    );
    const renderedConnectionSchemas =
      isActive &&
      connectionCanBrowseDatabaseCatalogs &&
      normalizedDescendantFilter &&
      !explorerFilterMatches(connectedPostgresDatabase)
        ? visibilityFilteredConnectionSchemas.filter((schema) => {
            if (explorerFilterMatches(schema)) {
              return true;
            }
            const schemaObjects = schemaObjectsFor(
              connection.id,
              connection.driver,
              schema,
              connectedPostgresDatabase,
            );
            return (
              schemaObjects.tables.length > 0 ||
              schemaObjects.collections.length > 0 ||
              schemaObjects.functions.length > 0
            );
          })
        : visibilityFilteredConnectionSchemas;
    const assignedGroupId = explorerConnectionGroupIds[connection.id];
    const assignedGroup = assignedGroupId
      ? explorerConnectionGroupById.get(assignedGroupId)
      : undefined;
    const previousConnection = visibleExplorerConnections[connectionIndex - 1];
    const areConnectionGroupAncestorsExpanded = assignedGroup
      ? explorerConnectionGroupAncestorsExpanded(
          assignedGroup,
          explorerConnectionGroupById,
          expandedObjectGroupKeys,
        )
      : true;
    const beginsConnectionGroup = Boolean(
      assignedGroup &&
        areConnectionGroupAncestorsExpanded &&
        explorerConnectionGroupIds[previousConnection?.id || ""] !==
          assignedGroup.id,
    );
    const isConnectionGroupExpanded = assignedGroup
      ? areConnectionGroupAncestorsExpanded &&
        expandedObjectGroupKeys.includes(assignedGroup.id)
      : true;
    const assignedGroupCount = assignedGroup
      ? (explorerConnectionGroupCounts.get(assignedGroup.id) ?? 0)
      : 0;

    return (
      <Fragment key={connection.id}>
        {beginsConnectionGroup && assignedGroup && (
          <ExplorerConnectionGroupRow
            group={assignedGroup}
            depth={explorerConnectionGroupDepth(
              assignedGroup,
              explorerConnectionGroupById,
            )}
            count={assignedGroupCount}
            expanded={isConnectionGroupExpanded}
            selected={selectedExplorerNodeIds.includes(
              explorerNodeId("folder", assignedGroup.id),
            )}
            onSelect={(event) =>
              selectExplorerNode(
                explorerNodeId("folder", assignedGroup.id),
                event,
              )
            }
            onToggle={() =>
              setExpandedObjectGroupKeys((current) =>
                current.includes(assignedGroup.id)
                  ? current.filter((id) => id !== assignedGroup.id)
                  : [...current, assignedGroup.id],
              )
            }
            onNewSubgroup={() =>
              setConnectionGroupDraft({
                mode: "create",
                groupId: assignedGroup.id,
                name: "",
              })
            }
            onNewConnection={() =>
              handleNewDataSource(DEFAULT_DATABASE_DRIVER, assignedGroup.id)
            }
            onDropConnections={(connectionIds) =>
              moveExplorerConnectionsToGroup(
                explorerStateScope,
                connectionIds,
                assignedGroup.id,
              )
            }
            onDropGroup={(groupId, placement) =>
              placeExplorerConnectionGroup(
                explorerStateScope,
                groupId,
                assignedGroup.id,
                placement,
              )
            }
            onRename={() =>
              setConnectionGroupDraft({
                mode: "rename",
                groupId: assignedGroup.id,
                name: assignedGroup.name,
              })
            }
            onDelete={async () => {
              if (
                (await confirmAction(
                  `Delete connection group “${assignedGroup.name}”? Connections will be moved to Ungrouped.`,
                ))
              ) {
                deleteExplorerConnectionGroup(
                  explorerStateScope,
                  assignedGroup.id,
                );
              }
            }}
          />
        )}
        <div
          id={`database-connection-${connection.id}`}
          key={connection.id}
          data-database-connection-id={connection.id}
          className={cn(
            "wb-explorer-connection-region rounded-[3px] transition-colors",
            assignedGroup && !isConnectionGroupExpanded && "hidden",
          )}
          style={{
            ...connectionRegionStyle(connection.color, isActive),
            marginLeft: assignedGroup
              ? (explorerConnectionGroupDepth(
                  assignedGroup,
                  explorerConnectionGroupById,
                ) +
                  1) *
                16
              : undefined,
          }}
        >
          <ExplorerSharedContextMenu
            nodeId={explorerNodeId("connection", connection.id)}
          >
            <ContextMenuTrigger asChild>
              <div
                role="treeitem"
                data-explorer-node-id={explorerNodeId(
                  "connection",
                  connection.id,
                )}
                aria-expanded={isConnectionExpanded}
                aria-selected={isConnectionSelected}
                draggable
                onDragOver={(event) => {
                  if (
                    event.dataTransfer.types.includes(
                      EXPLORER_CONNECTION_DRAG_TYPE,
                    )
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  const draggedConnectionIds = readExplorerDraggedConnectionIds(
                    event.dataTransfer,
                  );
                  if (
                    draggedConnectionIds.length === 0 ||
                    draggedConnectionIds.includes(connection.id)
                  ) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const placement =
                    event.clientY < bounds.top + bounds.height / 2
                      ? "before"
                      : "after";
                  const orderedIds = reorderExplorerConnectionIds(
                    visibleExplorerConnections.map((candidate) => candidate.id),
                    draggedConnectionIds,
                    connection.id,
                    placement,
                  );
                  moveExplorerConnectionsToGroup(
                    explorerStateScope,
                    draggedConnectionIds,
                    assignedGroupId || null,
                  );
                  setExplorerConnectionOrder(explorerStateScope, orderedIds);
                  setExplorerConnectionSortMode(explorerStateScope, "manual");
                }}
                onDragStart={(event) => {
                  const draggedConnectionIds = isConnectionSelected
                    ? connections
                        .filter((candidate) =>
                          selectedExplorerNodeIds.includes(
                            explorerNodeId("connection", candidate.id),
                          ),
                        )
                        .map((candidate) => candidate.id)
                    : [connection.id];
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(
                    EXPLORER_CONNECTION_DRAG_TYPE,
                    JSON.stringify(draggedConnectionIds),
                  );
                }}
                tabIndex={
                  isConnectionSelected ||
                  (selectedExplorerNodeIds.length === 0 &&
                    renderedConnectionIndex === 0)
                    ? 0
                    : -1
                }
                className={cn(
                  "wb-tree-row flex h-7 w-full min-w-0 items-center gap-1 rounded-[3px] px-1.5 text-left text-[11px] transition-colors",
                  isConnectionSelected || isActive
                    ? "wb-tree-row-selected"
                    : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
                )}
                onClick={(event) =>
                  void handleConnectionSelect(connection.id, event)
                }
                onDoubleClick={() => void handleConnectionToggle(connection.id)}
                onContextMenu={() => void handleConnectionSelect(connection.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleConnectionSelect(connection.id);
                  } else if (event.key === " ") {
                    event.preventDefault();
                    void handleConnectionToggle(connection.id);
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault();
                    void handleConnectionToggle(connection.id, true);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    void handleConnectionToggle(connection.id, false);
                  } else if (
                    event.key === "ArrowDown" ||
                    event.key === "ArrowUp"
                  ) {
                    event.preventDefault();
                    const nextId = moveExplorerTreeFocus(
                      event.currentTarget,
                      event.key === "ArrowDown" ? 1 : -1,
                    );
                    if (nextId) selectExplorerNode(nextId);
                  }
                }}
              >
                <button
                  type="button"
                  className="-ml-0.5 inline-flex h-5 w-4 shrink-0 items-center justify-center rounded-[3px] wb-muted hover:bg-[hsl(var(--wb-hover-strong))] hover:text-[hsl(var(--wb-text))]"
                  aria-label={
                    isConnectionExpanded
                      ? `Collapse ${connection.name}`
                      : `Expand ${connection.name}`
                  }
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleConnectionToggle(connection.id);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  {isConnectionExpanded ? (
                    <ChevronDown
                      size={13}
                      className="wb-tree-chevron shrink-0"
                    />
                  ) : (
                    <ChevronRight
                      size={13}
                      className="wb-tree-chevron shrink-0"
                    />
                  )}
                </button>
                <ConnectionGlyph
                  driver={connection.driver}
                  icon={connection.icon}
                  size={14}
                  className="shrink-0"
                  style={{ color: connectionColor }}
                  title={
                    showExplorerHoverTooltips
                      ? isManagedConnection
                        ? `${databaseDriverProfile(connection.driver).capabilities.displayName} through managed Gateway`
                        : `${databaseDriverProfile(connection.driver).capabilities.displayName} data source`
                      : undefined
                  }
                />
                <ConnectionRuntimeBadge
                  runtime={connectionRuntime}
                  isConnected={connectedConnectionIds.includes(connection.id)}
                  isConnecting={isConnecting}
                />
                <span className="min-w-0 truncate font-normal [font-variation-settings:'wght'_480]">
                  {connection.name}
                </span>
                {databaseExplorerSettings.showConnectionNotes &&
                  connection.note?.trim() && (
                    <span
                      className="ml-auto max-w-[42%] truncate text-[9px] font-normal text-[hsl(var(--wb-text-muted))]"
                      title={
                        showExplorerHoverTooltips
                          ? connection.note.trim()
                          : undefined
                      }
                    >
                      {connection.note.trim()}
                    </span>
                  )}
                {connection.environment === "production" && (
                  <span
                    className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded-[3px] border border-red-400/30 bg-red-500/10 px-1 text-[8px] font-semibold uppercase tracking-wide text-red-300"
                    title="Production data source. AI database mutations are blocked."
                  >
                    <AlertTriangle size={8} />
                    Prod
                  </span>
                )}
                {connection.environment === "staging" && (
                  <span
                    className="inline-flex h-4 shrink-0 items-center rounded-[3px] border border-amber-400/25 bg-amber-500/8 px-1 text-[8px] font-medium uppercase tracking-wide text-amber-300/90"
                    title="Staging data source"
                  >
                    Stg
                  </span>
                )}
                {isManagedConnection && (
                  <span
                    className="inline-flex h-4 shrink-0 items-center gap-1 rounded-[3px] border border-[hsl(var(--wb-accent)/0.35)] bg-[hsl(var(--wb-accent)/0.08)] px-1 text-[8px] font-medium uppercase tracking-wide text-[hsl(var(--wb-accent))]"
                    title="Credentials stay behind the enterprise Gateway; local write surfaces are disabled."
                  >
                    <ShieldCheck size={9} />
                    Managed
                  </span>
                )}
                <MetadataNodeBadge state={connectionMetadata.nodeState} />
                {isActive &&
                  isFlatKeyValueTree &&
                  (isLoading || isCollectionsLoading) && (
                    <RefreshCw
                      size={11}
                      className="ml-auto shrink-0 animate-spin wb-muted"
                      aria-label="Loading Redis keys"
                    />
                  )}
                {isActive ? renderSchemaVisibilityPicker() : null}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className={menuContentClass}>
              <ExplorerConnectionMenu
                isConnecting={isConnecting}
                connectedConnectionIds={connectedConnectionIds}
                connection={connection}
                setActiveConnection={setActiveConnection}
                disconnect={disconnect}
                handleConnectionSelect={handleConnectionSelect}
                connectionCapabilities={connectionCapabilities}
                setNamespaceError={setNamespaceError}
                createTab={createTab}
                connectionMetadata={connectionMetadata}
                renderSqlHistorySubmenu={renderSqlHistorySubmenu}
                isManagedConnection={isManagedConnection}
                isActive={isActive}
                currentSchema={currentSchema}
                canBrowseTables={canBrowseTables}
                isFlatKeyValueTree={isFlatKeyValueTree}
                setIsCreateDbDialogOpen={setIsCreateDbDialogOpen}
                namespaceLabel={namespaceLabel}
                handleCreateTable={handleCreateTable}
                setIsCreateRedisKeyOpen={setIsCreateRedisKeyOpen}
                copyText={copyText}
                hideExplorerNodes={hideExplorerNodes}
                explorerStateScope={explorerStateScope}
                explorerConnectionFilterParentId={
                  explorerConnectionFilterParentId
                }
                connectionIdsForExplorerAction={connectionIdsForExplorerAction}
                showOnlyExplorerNodes={showOnlyExplorerNodes}
                explorerConnectionVisibilityFilter={
                  explorerConnectionVisibilityFilter
                }
                clearExplorerVisibilityFilter={clearExplorerVisibilityFilter}
                openExplorerVisibilityFilter={openExplorerVisibilityFilter}
                connectionCanBrowseDatabaseCatalogs={
                  connectionCanBrowseDatabaseCatalogs
                }
                connectedPostgresDatabase={connectedPostgresDatabase}
                openDatabaseBrowser={openDatabaseBrowser}
                openRocketMqWorkspace={openRocketMqWorkspace}
                handleRefreshConnection={handleRefreshConnection}
                isLoading={isLoading}
                handleForgetConnectionMetadata={handleForgetConnectionMetadata}
                handleOpenConnectionProperties={handleOpenConnectionProperties}
                handleDuplicateConnection={handleDuplicateConnection}
                explorerConnectionGroups={explorerConnectionGroups}
                assignedGroupId={assignedGroupId}
                moveExplorerConnectionsToGroup={moveExplorerConnectionsToGroup}
                setExpandedObjectGroupKeys={setExpandedObjectGroupKeys}
                setConnectionGroupDraft={setConnectionGroupDraft}
                setDatabaseAdministrationConnectionId={
                  setDatabaseAdministrationConnectionId
                }
                setSqliteBackupTarget={setSqliteBackupTarget}
                handleImportSqlScript={handleImportSqlScript}
                setDataSourceRemovalError={setDataSourceRemovalError}
                setPendingDataSourceRemoval={setPendingDataSourceRemoval}
              />
            </ContextMenuContent>
          </ExplorerSharedContextMenu>

          {isConnectionExpanded ? (
            <div className="wb-explorer-children">
              <ExplorerConnectionContents
                explorerStateScope={explorerStateScope}
                connection={connection}
                connectionCanBrowseDatabaseCatalogs={
                  connectionCanBrowseDatabaseCatalogs
                }
                postgresDatabaseRefreshVersion={postgresDatabaseRefreshVersion}
                isActive={isActive}
                postgresDatabaseDiscovery={postgresDatabaseDiscovery}
                connectedPostgresDatabase={connectedPostgresDatabase}
                handleRefreshConnection={handleRefreshConnection}
                schemaCountLabel={schemaCountLabel}
                connectionSchemas={connectionSchemas}
                connectionColor={connectionColor}
                visiblePostgresDatabases={visiblePostgresDatabases}
                descendantFilterText={descendantFilterText}
                postgresDatabaseMatchesFilter={postgresDatabaseMatchesFilter}
                explorerFilterMatches={explorerFilterMatches}
                setActiveConnection={setActiveConnection}
                loadPostgresRemoteDatabase={loadPostgresRemoteDatabase}
                postgresRemoteDatabases={postgresRemoteDatabases}
                copyText={copyText}
                openObjectBrowser={openObjectBrowser}
                createTab={createTab}
                renderSqlHistorySubmenu={renderSqlHistorySubmenu}
                handleImportSqlScript={handleImportSqlScript}
                handleOpenDataTransfer={handleOpenDataTransfer}
                handleOpenDataCompare={handleOpenDataCompare}
                setSchemaSnapshotIdentity={setSchemaSnapshotIdentity}
                activeProjectId={activeProjectId}
                postgresRemoteRefreshRequest={postgresRemoteRefreshRequest}
                handlePostgresRemoteTablesLoaded={
                  handlePostgresRemoteTablesLoaded
                }
                explorerActivationMode={explorerActivationMode}
                activeCapabilities={activeCapabilities}
                setDatabaseMaintenanceTarget={setDatabaseMaintenanceTarget}
                handlePostgresRemoteTableOpen={handlePostgresRemoteTableOpen}
                connectionMetadata={connectionMetadata}
                namespaceLabelPlural={namespaceLabelPlural}
                renderedConnectionSchemas={renderedConnectionSchemas}
                normalizedObjectFilter={normalizedObjectFilter}
                filterText={filterText}
                schemaVisibilityFilter={schemaVisibilityFilter}
                clearExplorerVisibilityFilter={clearExplorerVisibilityFilter}
                schemaVisibilityParentId={schemaVisibilityParentId}
                currentSchema={currentSchema}
                expandedSchemaKeys={expandedSchemaKeys}
                selectedExplorerNodeIds={selectedExplorerNodeIds}
                metadataNodeStates={metadataNodeStates}
                activateSchemaRow={activateSchemaRow}
                handleSchemaToggle={handleSchemaToggle}
                selectExplorerNode={selectExplorerNode}
                isFlatKeyValueTree={isFlatKeyValueTree}
                runForExplorerSchema={runForExplorerSchema}
                createTableTab={createTableTab}
                canBrowseTables={canBrowseTables}
                connectionCapabilities={connectionCapabilities}
                setViewDialogMode={setViewDialogMode}
                setViewDialogKind={setViewDialogKind}
                setViewDialogInitialName={setViewDialogInitialName}
                setViewDialogInitialSql={setViewDialogInitialSql}
                setIsCreateViewDialogOpen={setIsCreateViewDialogOpen}
                hideExplorerNodes={hideExplorerNodes}
                showOnlyExplorerNodes={showOnlyExplorerNodes}
                openExplorerVisibilityFilter={openExplorerVisibilityFilter}
                setNamespaceError={setNamespaceError}
                handleRefreshSchema={handleRefreshSchema}
                isLoading={isLoading}
                isCollectionsLoading={isCollectionsLoading}
                handleForgetSchemaMetadata={handleForgetSchemaMetadata}
                schemaDiagramLoadingKey={schemaDiagramLoadingKey}
                handleOpenSchemaDiagram={handleOpenSchemaDiagram}
                handleRenameDatabase={handleRenameDatabase}
                handleDropDatabase={handleDropDatabase}
                renderSchemaObjects={renderSchemaObjects}
              />
            </div>
          ) : null}
        </div>
      </Fragment>
    );
  };

  return { renderConnection };
}
