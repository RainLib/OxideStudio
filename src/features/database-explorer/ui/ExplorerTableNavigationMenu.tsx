import type { useDatabaseExplorerStore } from "@/store/useDatabaseExplorerStore";
import type { useConnectionStore } from "@/store/useConnectionStore";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  EXPLORER_MENU_CONTENT_CLASS as menuContentClass,
  EXPLORER_MENU_ITEM_CLASS as menuItemClass,
  EXPLORER_MENU_SEPARATOR_CLASS as menuSeparatorClass,
  EXPLORER_SIDEBAR_MENU_SUB_CLASS as menuSubClass,
} from "@/features/database-explorer/ui/explorerStyles";
import { APP_EVENT_OPEN_DATABASE_SEARCH } from "@/lib/actionEvents";
import { supportsTableWorkspace } from "@/lib/databaseDialect";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import { useTabStore } from "@/store/useTabStore";
import {
  Code2,
  Eye,
  EyeOff,
  GitCompareArrows,
  RefreshCw,
  Search,
  SearchCode,
  Sparkles,
  TableProperties,
  X,
} from "lucide-react";

type DatabaseExplorerState = ReturnType<
  typeof useDatabaseExplorerStore.getState
>;

type ConnectionState = ReturnType<typeof useConnectionStore.getState>;
type TabState = ReturnType<typeof useTabStore.getState>;

interface ExplorerTableNavigationMenuContext {
  relationCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  handleTableDoubleClick: (
    table: import("@/services/tauri/types").TableInfo,
    schemaName?: string,
    targetConnectionId?: string,
    databaseName?: string | undefined,
  ) => Promise<void>;
  table: import("@/services/tauri/types").TableInfo;
  schema: string;
  connectionId: string;
  navigationDatabaseName: string | undefined;
  runForSchema: (
    targetSchema: string,
    action: () => void | Promise<void>,
  ) => Promise<void>;
  findOrCreateTableTab: TabState["findOrCreateTableTab"];
  loadTablePage: TabState["loadTablePage"];
  openGeneratedSql: (
    operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE",
  ) => void;
  renderSqlHistorySubmenu: (scope: {
    connectionId: string;
    databaseName?: string | null | undefined;
    schemaName?: string | null | undefined;
  }) => React.ReactNode;

  objectConnection:
    | import("@/store/useConnectionStore").ConnectionConfig
    | undefined;
  setActiveConnection: ConnectionState["setActiveConnection"];
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  setSchemaSnapshotIdentity: React.Dispatch<
    React.SetStateAction<
      import("@/services/schemaSnapshotStore").SchemaSnapshotIdentity | null
    >
  >;
  activeProjectId: string;
  addTablesToAssistant: (tableNames: readonly string[]) => Promise<void>;
  contextualTableNames: string[];

