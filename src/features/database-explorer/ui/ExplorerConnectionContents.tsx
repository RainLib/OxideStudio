import {
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { PostgresDatabaseTree } from "@/components/workspace/PostgresDatabaseTree";
import { connectionCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";
import { explorerObjectIconClass } from "@/features/database-explorer/model/explorerObjectPresentation";
import { schemaTreeKey } from "@/features/database-explorer/model/explorerSidebarPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import { ExplorerSharedContextMenu } from "@/features/database-explorer/ui/ExplorerContextMenuHost";
import { ExplorerDatabaseMenu } from "@/features/database-explorer/ui/ExplorerDatabaseMenu";
import { ExplorerRemoteDatabaseContents } from "@/features/database-explorer/ui/ExplorerRemoteDatabaseContents";
import { ExplorerSchemaMenu } from "@/features/database-explorer/ui/ExplorerSchemaMenu";
import { MetadataNodeBadge } from "@/features/database-explorer/ui/ExplorerStatusBadges";
import { EXPLORER_MENU_CONTENT_CLASS as menuContentClass } from "@/features/database-explorer/ui/explorerStyles";
import { moveExplorerTreeFocus } from "@/features/database-explorer/ui/explorerTreeDom";
import { ExplorerTreeStateRow } from "@/features/database-explorer/ui/ExplorerTreeStateRow";
import { databaseSchemaNavigationKey } from "@/lib/databaseNavigation";
import { isLoginUserSchema } from "@/lib/loginUserSchema";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/store/useConnectionStore";
import type { useDatabaseExplorerStore } from "@/store/useDatabaseExplorerStore";
import { getSchemaMetadataNodeKey } from "@/store/useSchemaStore";
import type { useTabStore } from "@/store/useTabStore";
import { ChevronDown, ChevronRight, Database, Network } from "lucide-react";

type DatabaseExplorerState = ReturnType<
  typeof useDatabaseExplorerStore.getState
>;

type TabState = ReturnType<typeof useTabStore.getState>;
type ConnectionState = ReturnType<typeof useConnectionStore.getState>;

interface ExplorerConnectionContentsContext {
  explorerStateScope: string;
  connection: import("@/store/useConnectionStore").ConnectionConfig;
  connectionCanBrowseDatabaseCatalogs: boolean;
  postgresDatabaseRefreshVersion: number;
  isActive: boolean;
  postgresDatabaseDiscovery: import("@/hooks/usePostgresDatabaseDiscovery").PostgresDatabaseDiscoveryState;
  connectedPostgresDatabase: string;
  handleRefreshConnection: (connectionId: string) => Promise<void>;
  schemaCountLabel: string;
  connectionSchemas: string[];
  connectionColor: string;
  visiblePostgresDatabases: string[];
  descendantFilterText: string;
  postgresDatabaseMatchesFilter: (
    connectionId: string,
    database: string,
    currentDatabase: string,
    filter: string,
  ) => boolean;
  explorerFilterMatches: (...values: unknown[]) => boolean;
  setActiveConnection: ConnectionState["setActiveConnection"];
  loadPostgresRemoteDatabase: (
    connectionId: string,
    database: string,
  ) => Promise<void>;
  postgresRemoteDatabases: import("@/features/database-explorer/model/explorerSidebarTypes").PostgresRemoteDatabaseState;

  copyText: (value: string) => Promise<void>;

  openObjectBrowser: TabState["openObjectBrowser"];
  createTab: TabState["createTab"];
  renderSqlHistorySubmenu: React.ComponentProps<
    typeof ExplorerSchemaMenu
  >["renderSqlHistorySubmenu"];
  handleImportSqlScript: React.ComponentProps<
    typeof ExplorerDatabaseMenu
  >["handleImportSqlScript"];
  handleOpenDataTransfer: React.ComponentProps<
    typeof ExplorerDatabaseMenu
  >["handleOpenDataTransfer"];
  handleOpenDataCompare: React.ComponentProps<
    typeof ExplorerDatabaseMenu
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
    typeof ExplorerRemoteDatabaseContents
  >["handlePostgresRemoteTablesLoaded"];
  explorerActivationMode: import("@/lib/appSettings").ExplorerActivationMode;
  activeCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  setDatabaseMaintenanceTarget: React.ComponentProps<
    typeof ExplorerRemoteDatabaseContents
  >["setDatabaseMaintenanceTarget"];
  handlePostgresRemoteTableOpen: React.ComponentProps<
    typeof ExplorerRemoteDatabaseContents
  >["handlePostgresRemoteTableOpen"];
  connectionMetadata: React.ComponentProps<
    typeof ExplorerSchemaMenu
  >["connectionMetadata"];
  namespaceLabelPlural: string;
  renderedConnectionSchemas: string[];
  normalizedObjectFilter: string;
  filterText: string;
  schemaVisibilityFilter:
    | import("@/features/database-explorer/model/explorerVisibilityFilter").ExplorerVisibilityFilter
    | undefined;
  clearExplorerVisibilityFilter: DatabaseExplorerState["clearVisibilityFilter"];
  schemaVisibilityParentId: string;
  currentSchema: string | null;
  expandedSchemaKeys: string[];
  selectedExplorerNodeIds: string[];
  metadataNodeStates: Record<
    string,
    import("@/store/useSchemaStore").MetadataNodeState
  >;
  activateSchemaRow: (
    connectionId: string,
    schema: string,
    isCurrentSchema: boolean,
    event?:
      | {
          currentTarget: HTMLElement;
          ctrlKey: boolean;
          metaKey: boolean;
          shiftKey: boolean;
        }
      | undefined,
  ) => Promise<void>;
  handleSchemaToggle: (
    connectionId: string,
    schema: string,
    isCurrentSchema: boolean,
    forceExpanded?: boolean | undefined,
  ) => Promise<void>;
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
  isFlatKeyValueTree: boolean;

  runForExplorerSchema: (
    connectionId: string,
    schema: string,
    action: () => void | Promise<void>,
  ) => Promise<void>;
  createTableTab: TabState["createTableTab"];
  canBrowseTables: boolean;
  connectionCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  setViewDialogMode: React.Dispatch<React.SetStateAction<"create" | "edit">>;
  setViewDialogKind: React.Dispatch<
    React.SetStateAction<"view" | "materializedView">
  >;
  setViewDialogInitialName: React.Dispatch<React.SetStateAction<string>>;
  setViewDialogInitialSql: React.Dispatch<React.SetStateAction<string>>;
  setIsCreateViewDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  hideExplorerNodes: DatabaseExplorerState["hideNodes"];
  showOnlyExplorerNodes: DatabaseExplorerState["showOnlyNodes"];
  openExplorerVisibilityFilter: (parentNodeId: string, label: string) => void;
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  handleRefreshSchema: (connectionId: string, schema: string) => Promise<void>;
  isLoading: boolean;
  isCollectionsLoading: boolean;
  handleForgetSchemaMetadata: (
    connectionId: string,
    driver: string | null | undefined,
    schema: string,
  ) => Promise<void>;
  schemaDiagramLoadingKey: string | null;
  handleOpenSchemaDiagram: React.ComponentProps<
    typeof ExplorerSchemaMenu
  >["handleOpenSchemaDiagram"];
  handleRenameDatabase: React.ComponentProps<
    typeof ExplorerSchemaMenu
  >["handleRenameDatabase"];
  handleDropDatabase: React.ComponentProps<
    typeof ExplorerSchemaMenu
  >["handleDropDatabase"];
  renderSchemaObjects: (
    connectionId: string,
    driver: string | null | undefined,
    schema: string,
    _connectionColor: string,
    activeCapabilities: import("@/services/tauri/types").DatabaseCapabilities,
  ) => import("react").JSX.Element;
}

export function ExplorerConnectionContents({
  explorerStateScope,
  connection,
  connectionCanBrowseDatabaseCatalogs,
  postgresDatabaseRefreshVersion,
  isActive,
  postgresDatabaseDiscovery,
  connectedPostgresDatabase,
  handleRefreshConnection,
  schemaCountLabel,
  connectionSchemas,
  connectionColor,
  visiblePostgresDatabases,
  descendantFilterText,
  postgresDatabaseMatchesFilter,
  explorerFilterMatches,
  setActiveConnection,
  loadPostgresRemoteDatabase,
  postgresRemoteDatabases,

  copyText,

  openObjectBrowser,
  createTab,
  renderSqlHistorySubmenu,
  handleImportSqlScript,
  handleOpenDataTransfer,
  handleOpenDataCompare,
  setSchemaSnapshotIdentity,
  activeProjectId,
  postgresRemoteRefreshRequest,
  handlePostgresRemoteTablesLoaded,
  explorerActivationMode,
  activeCapabilities,
  setDatabaseMaintenanceTarget,
  handlePostgresRemoteTableOpen,
  connectionMetadata,
  namespaceLabelPlural,
  renderedConnectionSchemas,
  normalizedObjectFilter,
  filterText,
  schemaVisibilityFilter,
  clearExplorerVisibilityFilter,
  schemaVisibilityParentId,
  currentSchema,
  expandedSchemaKeys,
  selectedExplorerNodeIds,
  metadataNodeStates,
  activateSchemaRow,
  handleSchemaToggle,
  selectExplorerNode,
  isFlatKeyValueTree,

  runForExplorerSchema,
  createTableTab,
  canBrowseTables,
  connectionCapabilities,
  setViewDialogMode,
  setViewDialogKind,
  setViewDialogInitialName,
  setViewDialogInitialSql,
  setIsCreateViewDialogOpen,
  hideExplorerNodes,
  showOnlyExplorerNodes,
  openExplorerVisibilityFilter,
  setNamespaceError,
  handleRefreshSchema,
  isLoading,
  isCollectionsLoading,
  handleForgetSchemaMetadata,
  schemaDiagramLoadingKey,
  handleOpenSchemaDiagram,
  handleRenameDatabase,
  handleDropDatabase,
  renderSchemaObjects,
}: ExplorerConnectionContentsContext) {
  return (
    <PostgresDatabaseTree
      explorerScopeId={explorerStateScope}
      connectionId={connection.id}
      key={`${connection.id}:${
        connectionCanBrowseDatabaseCatalogs ? postgresDatabaseRefreshVersion : 0
      }:${isActive ? "active" : "inactive"}`}
      enabled={connectionCanBrowseDatabaseCatalogs}
      databases={
        postgresDatabaseDiscovery.connectionId === connection.id
          ? postgresDatabaseDiscovery.databases
          : []
      }
      currentDatabase={connectedPostgresDatabase}
      onRetryDiscovery={() => void handleRefreshConnection(connection.id)}
      status={
        postgresDatabaseDiscovery.connectionId === connection.id
          ? postgresDatabaseDiscovery.status
          : isActive
            ? "idle"
            : "success"
      }
      error={
        postgresDatabaseDiscovery.connectionId === connection.id
          ? postgresDatabaseDiscovery.error
          : null
      }
      schemaCount={
        isActive ? schemaCountLabel : String(connectionSchemas.length)
      }
      connectionColor={connectionColor}
      visibleDatabases={
        isActive && connectionCanBrowseDatabaseCatalogs
          ? visiblePostgresDatabases
          : undefined
      }
      filterText={
        connectionCanBrowseDatabaseCatalogs ? descendantFilterText : ""
      }
      databaseMatchesFilter={(database, normalizedFilter) =>
        postgresDatabaseMatchesFilter(
          connection.id,
          database,
          connectedPostgresDatabase,
          normalizedFilter,
        )
      }
      matchesFilter={explorerFilterMatches}
      onLoadDatabase={
        isActive && connectionCanBrowseDatabaseCatalogs
          ? async (database) => {
              if (
                !useConnectionStore
                  .getState()
                  .connectedConnectionIds.includes(connection.id)
              ) {
                const connectionError = await setActiveConnection(
                  connection.id,
                );
                if (connectionError) {
                  throw new Error(connectionError);
                }
              }
              await loadPostgresRemoteDatabase(connection.id, database);
            }
          : undefined
      }
      renderDatabaseContextMenu={(database) => {
        const databaseSchemas =
          postgresRemoteDatabases.connectionId === connection.id
            ? postgresRemoteDatabases.schemas[database] || []
            : [];

        return (
          <ExplorerDatabaseMenu
            copyText={copyText}
            database={database}
            openObjectBrowser={openObjectBrowser}
            connection={connection}
            createTab={createTab}
            renderSqlHistorySubmenu={renderSqlHistorySubmenu}
            handleImportSqlScript={handleImportSqlScript}
            handleOpenDataTransfer={handleOpenDataTransfer}
            handleOpenDataCompare={handleOpenDataCompare}
            databaseSchemas={databaseSchemas}
            setSchemaSnapshotIdentity={setSchemaSnapshotIdentity}
            activeProjectId={activeProjectId}
            loadPostgresRemoteDatabase={loadPostgresRemoteDatabase}
            connectedPostgresDatabase={connectedPostgresDatabase}
            handleRefreshConnection={handleRefreshConnection}
          />
        );
      }}
      renderDatabaseChildren={(database) =>
        database === connectedPostgresDatabase ? null : (
          <ExplorerRemoteDatabaseContents
            database={database}
            explorerStateScope={explorerStateScope}
            connection={connection}
            postgresRemoteDatabases={postgresRemoteDatabases}
            postgresRemoteRefreshRequest={postgresRemoteRefreshRequest}
            explorerFilterMatches={explorerFilterMatches}
            descendantFilterText={descendantFilterText}
            handlePostgresRemoteTablesLoaded={handlePostgresRemoteTablesLoaded}
            setSchemaSnapshotIdentity={setSchemaSnapshotIdentity}
            activeProjectId={activeProjectId}
            openObjectBrowser={openObjectBrowser}
            createTab={createTab}
            renderSqlHistorySubmenu={renderSqlHistorySubmenu}
            handleOpenDataTransfer={handleOpenDataTransfer}
            explorerActivationMode={explorerActivationMode}
            activeCapabilities={activeCapabilities}
            handleOpenDataCompare={handleOpenDataCompare}
            setDatabaseMaintenanceTarget={setDatabaseMaintenanceTarget}
            handleImportSqlScript={handleImportSqlScript}
            handlePostgresRemoteTableOpen={handlePostgresRemoteTableOpen}
          />
        )
      }
    >
      {(connectionMetadata.isLoading ||
        connectionMetadata.nodeState?.status === "loading") &&
      connectionSchemas.length === 0 ? (
        <div className="px-1.5 py-1 text-[11px] italic wb-muted">
          Loading {namespaceLabelPlural}...
        </div>
      ) : renderedConnectionSchemas.length === 0 &&
        connectionMetadata.nodeState?.status === "error" ? (
        <ExplorerTreeStateRow
          state="error"
          title={
            connectionMetadata.nodeState.message ||
            "Namespace metadata could not be loaded"
          }
          onRetry={() => void handleRefreshConnection(connection.id)}
          retryAriaLabel={`Retry loading ${namespaceLabelPlural} for ${connection.name}`}
        >
          {connectionMetadata.nodeState.message ||
            `${namespaceLabelPlural} unavailable`}
        </ExplorerTreeStateRow>
      ) : renderedConnectionSchemas.length === 0 ? (
        <div className="flex min-h-7 items-center gap-1 px-1.5 py-1 text-[11px] italic wb-muted">
          <span>
            {normalizedObjectFilter
              ? `No ${namespaceLabelPlural} match “${filterText.trim()}”`
              : schemaVisibilityFilter
                ? `All ${namespaceLabelPlural} are hidden by the active filter`
                : `No ${namespaceLabelPlural} found`}
          </span>
          {schemaVisibilityFilter && (
            <button
              type="button"
              className="ml-auto shrink-0 not-italic text-[10px] text-[hsl(var(--wb-accent))] hover:underline"
              onClick={() =>
                clearExplorerVisibilityFilter(
                  explorerStateScope,
                  schemaVisibilityParentId,
                )
              }
            >
              Clear filter
            </button>
          )}
        </div>
      ) : (
        renderedConnectionSchemas.map((schema) => {
          const isCurrentSchema = isActive && schema === currentSchema;
          const isLoginSchema = isLoginUserSchema(connection, schema);
          const schemaKey = schemaTreeKey(
            connection.id,
            connection.driver,
            schema,
          );
          const schemaExplorerNodeId = explorerNodeId(
            "schema",
            connection.id,
            connectionCanBrowseDatabaseCatalogs
              ? connectedPostgresDatabase
              : "",
            schema,
          );
          const isSchemaExpanded = expandedSchemaKeys.includes(schemaKey);
          const isSchemaSelected =
            selectedExplorerNodeIds.includes(schemaExplorerNodeId);
          const schemaNodeIdsForAction = isSchemaSelected
            ? connectionSchemas
                .map((candidate) =>
                  explorerNodeId(
                    "schema",
                    connection.id,
                    connectionCanBrowseDatabaseCatalogs
                      ? connectedPostgresDatabase
                      : "",
                    candidate,
                  ),
                )
                .filter((nodeId) => selectedExplorerNodeIds.includes(nodeId))
            : [schemaExplorerNodeId];
          const schemaNodeState =
            metadataNodeStates[
              getSchemaMetadataNodeKey(connection.id, connection.driver, schema)
            ];

          return (
            <div key={schema} className="min-w-0">
              <ExplorerSharedContextMenu nodeId={schemaExplorerNodeId}>
                <ContextMenuTrigger asChild>
                  <div
                    role="treeitem"
                    data-explorer-node-id={schemaExplorerNodeId}
                    aria-expanded={isSchemaExpanded}
                    aria-selected={isSchemaSelected}
                    tabIndex={isSchemaSelected ? 0 : -1}
                    data-database-schema-key={databaseSchemaNavigationKey({
                      connectionId: connection.id,
                      databaseName: connectionCanBrowseDatabaseCatalogs
                        ? connectionCatalogDatabaseName(connection)
                        : connection.database || undefined,
                      schemaName: schema,
                    })}
                    className={cn(
                      "wb-tree-row flex h-7 w-full min-w-0 items-center gap-1 rounded-[3px] px-1.5 text-left text-[11px] font-normal [font-variation-settings:'wght'_430] transition-colors",
                      !connectionCanBrowseDatabaseCatalogs &&
                        isSchemaExpanded &&
                        !normalizedObjectFilter &&
                        "sticky top-0 z-[2] bg-[hsl(var(--wb-panel))]",
                      isLoginSchema &&
                        "font-semibold [font-variation-settings:'wght'_600]",
                      isSchemaSelected || isCurrentSchema
                        ? "wb-tree-row-selected font-medium text-[hsl(var(--wb-text))]"
                        : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
                    )}
                    title={
                      isLoginSchema ? `${schema} · current login user` : schema
                    }
                    onClick={(event) => {
                      void activateSchemaRow(
                        connection.id,
                        schema,
                        isCurrentSchema,
                        event,
                      ).catch((error) => {
                        console.warn("Failed to select schema", error);
                      });
                    }}
                    onDoubleClick={() => {
                      void handleSchemaToggle(
                        connection.id,
                        schema,
                        isCurrentSchema,
                      );
                    }}
                    onContextMenu={() => {
                      void activateSchemaRow(
                        connection.id,
                        schema,
                        isCurrentSchema,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void activateSchemaRow(
                          connection.id,
                          schema,
                          isCurrentSchema,
                        );
                      } else if (event.key === " ") {
                        event.preventDefault();
                        void handleSchemaToggle(
                          connection.id,
                          schema,
                          isCurrentSchema,
                        );
                      } else if (event.key === "ArrowRight") {
                        event.preventDefault();
                        void handleSchemaToggle(
                          connection.id,
                          schema,
                          isCurrentSchema,
                          true,
                        );
                      } else if (event.key === "ArrowLeft") {
                        event.preventDefault();
                        void handleSchemaToggle(
                          connection.id,
                          schema,
                          isCurrentSchema,
                          false,
                        );
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
                        isSchemaExpanded
                          ? `Collapse ${schema}`
                          : `Expand ${schema}`
                      }
                      aria-expanded={isSchemaExpanded}
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleSchemaToggle(
                          connection.id,
                          schema,
                          isCurrentSchema,
                        );
                      }}
                      onDoubleClick={(event) => event.stopPropagation()}
                    >
                      <span className="sr-only">
                        {isFlatKeyValueTree ? `db ${schema}` : schema}
                      </span>
                      {isSchemaExpanded ? (
                        <ChevronDown
                          size={12}
                          className="wb-tree-chevron shrink-0"
                        />
                      ) : (
                        <ChevronRight
                          size={12}
                          className="wb-tree-chevron shrink-0"
                        />
                      )}
                    </button>
                    {isFlatKeyValueTree ? (
                      <Database
                        size={12}
                        className="shrink-0"
                        style={{ color: connectionColor }}
                      />
                    ) : (
                      <Network
                        size={12}
                        className={cn(
                          "shrink-0",
                          explorerObjectIconClass("schema"),
                        )}
                      />
                    )}
                    <span className="truncate">
                      {isFlatKeyValueTree ? `db ${schema}` : schema}
                    </span>
                    {schema === connectionMetadata.defaultSchema && (
                      <span className="shrink-0 rounded-[3px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] px-1 text-[8px] font-medium text-[hsl(var(--wb-text-muted))]">
                        Default
                      </span>
                    )}
                    {isLoginSchema && (
                      <span className="shrink-0 text-[8px] uppercase tracking-wide text-[hsl(var(--wb-accent))] opacity-80">
                        User
                      </span>
                    )}
                    <MetadataNodeBadge state={schemaNodeState} />
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className={menuContentClass}>
                  <ExplorerSchemaMenu
                    connectedPostgresDatabase={connectedPostgresDatabase}
                    runForExplorerSchema={runForExplorerSchema}
                    connection={connection}
                    schema={schema}
                    createTableTab={createTableTab}
                    canBrowseTables={canBrowseTables}
                    connectionCapabilities={connectionCapabilities}
                    setViewDialogMode={setViewDialogMode}
                    setViewDialogKind={setViewDialogKind}
                    setViewDialogInitialName={setViewDialogInitialName}
                    setViewDialogInitialSql={setViewDialogInitialSql}
                    setIsCreateViewDialogOpen={setIsCreateViewDialogOpen}
                    copyText={copyText}
                    hideExplorerNodes={hideExplorerNodes}
                    explorerStateScope={explorerStateScope}
                    schemaVisibilityParentId={schemaVisibilityParentId}
                    schemaNodeIdsForAction={schemaNodeIdsForAction}
                    showOnlyExplorerNodes={showOnlyExplorerNodes}
                    schemaVisibilityFilter={schemaVisibilityFilter}
                    clearExplorerVisibilityFilter={
                      clearExplorerVisibilityFilter
                    }
                    openExplorerVisibilityFilter={openExplorerVisibilityFilter}
                    connectionMetadata={connectionMetadata}
                    setActiveConnection={setActiveConnection}
                    setNamespaceError={setNamespaceError}
                    openObjectBrowser={openObjectBrowser}
                    connectionCanBrowseDatabaseCatalogs={
                      connectionCanBrowseDatabaseCatalogs
                    }
                    createTab={createTab}
                    renderSqlHistorySubmenu={renderSqlHistorySubmenu}
                    handleRefreshSchema={handleRefreshSchema}
                    isLoading={isLoading}
                    isCollectionsLoading={isCollectionsLoading}
                    handleForgetSchemaMetadata={handleForgetSchemaMetadata}
                    schemaDiagramLoadingKey={schemaDiagramLoadingKey}
                    handleOpenSchemaDiagram={handleOpenSchemaDiagram}
                    activeProjectId={activeProjectId}
                    handleOpenDataTransfer={handleOpenDataTransfer}
                    handleOpenDataCompare={handleOpenDataCompare}
                    setSchemaSnapshotIdentity={setSchemaSnapshotIdentity}
                    handleImportSqlScript={handleImportSqlScript}
                    handleRenameDatabase={handleRenameDatabase}
                    handleDropDatabase={handleDropDatabase}
                  />
                </ContextMenuContent>
              </ExplorerSharedContextMenu>
              {isSchemaExpanded &&
                renderSchemaObjects(
                  connection.id,
                  connection.driver,
                  schema,
                  connectionColor,
                  connectionCapabilities,
                )}
            </div>
          );
        })
      )}
    </PostgresDatabaseTree>
  );
}
