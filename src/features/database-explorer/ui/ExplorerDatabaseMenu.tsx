import type { useTabStore } from "@/store/useTabStore";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  EXPLORER_MENU_ITEM_CLASS as menuItemClass,
  EXPLORER_MENU_SEPARATOR_CLASS as menuSeparatorClass,
} from "@/features/database-explorer/ui/explorerStyles";
import { APP_EVENT_OPEN_DATABASE_SEARCH } from "@/lib/actionEvents";
import {
  ArrowRightLeft,
  Clipboard,
  Code2,
  GitCompareArrows,
  RefreshCw,
  Search,
  TableProperties,
  Upload,
} from "lucide-react";

type TabState = ReturnType<typeof useTabStore.getState>;

interface ExplorerDatabaseMenuContext {
  copyText: (value: string) => Promise<void>;
  database: string;

  openObjectBrowser: TabState["openObjectBrowser"];
  connection: import("@/store/useConnectionStore").ConnectionConfig;
  createTab: TabState["createTab"];
  renderSqlHistorySubmenu: (scope: {
    connectionId: string;
    databaseName?: string | null | undefined;
    schemaName?: string | null | undefined;
  }) => React.ReactNode;
  handleImportSqlScript: ({
    connectionId,
    schema,
    database,
  }: {
    connectionId: string;
    schema?: string | undefined;
    database?: string | undefined;
  }) => void;
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
  databaseSchemas: string[];
  setSchemaSnapshotIdentity: React.Dispatch<
    React.SetStateAction<
      import("@/services/schemaSnapshotStore").SchemaSnapshotIdentity | null
    >
  >;
  activeProjectId: string;
  loadPostgresRemoteDatabase: (
    connectionId: string,
    database: string,
  ) => Promise<void>;
  connectedPostgresDatabase: string;
  handleRefreshConnection: (connectionId: string) => Promise<void>;
}

export function ExplorerDatabaseMenu({
  copyText,
  database,

  openObjectBrowser,
  connection,
  createTab,
  renderSqlHistorySubmenu,
  handleImportSqlScript,
  handleOpenDataTransfer,
  handleOpenDataCompare,
  databaseSchemas,
  setSchemaSnapshotIdentity,
  activeProjectId,
  loadPostgresRemoteDatabase,
  connectedPostgresDatabase,
  handleRefreshConnection,
}: ExplorerDatabaseMenuContext) {
  return (
    <>
      <ContextMenuItem
        className={menuItemClass}
        onClick={() => void copyText(database)}
      >
        <Clipboard className="mr-2 h-3.5 w-3.5" />
        Copy Name
      </ContextMenuItem>
      <ContextMenuSeparator className={menuSeparatorClass} />
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          openObjectBrowser(connection.id, connection.name, database)
        }
      >
        <TableProperties className="mr-2 h-3.5 w-3.5" />
        Open Object Browser
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          createTab("query", `console [${database}]`, "", {
            connectionId: connection.id,
            databaseName: database,
          })
        }
      >
        <Code2 className="mr-2 h-3.5 w-3.5" />
        New Query Console
      </ContextMenuItem>
      {renderSqlHistorySubmenu({
        connectionId: connection.id,
        databaseName: database,
      })}
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent(APP_EVENT_OPEN_DATABASE_SEARCH, {
              detail: {
                connectionId: connection.id,
                database,
              },
            }),
          )
        }
      >
        <Search className="mr-2 h-3.5 w-3.5" />
        Search Database Rows...
      </ContextMenuItem>
      <ContextMenuSeparator className={menuSeparatorClass} />
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          void handleImportSqlScript({
            connectionId: connection.id,
            database,
          })
        }
      >
        <Upload className="mr-2 h-3.5 w-3.5" />
        Import SQL Script...
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          void handleOpenDataTransfer({
            connection,
            database,
            scope: "database",
          })
        }
      >
        <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
        Transfer Database Data...
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          void handleOpenDataCompare({
            connection,
            database,
          })
        }
      >
        <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
        Compare Database Tables...
      </ContextMenuItem>
      {databaseSchemas.length > 0 ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger className={menuItemClass}>
            <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
            Schema Snapshots / Diff
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[190px]">
            {databaseSchemas.map((schema) => (
              <ContextMenuItem
                key={schema}
                className={menuItemClass}
                onClick={() => {
                  setSchemaSnapshotIdentity({
                    projectId: activeProjectId,
                    connectionId: connection.id,
                    connectionName: connection.name,
                    driver: connection.driver,
                    databaseName: database,
                    schemaName: schema,
                  });
                }}
              >
                {schema}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : (
        <ContextMenuItem
          className={menuItemClass}
          onClick={() =>
            void loadPostgresRemoteDatabase(connection.id, database)
          }
        >
          <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
          Load schemas for migration...
        </ContextMenuItem>
      )}
      <ContextMenuSeparator className={menuSeparatorClass} />
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          void (database === connectedPostgresDatabase
            ? handleRefreshConnection(connection.id)
            : loadPostgresRemoteDatabase(connection.id, database))
        }
      >
        <RefreshCw className="mr-2 h-3.5 w-3.5" />
        Refresh Selected
      </ContextMenuItem>
    </>
  );
}
