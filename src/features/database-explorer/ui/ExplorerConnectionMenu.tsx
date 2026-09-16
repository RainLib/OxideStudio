import type { useDatabaseExplorerStore } from "@/store/useDatabaseExplorerStore";
import type { useTabStore } from "@/store/useTabStore";
import type { useConnectionStore } from "@/store/useConnectionStore";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { supportsDatabaseAdministration } from "@/features/database-explorer/model/explorerSidebarPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import {
  EXPLORER_MENU_CONTENT_CLASS as menuContentClass,
  EXPLORER_MENU_ITEM_CLASS as menuItemClass,
  EXPLORER_MENU_SEPARATOR_CLASS as menuSeparatorClass,
  EXPLORER_SIDEBAR_MENU_SUB_CLASS as menuSubClass,
} from "@/features/database-explorer/ui/explorerStyles";
import { APP_EVENT_OPEN_DATABASE_SEARCH } from "@/lib/actionEvents";
import { normalizeDatabaseDriverName } from "@/lib/databaseDialect";
import { cn } from "@/lib/utils";
import {
  ArchiveRestore,
  Clipboard,
  Code2,
  CopyPlus,
  Database,
  Download,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  Network,
  Plus,
  RefreshCw,
  Search,
  SearchCode,
  Trash2,
  Upload,
  X,
} from "lucide-react";

type DatabaseExplorerState = ReturnType<
  typeof useDatabaseExplorerStore.getState
>;

type TabState = ReturnType<typeof useTabStore.getState>;

type ConnectionState = ReturnType<typeof useConnectionStore.getState>;

interface ExplorerConnectionMenuContext {
  isConnecting: boolean;
  connectedConnectionIds: ConnectionState["connectedConnectionIds"];
  connection: import("@/store/useConnectionStore").ConnectionConfig;
  setActiveConnection: ConnectionState["setActiveConnection"];
  disconnect: ConnectionState["disconnect"];
  handleConnectionSelect: (
    connectionId: string,
    event?:
      | {
          currentTarget: HTMLElement;
          ctrlKey: boolean;
          metaKey: boolean;
          shiftKey: boolean;
        }
      | undefined,
  ) => Promise<void>;
  connectionCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  createTab: TabState["createTab"];
  connectionMetadata: {
    isActiveConnection: boolean;
    schemas: string[];
    currentSchema: string | null;
    defaultSchema: string | null;
    selectedTable: string | null;
    isLoading: boolean;
    nodeState: import("@/store/useSchemaStore").MetadataNodeState | undefined;
  };
  renderSqlHistorySubmenu: (scope: {
    connectionId: string;
    databaseName?: string | null | undefined;
    schemaName?: string | null | undefined;
  }) => React.ReactNode;

  isManagedConnection: boolean;
  isActive: boolean;
  currentSchema: string | null;
  canBrowseTables: boolean;
  isFlatKeyValueTree: boolean;

  setIsCreateDbDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  namespaceLabel: string;
  handleCreateTable: () => void;
  setIsCreateRedisKeyOpen: React.Dispatch<React.SetStateAction<boolean>>;
  copyText: (value: string) => Promise<void>;
  hideExplorerNodes: DatabaseExplorerState["hideNodes"];
  explorerStateScope: string;
  explorerConnectionFilterParentId: string;
  connectionIdsForExplorerAction: (connectionId: string) => string[];
  showOnlyExplorerNodes: DatabaseExplorerState["showOnlyNodes"];
  explorerConnectionVisibilityFilter:
    | import("@/features/database-explorer/model/explorerVisibilityFilter").ExplorerVisibilityFilter
    | undefined;
  clearExplorerVisibilityFilter: DatabaseExplorerState["clearVisibilityFilter"];
  openExplorerVisibilityFilter: (parentNodeId: string, label: string) => void;
  connectionCanBrowseDatabaseCatalogs: boolean;
  connectedPostgresDatabase: string;
  openDatabaseBrowser: TabState["openDatabaseBrowser"];
  openRocketMqWorkspace: TabState["openRocketMqWorkspace"];
  handleRefreshConnection: (connectionId: string) => Promise<void>;
  isLoading: boolean;
  handleForgetConnectionMetadata: (
    connectionId: string,
    connectionName: string,
  ) => Promise<void>;
  handleOpenConnectionProperties: (connectionId: string) => void;
  handleDuplicateConnection: (
    connection: import("@/store/useConnectionStore").ConnectionConfig,
  ) => void;
  explorerConnectionGroups: import("@/store/useDatabaseExplorerStore").ExplorerConnectionGroup[];
  assignedGroupId: string | undefined;
  moveExplorerConnectionsToGroup: DatabaseExplorerState["moveConnectionsToGroup"];
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setConnectionGroupDraft: React.Dispatch<
    React.SetStateAction<{
      mode: "create" | "rename";
      groupId?: string | undefined;
      name: string;
    } | null>
  >;
  setDatabaseAdministrationConnectionId: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  setSqliteBackupTarget: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-admin/ui/SqliteBackupDialog").SqliteBackupTarget
      | null
    >
  >;
  handleImportSqlScript: ({
    connectionId,
    schema,
    database,
  }: {
    connectionId: string;
    schema?: string | undefined;
    database?: string | undefined;
  }) => void;
  setDataSourceRemovalError: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  setPendingDataSourceRemoval: React.Dispatch<
    React.SetStateAction<{ id: string; name: string } | null>
  >;
}

