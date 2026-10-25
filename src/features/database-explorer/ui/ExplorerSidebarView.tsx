import { confirmAction } from "@/lib/appDialogs";
import { ConnectionGlyph } from "@/components/icons/ConnectionGlyph";
import { DatabaseBrandIcon } from "@/components/icons/DatabaseBrandIcon";
import { Switch } from "@/components/ui/switch";
import {
  DatabaseExplorerHeader,
  DatabaseExplorerToolbar,
} from "@/components/workspace/DatabaseExplorerChrome";
import {
  connectionTreeColor,
  supportsDatabaseAdministration,
} from "@/features/database-explorer/model/explorerSidebarPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import {
  EXPLORER_CONNECTION_DRAG_TYPE,
  EXPLORER_GROUP_DRAG_TYPE,
  explorerConnectionGroupAncestorsExpanded,
  explorerConnectionGroupDepth,
  ExplorerConnectionGroupRow,
  readExplorerDraggedConnectionIds,
} from "@/features/database-explorer/ui/ExplorerConnectionGroupRow";
import { ExplorerContextMenuHost } from "@/features/database-explorer/ui/ExplorerContextMenuHost";
import { ExplorerSidebarDialogs } from "@/features/database-explorer/ui/ExplorerSidebarDialogs";
import type { ExplorerSidebarViewContext } from "@/features/database-explorer/ui/explorerSidebarViewTypes";
import { ExplorerVirtualizationHost } from "@/features/database-explorer/ui/ExplorerVirtualList";
import { DEFAULT_DATABASE_DRIVER } from "@/lib/databaseDialect";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ChevronRight,
  EyeOff,
  Link2,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