  copyText: (value: string) => Promise<void>;
  handleCopyTableDdl: (
    table: import("@/services/tauri/types").TableInfo,
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;
  relationOperationTarget: import("@/hooks/useTableOperations").TableOperationTarget;
  hideExplorerNodes: DatabaseExplorerState["hideNodes"];
  explorerStateScope: string;
  objectVisibilityParentId: string;
  relationNodeIdsForAction: string[];
  showOnlyExplorerNodes: DatabaseExplorerState["showOnlyNodes"];
  objectVisibilityFilter:
    | import("@/features/database-explorer/model/explorerVisibilityFilter").ExplorerVisibilityFilter
    | undefined;
  clearExplorerVisibilityFilter: DatabaseExplorerState["clearVisibilityFilter"];
  openExplorerVisibilityFilter: (parentNodeId: string, label: string) => void;
  activeConnectionId: ConnectionState["activeConnectionId"];
  canBrowseTables: boolean;
  loadTables: (
    connectionId: string,
    schema: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  activeCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  loadFunctions: (
    connectionId: string,
    schema: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  canBrowseCollections: boolean;
  loadCollections: (
    connectionId: string,
    namespace: string,
    force?: boolean | undefined,
    filter?: string | undefined,
    revalidateCached?: boolean | undefined,
  ) => Promise<void>;
  activeDriver: import("@/services/tauri/types").DatabaseDriver;
  setTableMetadata: TabState["setTableMetadata"];
  isLoading: boolean;
  handleRenameClick: (
    table: import("@/services/tauri/types").TableInfo,
  ) => void;
}

export function ExplorerTableNavigationMenu({
  relationCapabilities,
  handleTableDoubleClick,
  table,
  schema,
  connectionId,
  navigationDatabaseName,
  runForSchema,
  findOrCreateTableTab,
  loadTablePage,
  openGeneratedSql,
  renderSqlHistorySubmenu,

  objectConnection,
  setActiveConnection,
  setNamespaceError,
  setSchemaSnapshotIdentity,
  activeProjectId,
  addTablesToAssistant,
  contextualTableNames,

  copyText,
  handleCopyTableDdl,
  relationOperationTarget,
  hideExplorerNodes,
  explorerStateScope,
  objectVisibilityParentId,
  relationNodeIdsForAction,
  showOnlyExplorerNodes,
  objectVisibilityFilter,
  clearExplorerVisibilityFilter,
  openExplorerVisibilityFilter,
  activeConnectionId,
  canBrowseTables,
  loadTables,
  activeCapabilities,
  loadFunctions,
  canBrowseCollections,
  loadCollections,
  activeDriver,
  setTableMetadata,
  isLoading,
  handleRenameClick,
}: ExplorerTableNavigationMenuContext) {
  return (
    <>
      <ContextMenuItem
        className={menuItemClass}
        disabled={!relationCapabilities.supportsTableBrowsing}
        onClick={() =>
          void handleTableDoubleClick(
            table,
            schema,
            connectionId,
            navigationDatabaseName,
          )
        }
      >
        <TableProperties className="mr-2 h-3.5 w-3.5" />
        Open Data
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        disabled={!relationCapabilities.supportsTableBrowsing}
        onClick={() =>
          void runForSchema(schema, async () => {
            const tabId = findOrCreateTableTab(
              connectionId,
              schema,
              table.name,
              table.type,
              navigationDatabaseName,
              { reuseMode: "always-new" },
            );
            await loadTablePage(tabId, 0);
          })
        }
      >
        Open Data in New Tab
      </ContextMenuItem>
      {relationCapabilities.supportsSqlQuery && (
        <ContextMenuItem
          className={menuItemClass}
          onClick={() => openGeneratedSql("SELECT")}
        >
          <Code2 className="mr-2 h-3.5 w-3.5" />
          Open in Query Console
        </ContextMenuItem>
      )}
      {relationCapabilities.supportsSqlQuery &&
        renderSqlHistorySubmenu({
          connectionId,
          databaseName: navigationDatabaseName,
          schemaName: schema,
        })}
      <ContextMenuSeparator className={menuSeparatorClass} />
      <ContextMenuItem
        className={menuItemClass}
        disabled={
          !relationCapabilities.supportsSqlQuery ||
          !relationCapabilities.supportsTableBrowsing
        }
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent(APP_EVENT_OPEN_DATABASE_SEARCH, {
              detail: {
                connectionId,
                database: navigationDatabaseName,
                schema,
                table: table.name,
              },
            }),
          )
        }
      >
        <Search className="mr-2 h-3.5 w-3.5" />
        Search Table Rows...
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        disabled={
          !objectConnection ||
          !(
            supportsTableWorkspace(relationCapabilities) ||
            relationCapabilities.supportsCollectionBrowsing
          )
        }
        onClick={() => {
          if (!objectConnection) return;
          void setActiveConnection(connectionId).then((connectionError) => {
            if (connectionError) {
              setNamespaceError(connectionError);
              return;
            }
            setSchemaSnapshotIdentity({
              projectId: activeProjectId,
              connectionId,
              connectionName: objectConnection.name,
              driver: objectConnection.driver,
              databaseName: navigationDatabaseName,
              schemaName: schema,
              tableName: table.name,
            });
          });
        }}
      >
        <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
        Schema Snapshots / Diff...
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        disabled={!objectConnection}
        onClick={() => void addTablesToAssistant(contextualTableNames)}
      >
        <Sparkles className="mr-2 h-3.5 w-3.5" />
        Add {contextualTableNames.length > 1 ? "tables" : "table"} to AI context
      </ContextMenuItem>
      <ContextMenuSeparator className={menuSeparatorClass} />
      <ContextMenuSub>
        <ContextMenuSubTrigger className={menuSubClass}>
          Copy/Paste
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={menuContentClass}>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() => void copyText(table.name)}
          >
            Copy Name
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              void runForSchema(schema, () =>
                handleCopyTableDdl(table, relationOperationTarget),
              )
            }
          >
            Copy DDL
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>

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
                objectVisibilityParentId,
                relationNodeIdsForAction,
              )
            }
          >
            <EyeOff className="mr-2 h-3.5 w-3.5" />
            Hide selected object
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              showOnlyExplorerNodes(
                explorerStateScope,
                objectVisibilityParentId,
                relationNodeIdsForAction,
              )
            }
          >
            <Eye className="mr-2 h-3.5 w-3.5" />
            Show only selected object
          </ContextMenuItem>
          <ContextMenuSeparator className={menuSeparatorClass} />
          <ContextMenuItem
            className={menuItemClass}
            disabled={!objectVisibilityFilter}
            onClick={() =>
              clearExplorerVisibilityFilter(
                explorerStateScope,
                objectVisibilityParentId,
              )
            }
          >
            <X className="mr-2 h-3.5 w-3.5" />
            Clear object filter
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              openExplorerVisibilityFilter(
                objectVisibilityParentId,
                `Objects in ${schema || "current namespace"}`,
              )
            }
          >
            <SearchCode className="mr-2 h-3.5 w-3.5" />
            Configure filter…
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          void runForSchema(schema, async () => {
            if (!activeConnectionId) return;
            if (canBrowseTables) {
              await loadTables(activeConnectionId, schema, true);
              if (activeCapabilities.supportsFunctions) {
                await loadFunctions(activeConnectionId, schema, true);
              }
            }
            if (canBrowseCollections) {
              await loadCollections(activeConnectionId, schema, true);
            }
            const metadata = await loadTableMetadata({
              connectionId: activeConnectionId,
              driver: activeDriver,
              schema,
              table: table.name,
              includeIndexes: activeCapabilities.supportsTableIndexes,
              includeConstraints: activeCapabilities.supportsTableConstraints,
              force: true,
            });
            for (const tab of useTabStore.getState().tabs) {
              if (
                tab.type === "table" &&
                tab.connectionId === activeConnectionId &&
                tab.schemaName === schema &&
                tab.tableName === table.name
              ) {
                setTableMetadata(tab.id, metadata);
              }
            }
          })
        }
        disabled={isLoading}
      >
        <RefreshCw className="mr-2 h-3.5 w-3.5" />
        Refresh
        <ContextMenuShortcut>⌘R</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        disabled={!relationCapabilities.supportsTableDdl}
        onClick={() =>
          void runForSchema(schema, () => handleRenameClick(table))
        }
      >
        Rename...
        <ContextMenuShortcut>⇧F6</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator className={menuSeparatorClass} />
    </>
  );
}