export function ExplorerConnectionMenu({
  isConnecting,
  connectedConnectionIds,
  connection,
  setActiveConnection,
  disconnect,
  handleConnectionSelect,
  connectionCapabilities,
  setNamespaceError,
  createTab,
  connectionMetadata,
  renderSqlHistorySubmenu,

  isManagedConnection,
  isActive,
  currentSchema,
  canBrowseTables,
  isFlatKeyValueTree,

  setIsCreateDbDialogOpen,
  namespaceLabel,
  handleCreateTable,
  setIsCreateRedisKeyOpen,
  copyText,
  hideExplorerNodes,
  explorerStateScope,
  explorerConnectionFilterParentId,
  connectionIdsForExplorerAction,
  showOnlyExplorerNodes,
  explorerConnectionVisibilityFilter,
  clearExplorerVisibilityFilter,
  openExplorerVisibilityFilter,
  connectionCanBrowseDatabaseCatalogs,
  connectedPostgresDatabase,
  openDatabaseBrowser,
  openRocketMqWorkspace,
  handleRefreshConnection,
  isLoading,
  handleForgetConnectionMetadata,
  handleOpenConnectionProperties,
  handleDuplicateConnection,
  explorerConnectionGroups,
  assignedGroupId,
  moveExplorerConnectionsToGroup,
  setExpandedObjectGroupKeys,
  setConnectionGroupDraft,
  setDatabaseAdministrationConnectionId,
  setSqliteBackupTarget,
  handleImportSqlScript,
  setDataSourceRemovalError,
  setPendingDataSourceRemoval,
}: ExplorerConnectionMenuContext) {
  return (
    <>
      <ContextMenuItem
        className={menuItemClass}
        disabled={isConnecting}
        onClick={() => {
          if (connectedConnectionIds.includes(connection.id)) {
            void setActiveConnection(connection.id).then((error) => {
              if (!error) void disconnect();
            });
            return;
          }
          void handleConnectionSelect(connection.id);
        }}
      >
        <Database className="mr-2 h-3.5 w-3.5" />
        {connectedConnectionIds.includes(connection.id)
          ? "Disconnect"
          : "Connect"}
      </ContextMenuItem>
      {connectionCapabilities.supportsSqlQuery && (
        <ContextMenuItem
          className={menuItemClass}
          onClick={() => {
            void setActiveConnection(connection.id).then((error) => {
              if (error) {
                setNamespaceError(error);
                return;
              }
              createTab("query", `console [${connection.name}]`, "", {
                connectionId: connection.id,
                schemaName:
                  connectionMetadata.currentSchema ||
                  connectionMetadata.defaultSchema ||
                  undefined,
              });
            });
          }}
        >
          <Code2 className="mr-2 h-3.5 w-3.5" />
          New Query Console
        </ContextMenuItem>
      )}
      {connectionCapabilities.supportsSqlQuery &&
        renderSqlHistorySubmenu({
          connectionId: connection.id,
        })}
      <ContextMenuSeparator className={menuSeparatorClass} />
      {!isManagedConnection &&
        (connectionCapabilities.supportsCreateDatabase ||
          (isActive &&
            Boolean(currentSchema) &&
            canBrowseTables &&
            connectionCapabilities.supportsTableDdl) ||
          (isFlatKeyValueTree && connection.driver === "redis")) && (
          <ContextMenuSub>
            <ContextMenuSubTrigger className={menuSubClass}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              New
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className={menuContentClass}>
              {connectionCapabilities.supportsCreateDatabase && (
                <ContextMenuItem
                  className={menuItemClass}
                  onClick={() =>
                    void setActiveConnection(connection.id).then((error) => {
                      if (error) {
                        setNamespaceError(error);
                        return;
                      }
                      setIsCreateDbDialogOpen(true);
                    })
                  }
                >
                  {namespaceLabel}
                </ContextMenuItem>
              )}
              {isActive &&
                currentSchema &&
                canBrowseTables &&
                connectionCapabilities.supportsTableDdl && (
                  <ContextMenuItem
                    className={menuItemClass}
                    onClick={handleCreateTable}
                  >
                    Table
                  </ContextMenuItem>
                )}
              {isFlatKeyValueTree && connection.driver === "redis" && (
                <ContextMenuItem
                  className={menuItemClass}
                  onClick={() => {
                    if (!isActive) {
                      void setActiveConnection(connection.id).then((error) => {
                        if (!error) setIsCreateRedisKeyOpen(true);
                      });
                      return;
                    }
                    setIsCreateRedisKeyOpen(true);
                  }}
                >
                  Key
                </ContextMenuItem>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
      <ContextMenuItem
        className={menuItemClass}
        onClick={() => void copyText(connection.name)}
      >
        <Clipboard className="mr-2 h-3.5 w-3.5" />
        Copy Name
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger className={menuSubClass}>
          <EyeOff className="mr-2 h-3.5 w-3.5" />
          Filter
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={menuContentClass}>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              hideExplorerNodes(
                explorerStateScope,
                explorerConnectionFilterParentId,
                connectionIdsForExplorerAction(connection.id).map(
                  (connectionId) => explorerNodeId("connection", connectionId),
                ),
              )
            }
          >
            <EyeOff className="mr-2 h-3.5 w-3.5" />
            Hide selected data source
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              showOnlyExplorerNodes(
                explorerStateScope,
                explorerConnectionFilterParentId,
                connectionIdsForExplorerAction(connection.id).map(
                  (connectionId) => explorerNodeId("connection", connectionId),
                ),
              )
            }
          >
            <Eye className="mr-2 h-3.5 w-3.5" />
            Show only selected data source
          </ContextMenuItem>
          <ContextMenuSeparator className={menuSeparatorClass} />
          <ContextMenuItem
            className={menuItemClass}
            disabled={!explorerConnectionVisibilityFilter}
            onClick={() =>
              clearExplorerVisibilityFilter(
                explorerStateScope,
                explorerConnectionFilterParentId,
              )
            }
          >
            <X className="mr-2 h-3.5 w-3.5" />
            Clear data source filter
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              openExplorerVisibilityFilter(
                explorerConnectionFilterParentId,
                "Data sources",
              )
            }
          >
            <SearchCode className="mr-2 h-3.5 w-3.5" />
            Configure filter…
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {connectionCapabilities.supportsSqlQuery &&
        connectionCapabilities.supportsTableBrowsing && (
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent(APP_EVENT_OPEN_DATABASE_SEARCH, {
                  detail: {
                    connectionId: connection.id,
                    database: connectionCanBrowseDatabaseCatalogs
                      ? connectedPostgresDatabase
                      : undefined,
                  },
                }),
              )
            }
          >
            <Search className="mr-2 h-3.5 w-3.5" />
            Search Current Database...
          </ContextMenuItem>
        )}
      {connectionCapabilities.supportsTableBrowsing &&
        connectionCapabilities.dataModel === "relational" && (
          <ContextMenuItem
            className={menuItemClass}
            onClick={() => openDatabaseBrowser(connection.id, connection.name)}
          >
            <Database className="mr-2 h-3.5 w-3.5" />
            Browse Databases
          </ContextMenuItem>
        )}
      {normalizeDatabaseDriverName(connection.driver) === "rocketmq" && (
        <ContextMenuItem
          className={menuItemClass}
          onClick={() => openRocketMqWorkspace(connection.id, connection.name)}
        >
          <Network className="mr-2 h-3.5 w-3.5" />
          Open RocketMQ Console
        </ContextMenuItem>
      )}
      <ContextMenuSeparator className={menuSeparatorClass} />
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          void (async () => {
            await handleRefreshConnection(connection.id);
          })()
        }
        disabled={isLoading}
      >
        <RefreshCw className="mr-2 h-3.5 w-3.5" />
        Refresh Selected
        <ContextMenuShortcut>⌘R</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          void handleForgetConnectionMetadata(connection.id, connection.name)
        }
      >
        Forget Cached Metadata
      </ContextMenuItem>
      {!isManagedConnection && (
        <ContextMenuItem
          className={menuItemClass}
          onClick={() => handleOpenConnectionProperties(connection.id)}
        >
          Properties...
        </ContextMenuItem>
      )}
      {!isManagedConnection && (
        <ContextMenuItem
          className={menuItemClass}
          onClick={() => handleDuplicateConnection(connection)}
        >
          <CopyPlus className="mr-2 h-3.5 w-3.5" />
          Duplicate Data Source...
        </ContextMenuItem>
      )}
      {!isManagedConnection && (
        <ContextMenuSub>
          <ContextMenuSubTrigger className={menuSubClass}>
            <FolderOpen className="mr-2 h-3.5 w-3.5" />
            Move to Group
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className={menuContentClass}>
            {explorerConnectionGroups.map((group) => (
              <ContextMenuItem
                key={group.id}
                className={menuItemClass}
                disabled={assignedGroupId === group.id}
                onClick={() => {
                  moveExplorerConnectionsToGroup(
                    explorerStateScope,
                    connectionIdsForExplorerAction(connection.id),
                    group.id,
                  );
                  setExpandedObjectGroupKeys((current) =>
                    current.includes(group.id)
                      ? current
                      : [...current, group.id],
                  );
                }}
              >
                <Folder className="mr-2 h-3.5 w-3.5 text-amber-400/85" />
                {group.name}
              </ContextMenuItem>
            ))}
            {explorerConnectionGroups.length > 0 && (
              <ContextMenuSeparator className={menuSeparatorClass} />
            )}
            {assignedGroupId && (
              <ContextMenuItem
                className={menuItemClass}
                onClick={() =>
                  moveExplorerConnectionsToGroup(
                    explorerStateScope,
                    connectionIdsForExplorerAction(connection.id),
                    null,
                  )
                }
              >
                Ungrouped
              </ContextMenuItem>
            )}
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                setConnectionGroupDraft({
                  mode: "create",
                  name: "",
                })
              }
            >
              <FolderPlus className="mr-2 h-3.5 w-3.5" />
              New Group…
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      {!isManagedConnection &&
        supportsDatabaseAdministration(connection.driver) && (
          <ContextMenuItem
            className={menuItemClass}
            onClick={() => {
              setDatabaseAdministrationConnectionId(connection.id);
            }}
          >
            Database Administration...
          </ContextMenuItem>
        )}
      {!isManagedConnection && connectionCapabilities.supportsSqlQuery && (
        <ContextMenuSub>
          <ContextMenuSubTrigger className={menuSubClass}>
            Import/Export
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className={menuContentClass}>
            {normalizeDatabaseDriverName(connection.driver) === "sqlite" && (
              <>
                <ContextMenuItem
                  className={menuItemClass}
                  disabled={!isActive || isManagedConnection}
                  onClick={() =>
                    setSqliteBackupTarget({
                      connectionId: connection.id,
                      connectionName: connection.name,
                      initialOperation: "backup",
                    })
                  }
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Back up SQLite database...
                </ContextMenuItem>
                <ContextMenuItem
                  className={menuItemClass}
                  disabled={!isActive || isManagedConnection}
                  onClick={() =>
                    setSqliteBackupTarget({
                      connectionId: connection.id,
                      connectionName: connection.name,
                      initialOperation: "restore",
                    })
                  }
                >
                  <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
                  Restore SQLite database...
                </ContextMenuItem>
                <ContextMenuSeparator className={menuSeparatorClass} />
              </>
            )}
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void handleImportSqlScript({
                  connectionId: connection.id,
                  database: connectionCanBrowseDatabaseCatalogs
                    ? connectedPostgresDatabase
                    : undefined,
                })
              }
            >
              <Upload className="mr-2 h-3.5 w-3.5" />
              Import SQL Script...
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      {!isManagedConnection && (
        <>
          <ContextMenuSeparator className={menuSeparatorClass} />
          <ContextMenuItem
            className={cn(menuItemClass, "text-destructive")}
            onSelect={() => {
              setDataSourceRemovalError(null);
              setPendingDataSourceRemoval({
                id: connection.id,
                name: connection.name,
              });
            }}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Remove Data Source...
          </ContextMenuItem>
        </>
      )}
    </>
  );
}
