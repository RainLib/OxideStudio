import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { connectionCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";
import { supportsDatabaseCatalogTree } from "@/features/database-explorer/model/explorerSidebarPresentation";
import {
  EXPLORER_MENU_CONTENT_CLASS as menuContentClass,
  EXPLORER_MENU_ITEM_CLASS as menuItemClass,
  EXPLORER_MENU_SEPARATOR_CLASS as menuSeparatorClass,
  EXPLORER_SIDEBAR_MENU_SUB_CLASS as menuSubClass,
} from "@/features/database-explorer/ui/explorerStyles";
import { cn } from "@/lib/utils";
import type { useConnectionStore } from "@/store/useConnectionStore";
import {
  ArrowRightLeft,
  Download,
  GitCompareArrows,
  Upload,
  X,
} from "lucide-react";

type ConnectionState = ReturnType<typeof useConnectionStore.getState>;

interface ExplorerTableTransferMenuContext {
  canImportRelationRows: boolean;
  runForSchema: (
    targetSchema: string,
    action: () => void | Promise<void>,
  ) => Promise<void>;
  schema: string;
  handleTableCsvImport: (
    table: import("@/services/tauri/types").TableInfo,
    schemaName: string,
    targetConnectionId?: string,
    databaseName?: string | undefined,
  ) => Promise<void>;
  table: import("@/services/tauri/types").TableInfo;
  connectionId: string;
  navigationDatabaseName: string | undefined;
  importTableData: (
    tableName: string,
    format: import("@/services/tauri/types").TableImportFormat,
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;
  relationOperationTarget: import("@/hooks/useTableOperations").TableOperationTarget;
  handleTableJsonImport: (
    table: import("@/services/tauri/types").TableInfo,
    schemaName: string,
    targetConnectionId?: string,
    databaseName?: string | undefined,
  ) => Promise<void>;
  handleTableXlsxImport: (
    table: import("@/services/tauri/types").TableInfo,
    schemaName: string,
    targetConnectionId?: string,
    databaseName?: string | undefined,
  ) => Promise<void>;
  relationCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  handleImportSqlScript: ({
    connectionId,
    schema,
    database,
  }: {
    connectionId: string;
    schema?: string | undefined;
    database?: string | undefined;
  }) => void;
  driver: string | null | undefined;
  connections: ConnectionState["connections"];

  supportsRelationExport: (
    format:
      | "sql"
      | "csv"
      | "json"
      | "jsonl"
      | "markdown"
      | "tsv"
      | "xlsx"
      | "parquet"
      | "arrow",
  ) => boolean;
  exportTableData: (
    tableName: string,
    format?: import("@/services/tauri/types").DatabaseTableExportFormat,
    encoding?: import("@/services/tauri/types").TableExportEncoding,
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;
  activeTableExport: {
    exportId: string;
    taskId: string;
    tableName: string;
  } | null;
  cancelActiveTableExport: () => Promise<void>;
  isView: boolean;
  objectConnection:
    | import("@/store/useConnectionStore").ConnectionConfig
    | undefined;
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
}

export function ExplorerTableTransferMenu({
  canImportRelationRows,
  runForSchema,
  schema,
  handleTableCsvImport,
  table,
  connectionId,
  navigationDatabaseName,
  importTableData,
  relationOperationTarget,
  handleTableJsonImport,
  handleTableXlsxImport,
  relationCapabilities,
  handleImportSqlScript,
  driver,
  connections,

  supportsRelationExport,
  exportTableData,
  activeTableExport,
  cancelActiveTableExport,
  isView,
  objectConnection,
  handleOpenDataTransfer,
  handleOpenDataCompare,
}: ExplorerTableTransferMenuContext) {
  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger className={menuSubClass}>
          Import/Export
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={menuContentClass}>
          <ContextMenuItem
            className={menuItemClass}
            disabled={!canImportRelationRows}
            onClick={() =>
              void runForSchema(schema, () =>
                handleTableCsvImport(
                  table,
                  schema,
                  connectionId,
                  navigationDatabaseName,
                ),
              )
            }
          >
            <Upload className="mr-2 h-3.5 w-3.5" />
            Import CSV / TSV...
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            disabled={!canImportRelationRows}
            title="Stream auto-detected UTF-8, UTF-16, or GB18030 delimited text. TSV defaults to a tab delimiter; CSV and TXT default to a comma. Use the reviewed import when you need row ranges or column mapping."
            onClick={() =>
              void runForSchema(schema, () =>
                importTableData(table.name, "csv", relationOperationTarget),
              )
            }
          >
            <Upload className="mr-2 h-3.5 w-3.5" />
            Import delimited text (streaming)...
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            disabled={!canImportRelationRows}
            onClick={() =>
              void runForSchema(schema, () =>
                handleTableJsonImport(
                  table,
                  schema,
                  connectionId,
                  navigationDatabaseName,
                ),
              )
            }
          >
            <Upload className="mr-2 h-3.5 w-3.5" />
            Import JSON...
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            disabled={!canImportRelationRows}
            onClick={() =>
              void runForSchema(schema, () =>
                handleTableXlsxImport(
                  table,
                  schema,
                  connectionId,
                  navigationDatabaseName,
                ),
              )
            }
          >
            <Upload className="mr-2 h-3.5 w-3.5" />
            Import XLSX...
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            disabled={!relationCapabilities.supportsSqlQuery}
            onClick={() =>
              void handleImportSqlScript({
                connectionId,
                schema,
                database: supportsDatabaseCatalogTree(driver)
                  ? connectionCatalogDatabaseName(
                      connections.find((item) => item.id === connectionId) ||
                        {},
                    )
                  : undefined,
              })
            }
          >
            <Upload className="mr-2 h-3.5 w-3.5" />
            Import SQL Script...
          </ContextMenuItem>
          <ContextMenuSeparator className={menuSeparatorClass} />
          {supportsRelationExport("csv") && (
            <>
              <ContextMenuItem
                className={menuItemClass}
                onClick={() =>
                  void runForSchema(schema, () =>
                    exportTableData(
                      table.name,
                      "csv",
                      "utf8",
                      relationOperationTarget,
                    ),
                  )
                }
              >
                <Download className="mr-2 h-3.5 w-3.5" />
                Export CSV
              </ContextMenuItem>
              <ContextMenuItem
                className={menuItemClass}
                onClick={() =>
                  void runForSchema(schema, () =>
                    exportTableData(
                      table.name,
                      "csv",
                      "utf8Bom",
                      relationOperationTarget,
                    ),
                  )
                }
              >
                <Download className="mr-2 h-3.5 w-3.5" />
                Export CSV (UTF-8 BOM)
              </ContextMenuItem>
            </>
          )}
          {supportsRelationExport("json") && (
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void runForSchema(schema, () =>
                  exportTableData(
                    table.name,
                    "json",
                    "utf8",
                    relationOperationTarget,
                  ),
                )
              }
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Export JSON
            </ContextMenuItem>
          )}
          {supportsRelationExport("jsonl") && (
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void runForSchema(schema, () =>
                  exportTableData(
                    table.name,
                    "jsonl",
                    "utf8",
                    relationOperationTarget,
                  ),
                )
              }
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Export JSON Lines
            </ContextMenuItem>
          )}
          {supportsRelationExport("sql") && (
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void runForSchema(schema, () =>
                  exportTableData(
                    table.name,
                    "sql",
                    "utf8",
                    relationOperationTarget,
                  ),
                )
              }
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Export SQL Inserts
            </ContextMenuItem>
          )}
          {supportsRelationExport("tsv") && (
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void runForSchema(schema, () =>
                  exportTableData(
                    table.name,
                    "tsv",
                    "utf8",
                    relationOperationTarget,
                  ),
                )
              }
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Export TSV
            </ContextMenuItem>
          )}
          {supportsRelationExport("xlsx") && (
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void runForSchema(schema, () =>
                  exportTableData(
                    table.name,
                    "xlsx",
                    "binary",
                    relationOperationTarget,
                  ),
                )
              }
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Export Excel workbook (.xlsx)
            </ContextMenuItem>
          )}
          {supportsRelationExport("parquet") && (
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void runForSchema(schema, () =>
                  exportTableData(
                    table.name,
                    "parquet",
                    "binary",
                    relationOperationTarget,
                  ),
                )
              }
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Export Apache Parquet (.parquet)
            </ContextMenuItem>
          )}
          {supportsRelationExport("arrow") && (
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void runForSchema(schema, () =>
                  exportTableData(
                    table.name,
                    "arrow",
                    "binary",
                    relationOperationTarget,
                  ),
                )
              }
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Export Arrow IPC (.arrow)
            </ContextMenuItem>
          )}
          {supportsRelationExport("markdown") && (
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void runForSchema(schema, () =>
                  exportTableData(
                    table.name,
                    "markdown",
                    "utf8",
                    relationOperationTarget,
                  ),
                )
              }
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Export Markdown table (.md)
            </ContextMenuItem>
          )}
          {activeTableExport?.tableName === table.name && (
            <ContextMenuItem
              className={cn(menuItemClass, "text-destructive")}
              onClick={() => void cancelActiveTableExport()}
            >
              <X className="mr-2 h-3.5 w-3.5" />
              Cancel active export
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem
        className={menuItemClass}
        disabled={
          isView ||
          !objectConnection ||
          !relationCapabilities.supportsTableDataTransfer
        }
        onClick={() => {
          if (!objectConnection) return;
          void handleOpenDataTransfer({
            connection: objectConnection,
            database: navigationDatabaseName,
            schema,
            table: table.name,
            scope: "table",
          });
        }}
      >
        <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
        Transfer Table Data...
      </ContextMenuItem>
      <ContextMenuItem
        className={menuItemClass}
        disabled={isView || !objectConnection}
        onClick={() => {
          if (!objectConnection) return;
          void handleOpenDataCompare({
            connection: objectConnection,
            database: navigationDatabaseName,
            schema,
            table: table.name,
          });
        }}
      >
        <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
        Compare Table Data...
      </ContextMenuItem>
    </>
  );
}
