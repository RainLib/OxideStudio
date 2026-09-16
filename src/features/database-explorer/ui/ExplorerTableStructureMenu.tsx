import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { supportsDatabaseAdministration } from "@/features/database-explorer/model/explorerSidebarPresentation";
import {
  EXPLORER_MENU_CONTENT_CLASS as menuContentClass,
  EXPLORER_MENU_ITEM_CLASS as menuItemClass,
  EXPLORER_MENU_SEPARATOR_CLASS as menuSeparatorClass,
  EXPLORER_SIDEBAR_MENU_SUB_CLASS as menuSubClass,
} from "@/features/database-explorer/ui/explorerStyles";
import { Wrench } from "lucide-react";

interface ExplorerTableStructureMenuContext {
  connectionId: string;

  runForSchema: (
    targetSchema: string,
    action: () => void | Promise<void>,
  ) => Promise<void>;
  schema: string;
  handleDdlClick: (
    table: import("@/services/tauri/types").TableInfo,
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;
  table: import("@/services/tauri/types").TableInfo;
  relationOperationTarget: import("@/hooks/useTableOperations").TableOperationTarget;

  openGeneratedSql: (
    operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE",
  ) => void;
  isReadOnlyRelation: boolean;
  togglePinTable: (tableName: string) => void;
  isPinned: boolean;
  handleEditColumnsClick: (
    table: import("@/services/tauri/types").TableInfo,
  ) => void;
  relationCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  handleTruncateClick: (
    table: import("@/services/tauri/types").TableInfo,
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;
  objectConnection:
    | import("@/store/useConnectionStore").ConnectionConfig
    | undefined;
  setDatabaseMaintenanceTarget: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-admin/ui/DatabaseMaintenanceDialog").DatabaseMaintenanceTarget
      | null
    >
  >;
  navigationDatabaseName: string | undefined;
  objectDriver: import("@/services/tauri/types").DatabaseDriver | undefined;
  isView: boolean;
  isMaterializedView: boolean;
  handleEditViewClick: (
    table: import("@/services/tauri/types").TableInfo,
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;
  handleRefreshMaterializedViewClick: (
    table: import("@/services/tauri/types").TableInfo,
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;
}

export function ExplorerTableStructureMenu({
  connectionId,

  runForSchema,
  schema,
  handleDdlClick,
  table,
  relationOperationTarget,

  openGeneratedSql,
  isReadOnlyRelation,
  togglePinTable,
  isPinned,
  handleEditColumnsClick,
  relationCapabilities,
  handleTruncateClick,
  objectConnection,
  setDatabaseMaintenanceTarget,
  navigationDatabaseName,
  objectDriver,
  isView,
  isMaterializedView,
  handleEditViewClick,
  handleRefreshMaterializedViewClick,
}: ExplorerTableStructureMenuContext) {
  return (
    <>
      <ContextMenuItem
        className={menuItemClass}
        onClick={() =>
          void runForSchema(schema, () =>
            handleDdlClick(table, relationOperationTarget),
          )
        }
      >
        Quick Documentation
        <ContextMenuShortcut>F1</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator className={menuSeparatorClass} />

      <ContextMenuSub>
        <ContextMenuSubTrigger className={menuSubClass}>
          Generate SQL
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={menuContentClass}>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              void runForSchema(schema, () => openGeneratedSql("SELECT"))
            }
          >
            SELECT
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            disabled={isReadOnlyRelation}
            onClick={() =>
              void runForSchema(schema, () => openGeneratedSql("INSERT"))
            }
          >
            INSERT
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            disabled={isReadOnlyRelation}
            onClick={() =>
              void runForSchema(schema, () => openGeneratedSql("UPDATE"))
            }
          >
            UPDATE
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            disabled={isReadOnlyRelation}
            onClick={() =>
              void runForSchema(schema, () => openGeneratedSql("DELETE"))
            }
          >
            DELETE
          </ContextMenuItem>
          <ContextMenuSeparator className={menuSeparatorClass} />
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              void runForSchema(schema, () =>
                handleDdlClick(table, relationOperationTarget),
              )
            }
          >
            DDL
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSub>
        <ContextMenuSubTrigger className={menuSubClass}>
          Tools
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={menuContentClass}>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              void runForSchema(schema, () => togglePinTable(table.name))
            }
          >
            {isPinned ? "Unpin" : "Pin"}
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              void runForSchema(schema, () => handleEditColumnsClick(table))
            }
            disabled={
              isReadOnlyRelation ||
              !relationCapabilities.supportsTableDdl ||
              !relationCapabilities.supportsColumnAlteration
            }
          >
            Edit Columns
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() =>
              void runForSchema(schema, () =>
                handleTruncateClick(table, relationOperationTarget),
              )
            }
            disabled={
              isReadOnlyRelation || !relationCapabilities.supportsTableDdl
            }
          >
            Empty Table
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() => {
              if (!objectConnection) return;
              setDatabaseMaintenanceTarget({
                connectionId,
                connectionName: objectConnection.name,
                driver: objectConnection.driver,
                database:
                  objectConnection.driver === "postgres"
                    ? navigationDatabaseName
                    : undefined,
                schema,
                table: table.name,
              });
            }}
            disabled={
              isReadOnlyRelation ||
              !objectConnection ||
              !supportsDatabaseAdministration(objectDriver) ||
              Boolean(objectConnection.driverPackageVersion)
            }
          >
            <Wrench className="mr-2 h-3.5 w-3.5" />
            Maintain Table...
          </ContextMenuItem>
          {isView && !isMaterializedView && (
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void runForSchema(schema, () =>
                  handleEditViewClick(table, relationOperationTarget),
                )
              }
            >
              Edit View
            </ContextMenuItem>
          )}
          {isMaterializedView && (
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void runForSchema(schema, () =>
                  handleRefreshMaterializedViewClick(
                    table,
                    relationOperationTarget,
                  ),
                )
              }
            >
              Refresh Materialized View
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  );
}
