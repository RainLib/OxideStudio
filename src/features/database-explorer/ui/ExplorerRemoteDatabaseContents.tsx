import type { useTabStore } from "@/store/useTabStore";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { PostgresRemoteDatabaseContents } from "@/components/workspace/PostgresRemoteDatabaseContents";
import { EXPLORER_MENU_ITEM_CLASS as menuItemClass } from "@/features/database-explorer/ui/explorerStyles";
import { Code2 } from "lucide-react";

type TabState = ReturnType<typeof useTabStore.getState>;

interface ExplorerRemoteDatabaseContentsContext {
  database: string;
  explorerStateScope: string;
  connection: import("@/store/useConnectionStore").ConnectionConfig;
  postgresRemoteDatabases: import("@/features/database-explorer/model/explorerSidebarTypes").PostgresRemoteDatabaseState;
  postgresRemoteRefreshRequest: {
    connectionId: string;
    database: string;
    version: number;
    schema?: string | undefined;
  } | null;
  explorerFilterMatches: (...values: unknown[]) => boolean;
  descendantFilterText: string;
  handlePostgresRemoteTablesLoaded: (
    connectionId: string,
    database: string,
    schema: string,
    databaseTables: import("@/services/tauri/types").TableInfo[],
  ) => void;
  setSchemaSnapshotIdentity: React.Dispatch<
    React.SetStateAction<
      import("@/services/schemaSnapshotStore").SchemaSnapshotIdentity | null
    >
  >;
  activeProjectId: string;
  openObjectBrowser: TabState["openObjectBrowser"];

  createTab: TabState["createTab"];
  renderSqlHistorySubmenu: (scope: {
    connectionId: string;
    databaseName?: string | null | undefined;
    schemaName?: string | null | undefined;
  }) => React.ReactNode;
  handleOpenDataTransfer: (options: {
    connection: import("@/store/useConnectionStore").ConnectionConfig;
    database?: string | undefined;
    schema?: string | undefined;
    table?: string | undefined;
    tables?: string[] | undefined;
    scope: "database" | "schema" | "table";
  }) => Promise<void>;
  explorerActivationMode: import("@/lib/appSettings").ExplorerActivationMode;
  activeCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  handleOpenDataCompare: (options: {
    connection: import("@/store/useConnectionStore").ConnectionConfig;
    database?: string | undefined;
    schema?: string | undefined;
    table?: string | undefined;
    tables?: string[] | undefined;
  }) => Promise<void>;
  setDatabaseMaintenanceTarget: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-admin/ui/DatabaseMaintenanceDialog").DatabaseMaintenanceTarget
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
  handlePostgresRemoteTableOpen: (
    connectionId: string,
    databaseName: string,
    schemaName: string,
    table: import("@/services/tauri/types").TableInfo,
  ) => Promise<void>;
}

export function ExplorerRemoteDatabaseContents({
  database,
  explorerStateScope,
  connection,
  postgresRemoteDatabases,
  postgresRemoteRefreshRequest,
  explorerFilterMatches,
  descendantFilterText,
  handlePostgresRemoteTablesLoaded,
  setSchemaSnapshotIdentity,
  activeProjectId,
  openObjectBrowser,

  createTab,
  renderSqlHistorySubmenu,
  handleOpenDataTransfer,
  explorerActivationMode,
  activeCapabilities,
  handleOpenDataCompare,
  setDatabaseMaintenanceTarget,
  handleImportSqlScript,
  handlePostgresRemoteTableOpen,
}: ExplorerRemoteDatabaseContentsContext) {
  return (
    <PostgresRemoteDatabaseContents
      explorerScopeId={explorerStateScope}
      connectionId={connection.id}
      driver={connection.driver}
      database={database}
      schemas={
        postgresRemoteDatabases.connectionId === connection.id
          ? postgresRemoteDatabases.schemas[database] || []
          : []
      }
      refreshRequest={
        postgresRemoteRefreshRequest?.connectionId === connection.id &&
        postgresRemoteRefreshRequest.database === database
          ? postgresRemoteRefreshRequest
          : undefined
      }
      filterText={explorerFilterMatches(database) ? "" : descendantFilterText}
      matchesFilter={explorerFilterMatches}
      onTablesLoaded={(schema, databaseTables) =>
        handlePostgresRemoteTablesLoaded(
          connection.id,
          database,
          schema,
          databaseTables,
        )
      }
      onOpenSchemaSnapshots={(databaseName, schema) => {
        setSchemaSnapshotIdentity({
          projectId: activeProjectId,
          connectionId: connection.id,
          connectionName: connection.name,
          driver: connection.driver,
          databaseName,
          schemaName: schema,
        });
      }}
      onOpenSchemaObjects={(databaseName, schema) =>
        openObjectBrowser(connection.id, connection.name, databaseName, schema)
      }
      renderQueryContextMenu={(databaseName, schema) => (
        <>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              createTab("query", `console [${schema}]`, "", {
                connectionId: connection.id,
                databaseName,
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
            databaseName,
            schemaName: schema,
          })}
        </>
      )}
      onOpenSchemaDataTransfer={(databaseName, schema) =>
        void handleOpenDataTransfer({
          connection,
          database: databaseName,
          schema,
          scope: "schema",
        })
      }
      activationMode={explorerActivationMode}
      includeIndexes={activeCapabilities.supportsTableIndexes}
      includeConstraints={activeCapabilities.supportsTableConstraints}
      onOpenSchemaDataCompare={(databaseName, schema) =>
        void handleOpenDataCompare({
          connection,
          database: databaseName,
          schema,
        })
      }
      onOpenTableSchemaSnapshots={(databaseName, schema, table) => {
        setSchemaSnapshotIdentity({
          projectId: activeProjectId,
          connectionId: connection.id,
          connectionName: connection.name,
          driver: connection.driver,
          databaseName,
          schemaName: schema,
          tableName: table,
        });
      }}
      onOpenTableDataTransfer={(databaseName, schema, table) =>
        void handleOpenDataTransfer({
          connection,
          database: databaseName,
          schema,
          table,
          scope: "table",
        })
      }
      onOpenTableDataCompare={(databaseName, schema, table) =>
        void handleOpenDataCompare({
          connection,
          database: databaseName,
          schema,
          table,
        })
      }
      onOpenTableMaintenance={
        connection.driverPackageVersion
          ? undefined
          : (databaseName, schema, table) =>
              setDatabaseMaintenanceTarget({
                connectionId: connection.id,
                connectionName: connection.name,
                driver: connection.driver,
                database: databaseName,
                schema,
                table,
              })
      }
      onImportSqlScript={(databaseName, schema) =>
        void handleImportSqlScript({
          connectionId: connection.id,
          database: databaseName,
          schema,
        })
      }
      onOpenTable={(databaseName, schema, table) =>
        handlePostgresRemoteTableOpen(
          connection.id,
          databaseName,
          schema,
          table,
        )
      }
    />
  );
}
