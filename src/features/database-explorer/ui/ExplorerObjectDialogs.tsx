import {
  objectGroupKey,
  schemaTreeKey,
} from "@/features/database-explorer/model/explorerSidebarPresentation";
import {
  CreateDatabaseDialog,
  CreateViewDialog,
  DatabaseAdministrationDialog,
  DatabaseMaintenanceDialog,
  DdlViewerDialog,
  EditColumnsDialog,
  RedisKeyDialog,
  RenameTableDialog,
  SqliteBackupDialog,
} from "@/features/database-explorer/ui/ExplorerLazyDialogs";
import { relationObjectLabel } from "@/lib/databaseDialect";
import { Suspense } from "react";

interface ExplorerObjectDialogsContext {
  databaseAdministrationConnectionId: string | null;
  setDatabaseAdministrationConnectionId: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  connections: ReturnType<
    typeof import("@/store/useConnectionStore").useConnectionStore.getState
  >["connections"];
  activeDriver: import("@/services/tauri/types").DatabaseDriver;
  databaseMaintenanceTarget:
    | import("@/features/database-admin/ui/DatabaseMaintenanceDialog").DatabaseMaintenanceTarget
    | null;
  setDatabaseMaintenanceTarget: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-admin/ui/DatabaseMaintenanceDialog").DatabaseMaintenanceTarget
      | null
    >
  >;
  sqliteBackupTarget:
    | import("@/features/database-admin/ui/SqliteBackupDialog").SqliteBackupTarget
    | null;
  setSqliteBackupTarget: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-admin/ui/SqliteBackupDialog").SqliteBackupTarget
      | null
    >
  >;
  handleRefreshConnection: (connectionId: string) => Promise<void>;
  isCreateDbDialogOpen: boolean;
  setIsCreateDbDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeConnectionId: ReturnType<
    typeof import("@/store/useConnectionStore").useConnectionStore.getState
  >["activeConnectionId"];
  setExpandedConnectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedSchemaKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
  renameDialogOpen: boolean;
  setRenameDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeTable: string;
  activeTableType: string | null;
  renameTable: (
    oldName: string,
    newName: string,
    objectType?: string | null | undefined,
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;
  ddlViewerOpen: boolean;
  setDdlViewerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  ddlContent: string;
  columnsDialogOpen: boolean;
  setColumnsDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentSchema: string | null;
  isCreateViewDialogOpen: boolean;
  setIsCreateViewDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  viewDialogMode: "create" | "edit";
  viewDialogKind: "view" | "materializedView";
  viewDialogInitialName: string;
  viewDialogInitialSql: string;
  isCreateRedisKeyOpen: boolean;
  collectionNamespace: string;
  setIsCreateRedisKeyOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleCreateRedisKey: (name: string, command: string) => Promise<void>;
}

export function ExplorerObjectDialogs({
  databaseAdministrationConnectionId,
  setDatabaseAdministrationConnectionId,
  connections,
  activeDriver,
  databaseMaintenanceTarget,
  setDatabaseMaintenanceTarget,
  sqliteBackupTarget,
  setSqliteBackupTarget,
  handleRefreshConnection,
  isCreateDbDialogOpen,
  setIsCreateDbDialogOpen,
  activeConnectionId,
  setExpandedConnectionIds,
  setExpandedSchemaKeys,
  setExpandedObjectGroupKeys,
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
  currentSchema,
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
}: ExplorerObjectDialogsContext) {
  return (
    <Suspense fallback={null}>
      {databaseAdministrationConnectionId && (
        <DatabaseAdministrationDialog
          open
          onOpenChange={(open) => {
            if (!open) setDatabaseAdministrationConnectionId(null);
          }}
          connectionId={databaseAdministrationConnectionId}
          driver={
            connections.find(
              (connection) =>
                connection.id === databaseAdministrationConnectionId,
            )?.driver || activeDriver
          }
          connectionName={
            connections.find(
              (connection) =>
                connection.id === databaseAdministrationConnectionId,
            )?.name
          }
        />
      )}
      {databaseMaintenanceTarget && (
        <DatabaseMaintenanceDialog
          key={[
            databaseMaintenanceTarget.connectionId,
            databaseMaintenanceTarget.database,
            databaseMaintenanceTarget.schema,
            databaseMaintenanceTarget.table,
          ].join(":")}
          open
          target={databaseMaintenanceTarget}
          onOpenChange={(open) => {
            if (!open) setDatabaseMaintenanceTarget(null);
          }}
        />
      )}
      {sqliteBackupTarget && (
        <SqliteBackupDialog
          key={`${sqliteBackupTarget.connectionId}:${sqliteBackupTarget.initialOperation || "backup"}`}
          open
          target={sqliteBackupTarget}
          onOpenChange={(open) => {
            if (!open) setSqliteBackupTarget(null);
          }}
          onCompleted={() =>
            handleRefreshConnection(sqliteBackupTarget.connectionId)
          }
        />
      )}
      {isCreateDbDialogOpen && (
        <CreateDatabaseDialog
          isOpen
          onClose={() => setIsCreateDbDialogOpen(false)}
          activeConnectionId={activeConnectionId || ""}
          onCreated={(schema) => {
            if (!activeConnectionId) return;
            if (activeDriver === "postgres") return;
            const schemaKey = schemaTreeKey(
              activeConnectionId,
              activeDriver,
              schema,
            );
            const objectsKey = objectGroupKey(
              activeConnectionId,
              activeDriver,
              schema,
              "objects",
            );
            setExpandedConnectionIds((current) =>
              current.includes(activeConnectionId)
                ? current
                : [...current, activeConnectionId],
            );
            setExpandedSchemaKeys((current) =>
              current.includes(schemaKey) ? current : [...current, schemaKey],
            );
            setExpandedObjectGroupKeys((current) =>
              current.includes(objectsKey) ? current : [...current, objectsKey],
            );
          }}
        />
      )}
      {renameDialogOpen && (
        <RenameTableDialog
          isOpen
          onClose={() => setRenameDialogOpen(false)}
          tableName={activeTable}
          objectLabel={relationObjectLabel(activeTableType)}
          onRename={(oldName, newName) =>
            renameTable(oldName, newName, activeTableType)
          }
        />
      )}
      {ddlViewerOpen && (
        <DdlViewerDialog
          isOpen
          onClose={() => setDdlViewerOpen(false)}
          tableName={activeTable}
          ddl={ddlContent}
        />
      )}
      {columnsDialogOpen && (
        <EditColumnsDialog
          isOpen
          onClose={() => setColumnsDialogOpen(false)}
          connectionId={activeConnectionId || ""}
          driver={activeDriver}
          schema={currentSchema || ""}
          tableName={activeTable}
        />
      )}
      {isCreateViewDialogOpen && (
        <CreateViewDialog
          isOpen
          onClose={() => setIsCreateViewDialogOpen(false)}
          connectionId={activeConnectionId || ""}
          driver={activeDriver}
          schema={currentSchema || ""}
          mode={viewDialogMode}
          viewKind={viewDialogKind}
          initialViewName={viewDialogInitialName}
          initialSelectSql={viewDialogInitialSql}
        />
      )}
      {isCreateRedisKeyOpen && (
        <RedisKeyDialog
          open
          database={collectionNamespace || "0"}
          onOpenChange={setIsCreateRedisKeyOpen}
          onCreate={(draft, command) =>
            handleCreateRedisKey(draft.name, command)
          }
        />
      )}
    </Suspense>
  );
}
