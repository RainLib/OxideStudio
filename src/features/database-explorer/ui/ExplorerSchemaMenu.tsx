import type { useConnectionStore } from "@/store/useConnectionStore";
import type { useDatabaseExplorerStore } from "@/store/useDatabaseExplorerStore";
import type { useTabStore } from "@/store/useTabStore";
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
import {
  defaultDatabaseCapabilities,
  supportsTableWorkspace,
} from "@/lib/databaseDialect";
import { cn } from "@/lib/utils";
import { useSchemaStore } from "@/store/useSchemaStore";
import {
  ArrowRightLeft,
  Clipboard,
  Code2,
  Eye,
  EyeOff,
  GitCompareArrows,
  Network,
  Pin,
  Plus,
  RefreshCw,
  Search,
  SearchCode,
  TableProperties,
  Upload,
  X,
} from "lucide-react";

type ConnectionState = ReturnType<typeof useConnectionStore.getState>;

type DatabaseExplorerState = ReturnType<
  typeof useDatabaseExplorerStore.getState
>;

type TabState = ReturnType<typeof useTabStore.getState>;

interface ExplorerSchemaMenuContext {
  runForExplorerSchema: (
    connectionId: string,
    schema: string,
    action: () => void | Promise<void>,
  ) => Promise<void>;
  connection: import("@/store/useConnectionStore").ConnectionConfig;
  schema: string;
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
  copyText: (value: string) => Promise<void>;
  hideExplorerNodes: DatabaseExplorerState["hideNodes"];
  explorerStateScope: string;
  schemaVisibilityParentId: string;
  schemaNodeIdsForAction: string[];
  showOnlyExplorerNodes: DatabaseExplorerState["showOnlyNodes"];

  schemaVisibilityFilter:
    | import("@/features/database-explorer/model/explorerVisibilityFilter").ExplorerVisibilityFilter
    | undefined;
  clearExplorerVisibilityFilter: DatabaseExplorerState["clearVisibilityFilter"];
  openExplorerVisibilityFilter: (parentNodeId: string, label: string) => void;
  connectionMetadata: {
    isActiveConnection: boolean;
    schemas: string[];
    currentSchema: string | null;
    defaultSchema: string | null;
    selectedTable: string | null;
    isLoading: boolean;
    nodeState: import("@/store/useSchemaStore").MetadataNodeState | undefined;
  };
  setActiveConnection: ConnectionState["setActiveConnection"];
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  openObjectBrowser: TabState["openObjectBrowser"];
  connectionCanBrowseDatabaseCatalogs: boolean;
  connectedPostgresDatabase: string;
  createTab: TabState["createTab"];
  renderSqlHistorySubmenu: (scope: {
    connectionId: string;
    databaseName?: string | null | undefined;
    schemaName?: string | null | undefined;
  }) => React.ReactNode;
  handleRefreshSchema: (connectionId: string, schema: string) => Promise<void>;
  isLoading: boolean;
  isCollectionsLoading: boolean;
  handleForgetSchemaMetadata: (
    connectionId: string,
    driver: string | null | undefined,
    schema: string,
  ) => Promise<void>;
  schemaDiagramLoadingKey: string | null;
  handleOpenSchemaDiagram: (
    identity: import("@/services/schemaSnapshotStore").SchemaSnapshotIdentity,
    selectedRelations?: readonly string[],
  ) => Promise<void>;
  activeProjectId: string;
  handleOpenDataTransfer: (options: {
    connection: import("@/store/useConnectionStore").ConnectionConfig;
    database?: string | undefined;
    schema?: string | undefined;
    table?: string | undefined;
    tables?: string[] | undefined;
    scope: "database" | "schema" | "table";
  }) => Promise<void>;
  handleOpenDataCompare: (options: {
    connection: import("@/store/useConnectionStore").ConnectionConfig;
    database?: string | undefined;
    schema?: string | undefined;
    table?: string | undefined;
    tables?: string[] | undefined;
  }) => Promise<void>;
  setSchemaSnapshotIdentity: React.Dispatch<
    React.SetStateAction<
      import("@/services/schemaSnapshotStore").SchemaSnapshotIdentity | null
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
  handleRenameDatabase: (
    schemaOverride?: string | undefined,
    connectionIdOverride?: string,
    driverOverride?: import("@/services/tauri/types").DatabaseDriver,
  ) => Promise<void>;
  handleDropDatabase: (
    schemaOverride?: string | undefined,
    connectionIdOverride?: string,
    driverOverride?: import("@/services/tauri/types").DatabaseDriver,
  ) => Promise<void>;
}