export function ExplorerSidebarView({
  explorerViewMode,
  allowExplorerHorizontalScroll,
  handleExplorerKeyDownCapture,
  isLoading,
  handleRevealActiveConnection,
  handleExpandActiveConnection,
  handleCollapseAll,
  handleRefresh,
  setToolWindowVisible,
  explorerFilterScope,
  explorerConnectionSortMode,
  setExplorerViewMode,
  explorerStateScope,
  setExplorerFilterScope,
  setExplorerConnectionSortMode,
  namespaceLabel,
  activeCapabilities,
  currentSchema,
  canBrowseTables,
  activeConnectionId,
  activeDriver,
  handleNewQueryConsole,
  handleNewDataSource,
  setConnectionGroupDraft,
  handleCreateDatabase,
  handleCreateTable,
  handleCreateView,
  filterInputRef,
  setDatabaseAdministrationConnectionId,
  filterText,
  setFilterText,
  explorerSearchPattern,
  explorerRegexSearch,
  setExplorerRegexSearch,
  explorerSearchMode,
  setExplorerSearchMode,
  explorerConnectionVisibilityFilter,
  clearExplorerVisibilityFilter,
  explorerConnectionFilterParentId,
  showConnectedConnectionsOnly,
  connectedConnectionIds,
  setShowConnectedConnectionsOnly,
  explorerTreeRowHeight,
  explorerScrollRef,
  connectionVirtualizationArmed,
  setExplorerScrollMetrics,
  connections,
  connectionDisplayCache,
  connectionLoadError,
  loadConnections,
  connectionsLoading,
  hasConnectionDisplayCache,
  moveExplorerConnectionsToGroup,
  moveExplorerConnectionGroup,
  connectionVirtualWindow,
  visibleExplorerConnections,
  deferredFilterText,
  orderedExplorerConnectionGroups,
  explorerConnectionGroupById,
  expandedObjectGroupKeys,
  explorerConnectionGroupCounts,
  explorerConnectionGroupIds,
  selectedExplorerNodeIds,
  selectExplorerNode,
  setExpandedObjectGroupKeys,
  placeExplorerConnectionGroup,
  deleteExplorerConnectionGroup,
  renderedExplorerConnections,
  renderConnection,
  namespaceError,
  pendingSqlScriptImport,
  isSqlScriptImporting,
  closeSqlScriptImport,
  handleConfirmSqlScriptImport,
  connectionGroupDraft,
  renameExplorerConnectionGroup,
  createExplorerConnectionGroup,
  isDataSourceDialogOpen,
  setIsDataSourceDialogOpen,
  schemaSnapshotIdentity,
  setSchemaSnapshotIdentity,
  dataTransferRequest,
  activeProjectId,
  setDataTransferRequest,
  handleRefreshSchema,
  mongoCollectionTransferRequest,
  setMongoCollectionTransferRequest,
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
  setExplorerVisibilityPatterns,
  pendingDataSourceRemoval,
  isRemovingDataSource,
  setPendingDataSourceRemoval,
  setDataSourceRemovalError,
  dataSourceRemovalError,
  handleRemoveDataSource,
  databaseAdministrationConnectionId,
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
}: ExplorerSidebarViewContext) {
  return (
    <div
      className="flex h-full min-w-0 flex-col"
      data-explorer-view-mode={explorerViewMode}
      data-explorer-horizontal-scroll={allowExplorerHorizontalScroll}
      onKeyDownCapture={handleExplorerKeyDownCapture}
    >
      <div className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.72)]">
        <DatabaseExplorerHeader
          isLoading={isLoading}
          onRevealActive={handleRevealActiveConnection}
          onExpandActive={handleExpandActiveConnection}
          onCollapseAll={handleCollapseAll}
          onRefresh={() => void handleRefresh()}
          onHide={() => setToolWindowVisible("databaseExplorer", false)}
          viewMode={explorerViewMode}
          filterScope={explorerFilterScope}
          connectionSortMode={explorerConnectionSortMode}
          onViewModeChange={(mode) =>
            setExplorerViewMode(explorerStateScope, mode)
          }
          onFilterScopeChange={(scope) =>
            setExplorerFilterScope(explorerStateScope, scope)
          }
          onConnectionSortModeChange={(mode) =>
            setExplorerConnectionSortMode(explorerStateScope, mode)
          }
        />

        <DatabaseExplorerToolbar
          isLoading={isLoading}
          namespaceLabel={namespaceLabel}
          canCreateNamespace={activeCapabilities.supportsCreateDatabase}
          canCreateTable={Boolean(
            currentSchema &&
              canBrowseTables &&
              activeCapabilities.supportsTableDdl,
          )}
          canCreateView={Boolean(
            currentSchema && activeCapabilities.supportsViews,
          )}
          canManageAdministration={
            Boolean(activeConnectionId) &&
            supportsDatabaseAdministration(activeDriver)
          }
          isFilterVisible
          onNewQueryConsole={handleNewQueryConsole}
          onNewDataSource={handleNewDataSource}
          onNewConnectionGroup={() =>
            setConnectionGroupDraft({ mode: "create", name: "" })
          }
          onCreateNamespace={handleCreateDatabase}
          onCreateTable={handleCreateTable}
          onCreateView={handleCreateView}
          onRefresh={() => void handleRefresh()}
          onToggleFilter={() => filterInputRef.current?.focus()}
          onManageAdministration={() =>
            setDatabaseAdministrationConnectionId(activeConnectionId)
          }
        />
      </div>

      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[hsl(var(--wb-border-subtle))] px-1.5 py-1">
        <div className="relative min-w-0 flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 wb-muted"
          />
          <input
            ref={filterInputRef}
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && filterText) {
                event.preventDefault();
                setFilterText("");
              }
            }}
            placeholder={
              activeCapabilities.dataModel === "keyValue"
                ? "Filter keys on server"
                : "Filter database objects"
            }
            aria-invalid={explorerSearchPattern.invalid || undefined}
            title={
              explorerSearchPattern.invalid
                ? explorerSearchPattern.error || "Invalid regular expression"
                : undefined
            }
            className={cn(
              "h-6 w-full rounded-[3px] border bg-[hsl(var(--wb-editor))] pl-6 pr-[4.75rem] text-[11px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))]",
              explorerSearchPattern.invalid
                ? "border-[hsl(var(--destructive))] focus:border-[hsl(var(--destructive))]"
                : "border-[hsl(var(--wb-border))] focus:border-[hsl(var(--wb-accent))]",
            )}
          />
          <div className="absolute inset-y-0 right-0.5 flex items-center gap-0.5">
            {filterText && (
              <button
                type="button"
                className="wb-icon-button h-5 w-5"
                onClick={() => setFilterText("")}
                title="Clear Filter"
                aria-label="Clear database object filter"
              >
                <X size={11} />
              </button>
            )}
            <button
              type="button"
              className={cn(
                "flex h-5 min-w-5 items-center justify-center rounded-[2px] px-0.5 font-mono text-[9px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
                explorerRegexSearch &&
                  "bg-[hsl(var(--wb-accent))]/12 text-[hsl(var(--wb-accent))]",
                explorerSearchPattern.invalid &&
                  "text-[hsl(var(--destructive))]",
              )}
              aria-label="Use regular expression search"
              aria-pressed={explorerRegexSearch}
              title={
                explorerSearchPattern.invalid
                  ? explorerSearchPattern.error || "Invalid regular expression"
                  : "Regex search (local only)"
              }
              onClick={() =>
                setExplorerRegexSearch(explorerStateScope, !explorerRegexSearch)
              }
            >
              .*
            </button>
            <span
              className={cn(
                "inline-flex h-5 items-center",
                explorerRegexSearch && "opacity-70",
              )}
              title={
                explorerRegexSearch
                  ? "Regex search is always local and never sends the expression to a database"
                  : "Local search: search only currently loaded objects without remote requests"
              }
            >
              <Switch
                checked={explorerRegexSearch || explorerSearchMode === "local"}
                disabled={explorerRegexSearch}
                onCheckedChange={(checked) =>
                  setExplorerSearchMode(
                    explorerStateScope,
                    checked ? "local" : "global",
                  )
                }
                aria-label="Search only currently loaded database objects"
                className="h-3.5 w-6 data-[state=checked]:bg-[hsl(var(--wb-accent))] [&>span]:h-2.5 [&>span]:w-2.5 [&>span]:data-[state=checked]:translate-x-3"
              />
            </span>
          </div>
        </div>
        {explorerConnectionVisibilityFilter && (
          <button
            type="button"
            className="wb-icon-button h-6 w-6 shrink-0 border border-[hsl(var(--wb-accent))]/45 bg-[hsl(var(--wb-accent))]/12 text-[hsl(var(--wb-accent))]"
            onClick={() =>
              clearExplorerVisibilityFilter(
                explorerStateScope,
                explorerConnectionFilterParentId,
              )
            }
            title="Connection visibility filter active · click to clear"
            aria-label="Clear active connection visibility filter"
          >
            <EyeOff size={12} />
          </button>
        )}
        <button
          type="button"
          className={cn(
            "wb-icon-button h-6 w-6 shrink-0 border border-[hsl(var(--wb-border))]",
            showConnectedConnectionsOnly &&
              "border-[hsl(var(--wb-accent))]/45 bg-[hsl(var(--wb-accent))]/12 text-[hsl(var(--wb-accent))]",
          )}
          aria-pressed={showConnectedConnectionsOnly}
          disabled={connectedConnectionIds.length === 0}
          onClick={() => setShowConnectedConnectionsOnly((current) => !current)}
          title="Show connected data sources only"
        >
          <Link2 size={12} />
        </button>
      </div>

      <ExplorerVirtualizationHost rowHeight={explorerTreeRowHeight}>
        <ExplorerContextMenuHost>
          <div
            ref={explorerScrollRef}
            data-explorer-scroll-root
            className={cn(
              "min-h-0 flex-1 overflow-y-auto px-1 py-1 custom-scrollbar",
              allowExplorerHorizontalScroll
                ? "overflow-x-auto"
                : "overflow-x-hidden",
            )}
            onScroll={(event) => {
              if (!connectionVirtualizationArmed) return;
              const scrollTop = event.currentTarget.scrollTop;
              setExplorerScrollMetrics((current) =>
                current.scrollTop === scrollTop
                  ? current
                  : { ...current, scrollTop },
              );
            }}
          >
            <div
              className={cn(
                "space-y-0",
                allowExplorerHorizontalScroll &&
                  "wb-explorer-natural-width min-w-max",
              )}
            >
              {connections.length === 0 && connectionDisplayCache.length > 0 ? (
                <div className="space-y-0">
                  {connectionDisplayCache.map((connection) => (
                    <div
                      key={connection.id}
                      className="flex h-6 w-full min-w-0 items-center gap-1 rounded-[3px] px-1.5 text-[11px] text-[hsl(var(--wb-text-muted))]"
                      aria-label={connection.name}
                    >
                      <ChevronRight size={13} className="shrink-0 wb-muted" />
                      <ConnectionGlyph
                        driver={connection.driver}
                        icon={connection.icon}
                        size={14}
                        className="shrink-0"
                        style={{
                          color: connectionTreeColor(
                            connection.driver,
                            connection.color,
                          ),
                        }}
                      />
                      <span className="truncate font-normal [font-variation-settings:'wght'_480]">
                        {connection.name}
                      </span>
                    </div>
                  ))}
                  {connectionLoadError && (
                    <div
                      className="mt-1 flex items-start gap-1.5 px-2 py-1.5 text-[10px] text-amber-500"
                      role="status"
                    >
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={connectionLoadError}
                      >
                        Showing cached data sources; refresh failed.
                      </span>
                      <button
                        type="button"
                        className="shrink-0 underline underline-offset-2"
                        onClick={() => void loadConnections()}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              ) : connections.length === 0 &&
                connectionsLoading &&
                !hasConnectionDisplayCache ? (
                <div
                  className="flex items-center gap-2 px-3 py-2.5 text-[11px] wb-muted"
                  role="status"
                  aria-label="Loading data sources"
                >
                  <RefreshCw size={11} className="shrink-0 animate-spin" />
                  <span>Loading data sources…</span>
                </div>
              ) : connections.length === 0 && connectionLoadError ? (
                <div
                  className="flex items-start gap-2 px-3 py-3 text-[11px] text-amber-500"
                  role="alert"
                >
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div>
                      {hasConnectionDisplayCache
                        ? "No cached data sources; refresh failed."
                        : "Could not load data sources."}
                    </div>
                    <div
                      className="mt-0.5 truncate text-[10px] wb-muted"
                      title={connectionLoadError}
                    >
                      {connectionLoadError}
                    </div>
                    <button
                      type="button"
                      className="mt-1.5 text-[10px] underline underline-offset-2"
                      onClick={() => void loadConnections()}
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : connections.length === 0 ? (
                <div className="flex flex-col items-center px-4 py-8 text-center">
                  <DatabaseBrandIcon
                    driver={DEFAULT_DATABASE_DRIVER}
                    size={24}
                    className="mb-2 opacity-80"
                  />
                  <span className="text-[11px] font-medium text-[hsl(var(--wb-text))]">
                    No data sources
                  </span>
                  <span className="mt-1 text-[10px] leading-4 wb-muted">
                    Add a connection to browse schemas and objects.
                  </span>
                  <button
                    type="button"
                    className="wb-text-button mt-2 text-[hsl(var(--wb-accent))]"
                    onClick={() => handleNewDataSource(DEFAULT_DATABASE_DRIVER)}
                  >
                    <Plus size={12} />
                    Add data source
                  </button>
                </div>
              ) : (
                <div
                  role="tree"
                  aria-label="Database connections"
                  onDragOver={(event) => {
                    if (
                      event.dataTransfer.types.includes(
                        EXPLORER_CONNECTION_DRAG_TYPE,
                      ) ||
                      event.dataTransfer.types.includes(
                        EXPLORER_GROUP_DRAG_TYPE,
                      )
                    ) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const connectionIds = readExplorerDraggedConnectionIds(
                      event.dataTransfer,
                    );
                    if (connectionIds.length > 0) {
                      moveExplorerConnectionsToGroup(
                        explorerStateScope,
                        connectionIds,
                        null,
                      );
                      return;
                    }
                    const groupId = event.dataTransfer.getData(
                      EXPLORER_GROUP_DRAG_TYPE,
                    );
                    if (groupId) {
                      moveExplorerConnectionGroup(
                        explorerStateScope,
                        groupId,
                        null,
                      );
                    }
                  }}
                >
                  {connectionVirtualizationArmed &&
                    connectionVirtualWindow.offsetTop > 0 && (
                      <div
                        aria-hidden="true"
                        style={{ height: connectionVirtualWindow.offsetTop }}
                      />
                    )}
                  {visibleExplorerConnections.length === 0 && (
                    <div
                      role="status"
                      className="px-3 py-3 text-[11px] wb-muted"
                    >
                      {showConnectedConnectionsOnly &&
                      !deferredFilterText.trim()
                        ? "No connected data sources"
                        : `No data sources match “${deferredFilterText.trim()}”`}
                    </div>
                  )}
                  {!deferredFilterText.trim() &&
                    orderedExplorerConnectionGroups
                      .filter(
                        (group) =>
                          explorerConnectionGroupAncestorsExpanded(
                            group,
                            explorerConnectionGroupById,
                            expandedObjectGroupKeys,
                          ) &&
                          (!showConnectedConnectionsOnly ||
                            (explorerConnectionGroupCounts.get(group.id) ?? 0) >
                              0) &&
                          !visibleExplorerConnections.some(
                            (connection) =>
                              explorerConnectionGroupIds[connection.id] ===
                              group.id,
                          ),
                      )
                      .map((group) => (
                        <ExplorerConnectionGroupRow
                          key={group.id}
                          group={group}
                          depth={explorerConnectionGroupDepth(
                            group,
                            explorerConnectionGroupById,
                          )}
                          count={
                            explorerConnectionGroupCounts.get(group.id) ?? 0
                          }
                          expanded={expandedObjectGroupKeys.includes(group.id)}
                          selected={selectedExplorerNodeIds.includes(
                            explorerNodeId("folder", group.id),
                          )}
                          onSelect={(event) =>
                            selectExplorerNode(
                              explorerNodeId("folder", group.id),
                              event,
                            )
                          }
                          onToggle={() =>
                            setExpandedObjectGroupKeys((current) =>
                              current.includes(group.id)
                                ? current.filter((id) => id !== group.id)
                                : [...current, group.id],
                            )
                          }
                          onNewSubgroup={() =>
                            setConnectionGroupDraft({
                              mode: "create",
                              groupId: group.id,
                              name: "",
                            })
                          }
                          onNewConnection={() =>
                            handleNewDataSource(
                              DEFAULT_DATABASE_DRIVER,
                              group.id,
                            )
                          }
                          onDropConnections={(connectionIds) =>
                            moveExplorerConnectionsToGroup(
                              explorerStateScope,
                              connectionIds,
                              group.id,
                            )
                          }
                          onDropGroup={(groupId, placement) =>
                            placeExplorerConnectionGroup(
                              explorerStateScope,
                              groupId,
                              group.id,
                              placement,
                            )
                          }
                          onRename={() =>
                            setConnectionGroupDraft({
                              mode: "rename",
                              groupId: group.id,
                              name: group.name,
                            })
                          }
                          onDelete={async () => {
                            if (
                              (await confirmAction(
                                `Delete connection group “${group.name}”?`,
                              ))
                            ) {
                              deleteExplorerConnectionGroup(
                                explorerStateScope,
                                group.id,
                              );
                            }
                          }}
                        />
                      ))}
                  {renderedExplorerConnections.map(renderConnection)}
                  {connectionVirtualizationArmed &&
                    connectionVirtualWindow.end <
                      visibleExplorerConnections.length && (
                      <div
                        aria-hidden="true"
                        style={{
                          height:
                            connectionVirtualWindow.totalHeight -
                            connectionVirtualWindow.end * explorerTreeRowHeight,
                        }}
                      />
                    )}
                </div>
              )}
            </div>
            {namespaceError && (
              <div className="mt-1 text-[10px] text-destructive truncate">
                {namespaceError}
              </div>
            )}
          </div>
        </ExplorerContextMenuHost>
      </ExplorerVirtualizationHost>

      <ExplorerSidebarDialogs
        pendingSqlScriptImport={pendingSqlScriptImport}
        isSqlScriptImporting={isSqlScriptImporting}
        closeSqlScriptImport={closeSqlScriptImport}
        handleConfirmSqlScriptImport={handleConfirmSqlScriptImport}
        connectionGroupDraft={connectionGroupDraft}
        setConnectionGroupDraft={setConnectionGroupDraft}
        renameExplorerConnectionGroup={renameExplorerConnectionGroup}
        explorerStateScope={explorerStateScope}
        createExplorerConnectionGroup={createExplorerConnectionGroup}
        setExpandedObjectGroupKeys={setExpandedObjectGroupKeys}
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
        visibilityFilterDraft={visibilityFilterDraft}
        setVisibilityFilterDraft={setVisibilityFilterDraft}
        clearExplorerVisibilityFilter={clearExplorerVisibilityFilter}
        setExplorerVisibilityPatterns={setExplorerVisibilityPatterns}
        pendingDataSourceRemoval={pendingDataSourceRemoval}
        isRemovingDataSource={isRemovingDataSource}
        setPendingDataSourceRemoval={setPendingDataSourceRemoval}
        setDataSourceRemovalError={setDataSourceRemovalError}
        dataSourceRemovalError={dataSourceRemovalError}
        handleRemoveDataSource={handleRemoveDataSource}
        databaseAdministrationConnectionId={databaseAdministrationConnectionId}
        setDatabaseAdministrationConnectionId={
          setDatabaseAdministrationConnectionId
        }
        activeDriver={activeDriver}
        databaseMaintenanceTarget={databaseMaintenanceTarget}
        setDatabaseMaintenanceTarget={setDatabaseMaintenanceTarget}
        sqliteBackupTarget={sqliteBackupTarget}
        setSqliteBackupTarget={setSqliteBackupTarget}
        handleRefreshConnection={handleRefreshConnection}
        isCreateDbDialogOpen={isCreateDbDialogOpen}
        setIsCreateDbDialogOpen={setIsCreateDbDialogOpen}
        setExpandedConnectionIds={setExpandedConnectionIds}
        setExpandedSchemaKeys={setExpandedSchemaKeys}
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
    </div>
  );
}