export function ExplorerSchemaMenu({
  runForExplorerSchema,
  connection,
  schema,
  createTableTab,
  canBrowseTables,
  connectionCapabilities,
  setViewDialogMode,
  setViewDialogKind,
  setViewDialogInitialName,
  setViewDialogInitialSql,
  setIsCreateViewDialogOpen,
  copyText,
  hideExplorerNodes,
  explorerStateScope,
  schemaVisibilityParentId,
  schemaNodeIdsForAction,
  showOnlyExplorerNodes,

  schemaVisibilityFilter,
  clearExplorerVisibilityFilter,
  openExplorerVisibilityFilter,
  connectionMetadata,
  setActiveConnection,
  setNamespaceError,
  openObjectBrowser,
  connectionCanBrowseDatabaseCatalogs,
  connectedPostgresDatabase,
  createTab,
  renderSqlHistorySubmenu,
  handleRefreshSchema,
  isLoading,
  isCollectionsLoading,
  handleForgetSchemaMetadata,
  schemaDiagramLoadingKey,
  handleOpenSchemaDiagram,
  activeProjectId,
  handleOpenDataTransfer,
  handleOpenDataCompare,
  setSchemaSnapshotIdentity,
  handleImportSqlScript,
  handleRenameDatabase,
  handleDropDatabase,
}: ExplorerSchemaMenuContext) {
  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger className={menuSubClass}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          New
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={menuContentClass}>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              void runForExplorerSchema(connection.id, schema, () => {
                createTableTab(connection.id, schema);
              })
            }
            disabled={
              !canBrowseTables || !connectionCapabilities.supportsTableDdl
            }
          >
            Table
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              void runForExplorerSchema(connection.id, schema, () => {
                setViewDialogMode("create");
                setViewDialogKind("view");
                setViewDialogInitialName("");
                setViewDialogInitialSql("");
                setIsCreateViewDialogOpen(true);
              })
            }
            disabled={!connectionCapabilities.supportsViews}
          >
            View
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem
        className={menuItemClass}
        onClick={() => void copyText(schema)}
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
                schemaVisibilityParentId,
                schemaNodeIdsForAction,
              )
            }
          >
            <EyeOff className="mr-2 h-3.5 w-3.5" />
            Hide selected schema
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              showOnlyExplorerNodes(
                explorerStateScope,
                schemaVisibilityParentId,
                schemaNodeIdsForAction,
              )
            }
          >
            <Eye className="mr-2 h-3.5 w-3.5" />
            Show only selected schema
          </ContextMenuItem>
          <ContextMenuSeparator className={menuSeparatorClass} />
          <ContextMenuItem
            className={menuItemClass}
            disabled={!schemaVisibilityFilter}
            onClick={() =>
              clearExplorerVisibilityFilter(
                explorerStateScope,
                schemaVisibilityParentId,
              )
            }
          >
            <X className="mr-2 h-3.5 w-3.5" />
            Clear schema filter
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              openExplorerVisibilityFilter(
                schemaVisibilityParentId,
                `Schemas in ${connection.name}`,
              )
            }
          >
            <SearchCode className="mr-2 h-3.5 w-3.5" />
            Configure filter…
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {schema !== connectionMetadata.defaultSchema && (
        <ContextMenuItem
          className={menuItemClass}
          onClick={() => {
            void setActiveConnection(connection.id).then((error) => {
              if (error) {
                setNamespaceError(error);
                return;
              }
              void useSchemaStore.getState().setDefaultSchema(schema);
            });
          }}
        >
          <Pin className="mr-2 h-3.5 w-3.5" />
          Set as Default
        </ContextMenuItem>
      )}
      <ContextMenuSeparator className={menuSeparatorClass} />
      <ContextMenuItem
        className={menuItemClass}
        disabled={!canBrowseTables}
        onClick={() =>
          openObjectBrowser(
            connection.id,
            connection.name,
            connectionCanBrowseDatabaseCatalogs
              ? connectedPostgresDatabase
              : undefined,
            schema,
          )
        }
      >
        <TableProperties className="mr-2 h-3.5 w-3.5" />
        Browse Objects
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          createTab("query", `console [${schema}]`, "", {
            connectionId: connection.id,
            databaseName: connectionCanBrowseDatabaseCatalogs
              ? connectedPostgresDatabase
              : undefined,
            schemaName: schema,
            targetSchema: schema,
          })
        }
      >
        <Code2 className="mr-2 h-3.5 w-3.5" />
        New Query Console
      </ContextMenuItem>
      {renderSqlHistorySubmenu({
        connectionId: connection.id,
        databaseName: connectionCanBrowseDatabaseCatalogs
          ? connectedPostgresDatabase
          : undefined,
        schemaName: schema,
      })}
      <ContextMenuItem
        className={menuItemClass}
        onClick={() => void handleRefreshSchema(connection.id, schema)}
        disabled={isLoading || isCollectionsLoading}
      >
        <RefreshCw className="mr-2 h-3.5 w-3.5" />
        Refresh Selected
        <ContextMenuShortcut>⌘R</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          void handleForgetSchemaMetadata(
            connection.id,
            connection.driver,
            schema,
          )
        }
      >
        Forget Cached Metadata
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        disabled={
          Boolean(schemaDiagramLoadingKey) ||
          !(
            supportsTableWorkspace(
              defaultDatabaseCapabilities(connection.driver),
            ) ||
            defaultDatabaseCapabilities(connection.driver)
              .supportsCollectionBrowsing
          )
        }
        onClick={() =>
          void handleOpenSchemaDiagram({
            projectId: activeProjectId,
            connectionId: connection.id,
            connectionName: connection.name,
            driver: connection.driver,
            databaseName: connectionCanBrowseDatabaseCatalogs
              ? connectedPostgresDatabase
              : undefined,
            schemaName: schema,
          })
        }
      >
        <Network className="mr-2 h-3.5 w-3.5" />
        Open Schema Diagram
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        disabled={
          !defaultDatabaseCapabilities(connection.driver).supportsSqlQuery ||
          !defaultDatabaseCapabilities(connection.driver).supportsTableBrowsing
        }
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent(APP_EVENT_OPEN_DATABASE_SEARCH, {
              detail: {
                connectionId: connection.id,
                database: connectionCanBrowseDatabaseCatalogs
                  ? connectedPostgresDatabase
                  : undefined,
                schema,
              },
            }),
          )
        }
      >
        <Search className="mr-2 h-3.5 w-3.5" />
        Search Schema Rows...
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          void handleOpenDataTransfer({
            connection,
            database: connectionCanBrowseDatabaseCatalogs
              ? connectedPostgresDatabase
              : undefined,
            schema,
            scope: "schema",
          })
        }
      >
        <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
        Transfer Schema Data...
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          void handleOpenDataCompare({
            connection,
            database: connectionCanBrowseDatabaseCatalogs
              ? connectedPostgresDatabase
              : undefined,
            schema,
          })
        }
      >
        <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
        Compare Schema Data...
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        disabled={
          !(
            supportsTableWorkspace(
              defaultDatabaseCapabilities(connection.driver),
            ) ||
            defaultDatabaseCapabilities(connection.driver)
              .supportsCollectionBrowsing
          )
        }
        onClick={() => {
          void setActiveConnection(connection.id).then((connectionError) => {
            if (connectionError) {
              setNamespaceError(connectionError);
              return;
            }
            setSchemaSnapshotIdentity({
              projectId: activeProjectId,
              connectionId: connection.id,
              connectionName: connection.name,
              driver: connection.driver,
              databaseName: connectionCanBrowseDatabaseCatalogs
                ? connectedPostgresDatabase
                : undefined,
              schemaName: schema,
            });
          });
        }}
      >
        <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
        {supportsTableWorkspace(defaultDatabaseCapabilities(connection.driver))
          ? "Schema Snapshots / Diff..."
          : "Metadata Snapshots..."}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger
          className={menuSubClass}
          disabled={
            !defaultDatabaseCapabilities(connection.driver).supportsSqlQuery
          }
        >
          Import/Export
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={menuContentClass}>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              void handleImportSqlScript({
                connectionId: connection.id,
                schema,
                database:
                  connection.driver === "postgres"
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
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          void handleRenameDatabase(schema, connection.id, connection.driver)
        }
        disabled={!connectionCapabilities.supportsRenameDatabase}
      >
        Rename...
        <ContextMenuShortcut>⇧F6</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator className={menuSeparatorClass} />
      <ContextMenuItem
        className={cn(menuItemClass, "text-destructive")}
        onClick={() =>
          void handleDropDatabase(schema, connection.id, connection.driver)
        }
        disabled={!connectionCapabilities.supportsCreateDatabase}
      >
        Drop...
      </ContextMenuItem>
    </>
  );
}
