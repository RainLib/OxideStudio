import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeWithInterceptors } from "./client";
import type {
  AlterTableColumn,
  CreateMaterializedViewResult,
  CreateTableColumn,
  CreateTableResult,
  CreateViewResult,
  DatabaseDriver,
  TableMutationResult,
  TableRowDelete,
  TableRowUpdate,
  TableExportFormat,
  TableExportEncoding,
  TableExportProgress,
  TableExportReport,
  TableExportResult,
  TableImportFormat,
  TableCsvImportOptions,
  TableCsvImportPreview,
  TableJsonImportPreview,
  TableXlsxImportPreview,
  TableImportResult,
  TableDataTransferPreview,
  TableDataTransferRequest,
  TableDataTransferBatchPlan,
  TableDataTransferBatchPlanRequest,
  TableDataTransferBatchExecuteRequest,
  TableDataTransferBatchResult,
  TableDataTransferResult,
  TableDataTransferProgress,
  TableDataTransferReport,
  TableDataTransferTargetPlan,
  TableDataTransferTargetPlanRequest,
  TableFilter,
  TableSort,
  TablePageResult,
  TableColumnChangeResult,
  TableIndexChangeResult,
  TableConstraintChangeResult,
} from "./types";

export const TABLE_DATA_TRANSFER_PROGRESS_EVENT =
  "table-data-transfer://progress";
export const TABLE_EXPORT_PROGRESS_EVENT = "table-export://progress";

export function createTableExportId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `table-export-${randomId}`
    : `table-export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface TableExportOptions {
  exportId?: string;
  projectId?: string;
  encoding?: TableExportEncoding;
}

export async function previewTablePage(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  page = 0,
  pageSize = 500,
  filterSql?: string,
  filters?: TableFilter[],
  sort?: TableSort,
  databaseName?: string
): Promise<TablePageResult> {
  return invokeWithInterceptors<TablePageResult>("preview_table_page", {
    connectionId,
    driver,
    schema,
    table,
    page,
    pageSize,
    filterSql,
    filters,
    sort,
    database: databaseName,
  });
}

export async function truncateTable(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string
): Promise<string> {
  return invokeWithInterceptors<string>("truncate_table", {
    connectionId,
    driver,
    schema,
    table,
  });
}

export async function dropTable(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  cascade = false,
  objectType?: string | null
): Promise<string> {
  return invokeWithInterceptors<string>("drop_table", {
    connectionId,
    driver,
    schema,
    table,
    cascade,
    objectType,
  });
}

export async function exportTableData(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  format: TableExportFormat = "csv",
  options: TableExportOptions = {},
  filterSql?: string,
  filters?: TableFilter[],
  sort?: TableSort,
  pageSize = 5000,
  maxRows?: number,
): Promise<TableExportResult> {
  const exportId = options.exportId || createTableExportId();
  return invokeWithInterceptors<TableExportResult>("export_table_data", {
    connectionId,
    exportId,
    projectId: options.projectId,
    encoding: options.encoding,
    driver,
    schema,
    table,
    format,
    filterSql,
    filters,
    sort,
    pageSize,
    maxRows,
  });
}

export async function importTableData(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  filePath: string,
  format: TableImportFormat,
  firstRowHeader = true,
  databaseName?: string,
  csvOptions?: TableCsvImportOptions,
  expectedFileDigest?: string,
): Promise<TableImportResult> {
  return invokeWithInterceptors<TableImportResult>("import_table_data", {
    connectionId,
    driver,
    schema,
    table,
    filePath,
    format,
    firstRowHeader,
    database: databaseName,
    csvOptions,
    expectedFileDigest,
  });
}

export async function cancelTableExport(exportId: string): Promise<string> {
  return invokeWithInterceptors<string>("cancel_table_export", { exportId });
}

export async function listenTableExportProgress(
  listener: (progress: TableExportProgress) => void,
): Promise<UnlistenFn> {
  return listen<TableExportProgress>(TABLE_EXPORT_PROGRESS_EVENT, (event) =>
    listener(event.payload),
  );
}

export async function listTableExportReports(
  projectId: string,
  connectionId: string,
  limit = 20,
): Promise<TableExportReport[]> {
  return invokeWithInterceptors<TableExportReport[]>("list_table_export_reports", {
    projectId,
    connectionId,
    limit,
  });
}

export async function previewTableCsvImport(
  filePath: string,
): Promise<TableCsvImportPreview> {
  return invokeWithInterceptors<TableCsvImportPreview>(
    "preview_table_csv_import",
    { filePath },
  );
}

export async function previewTableJsonImport(
  filePath: string,
): Promise<TableJsonImportPreview> {
  return invokeWithInterceptors<TableJsonImportPreview>(
    "preview_table_json_import",
    { filePath },
  );
}

export async function previewTableXlsxImport(
  filePath: string,
): Promise<TableXlsxImportPreview> {
  return invokeWithInterceptors<TableXlsxImportPreview>(
    "preview_table_xlsx_import",
    { filePath },
  );
}

/**
 * Plans a bounded database-to-database table copy. The returned confirmation
 * token must be explicitly typed into the transfer dialog before execution.
 */
export async function previewTableDataTransfer(
  request: TableDataTransferRequest,
): Promise<TableDataTransferPreview> {
  return invokeWithInterceptors<TableDataTransferPreview>(
    "preview_table_data_transfer",
    { request },
  );
}

/**
 * Generates a reviewed, target-dialect CREATE TABLE plan from source metadata.
 * The table is not created until the separately bound confirmation is sent.
 */
export async function previewTableDataTransferTarget(
  request: TableDataTransferTargetPlanRequest,
): Promise<TableDataTransferTargetPlan> {
  return invokeWithInterceptors<TableDataTransferTargetPlan>(
    "preview_table_data_transfer_target",
    { request },
  );
}

export async function createTableDataTransferTarget(
  request: TableDataTransferTargetPlanRequest,
  confirmationToken: string,
): Promise<CreateTableResult> {
  return invokeWithInterceptors<CreateTableResult>(
    "create_table_data_transfer_target",
    { request, confirmationToken },
  );
}

export async function executeTableDataTransfer(
  request: TableDataTransferRequest,
  confirmationToken: string,
): Promise<TableDataTransferResult> {
  return invokeWithInterceptors<TableDataTransferResult>(
    "execute_table_data_transfer",
    { request, confirmationToken },
  );
}

export async function cancelTableDataTransfer(
  transferId: string,
): Promise<string> {
  return invokeWithInterceptors<string>("cancel_table_data_transfer", {
    transferId,
  });
}

/** Builds a read-only FK dependency order for a selected group of tables. */
export async function previewTableDataTransferBatchPlan(
  request: TableDataTransferBatchPlanRequest,
): Promise<TableDataTransferBatchPlan> {
  return invokeWithInterceptors<TableDataTransferBatchPlan>(
    "preview_table_data_transfer_batch_plan",
    { request },
  );
}

/** Executes all selected tables inside one native target transaction. */
export async function executeTableDataTransferBatch(
  request: TableDataTransferBatchExecuteRequest,
  confirmationToken: string,
): Promise<TableDataTransferBatchResult> {
  return invokeWithInterceptors<TableDataTransferBatchResult>(
    "execute_table_data_transfer_batch",
    { request, confirmationToken },
  );
}

export async function listTableDataTransferReports(
  projectId: string,
  connectionId: string,
  limit = 20,
): Promise<TableDataTransferReport[]> {
  return invokeWithInterceptors<TableDataTransferReport[]>(
    "list_table_data_transfer_reports",
    { projectId, connectionId, limit },
  );
}

export async function listenTableDataTransferProgress(
  listener: (progress: TableDataTransferProgress) => void,
): Promise<UnlistenFn> {
  return listen<TableDataTransferProgress>(
    TABLE_DATA_TRANSFER_PROGRESS_EVENT,
    (event) => listener(event.payload),
  );
}

export async function renameTable(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  oldName: string,
  newName: string,
  objectType?: string | null
): Promise<string> {
  return invokeWithInterceptors<string>("rename_table", {
    connectionId,
    driver,
    schema,
    oldName,
    newName,
    objectType,
  });
}

export async function mutateTableRows(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  inserts: Array<Record<string, unknown>> = [],
  updates: TableRowUpdate[] = [],
  deletes: TableRowDelete[] = [],
  databaseName?: string
): Promise<TableMutationResult> {
  return invokeWithInterceptors<TableMutationResult>("mutate_table_rows", {
    connectionId,
    driver,
    schema,
    table,
    inserts,
    updates,
    deletes,
    database: databaseName,
  });
}

export async function createTable(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  columns: CreateTableColumn[]
): Promise<CreateTableResult> {
  return invokeWithInterceptors<CreateTableResult>("create_table", {
    connectionId,
    driver,
    schema,
    table,
    columns,
  });
}

export async function createView(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  view: string,
  selectSql: string,
  replace = false
): Promise<CreateViewResult> {
  return invokeWithInterceptors<CreateViewResult>("create_view", {
    connectionId,
    driver,
    schema,
    view,
    selectSql,
    replace,
  });
}

export async function createMaterializedView(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  view: string,
  selectSql: string,
  withData = true
): Promise<CreateMaterializedViewResult> {
  return invokeWithInterceptors<CreateMaterializedViewResult>(
    "create_materialized_view",
    {
      connectionId,
      driver,
      schema,
      view,
      selectSql,
      withData,
    }
  );
}

export async function addTableColumn(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  column: CreateTableColumn
): Promise<TableColumnChangeResult> {
  return invokeWithInterceptors<TableColumnChangeResult>("add_table_column", {
    connectionId,
    driver,
    schema,
    table,
    column,
  });
}

export async function dropTableColumn(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  column: string,
  cascade = false
): Promise<TableColumnChangeResult> {
  return invokeWithInterceptors<TableColumnChangeResult>("drop_table_column", {
    connectionId,
    driver,
    schema,
    table,
    column,
    cascade,
  });
}

export async function renameTableColumn(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  oldName: string,
  newName: string
): Promise<TableColumnChangeResult> {
  return invokeWithInterceptors<TableColumnChangeResult>(
    "rename_table_column",
    {
      connectionId,
      driver,
      schema,
      table,
      oldName,
      newName,
    }
  );
}

export async function alterTableColumn(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  changes: AlterTableColumn
): Promise<TableColumnChangeResult> {
  return invokeWithInterceptors<TableColumnChangeResult>("alter_table_column", {
    connectionId,
    driver,
    schema,
    table,
    changes,
  });
}

export async function createTableIndex(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  index: string,
  columns: string[],
  unique = false
): Promise<TableIndexChangeResult> {
  return invokeWithInterceptors<TableIndexChangeResult>("create_table_index", {
    connectionId,
    driver,
    schema,
    table,
    index,
    columns,
    unique,
  });
}

export async function dropTableIndex(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  index: string
): Promise<TableIndexChangeResult> {
  return invokeWithInterceptors<TableIndexChangeResult>("drop_table_index", {
    connectionId,
    driver,
    schema,
    table,
    index,
  });
}

export async function renameTableIndex(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  oldName: string,
  newName: string
): Promise<TableIndexChangeResult> {
  return invokeWithInterceptors<TableIndexChangeResult>(
    "rename_table_index",
    {
      connectionId,
      driver,
      schema,
      table,
      oldName,
      newName,
    }
  );
}

export async function createTableUniqueConstraint(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  constraint: string,
  columns: string[]
): Promise<TableConstraintChangeResult> {
  return invokeWithInterceptors<TableConstraintChangeResult>(
    "create_table_unique_constraint",
    {
      connectionId,
      driver,
      schema,
      table,
      constraint,
      columns,
    }
  );
}

export async function createTablePrimaryKey(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  constraint: string,
  columns: string[]
): Promise<TableConstraintChangeResult> {
  return invokeWithInterceptors<TableConstraintChangeResult>(
    "create_table_primary_key",
    {
      connectionId,
      driver,
      schema,
      table,
      constraint,
      columns,
    }
  );
}

export async function createTableCheckConstraint(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  constraint: string,
  expression: string
): Promise<TableConstraintChangeResult> {
  return invokeWithInterceptors<TableConstraintChangeResult>(
    "create_table_check_constraint",
    {
      connectionId,
      driver,
      schema,
      table,
      constraint,
      expression,
    }
  );
}

export async function createTableForeignKey(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  constraint: string,
  columns: string[],
  referencedSchema: string | null,
  referencedTable: string,
  referencedColumns: string[],
  onDelete?: string | null,
  onUpdate?: string | null
): Promise<TableConstraintChangeResult> {
  return invokeWithInterceptors<TableConstraintChangeResult>(
    "create_table_foreign_key",
    {
      connectionId,
      driver,
      schema,
      table,
      constraint,
      columns,
      referencedSchema,
      referencedTable,
      referencedColumns,
      onDelete,
      onUpdate,
    }
  );
}

export async function dropTableConstraint(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  constraint: string
): Promise<TableConstraintChangeResult> {
  return invokeWithInterceptors<TableConstraintChangeResult>(
    "drop_table_constraint",
    {
      connectionId,
      driver,
      schema,
      table,
      constraint,
    }
  );
}

export async function getTableDdl(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  objectType?: string | null,
  databaseName?: string
): Promise<string> {
  return invokeWithInterceptors<string>("get_table_ddl", {
    connectionId,
    driver,
    schema,
    table,
    objectType,
    database: databaseName,
  });
}

export async function getViewDefinition(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  view: string,
  objectType?: string | null
): Promise<string> {
  return invokeWithInterceptors<string>("get_view_definition", {
    connectionId,
    driver,
    schema,
    view,
    objectType,
  });
}

/** PostgreSQL-only, bounded source definitions. Multiple overloads may match. */
export async function getPostgresRoutineDefinitions(
  connectionId: string,
  schema: string,
  routine: string,
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("get_postgres_routine_definitions", {
    connectionId,
    schema,
    routine,
  });
}

export async function refreshMaterializedView(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  view: string,
  objectType?: string | null,
  concurrently = false
): Promise<string> {
  return invokeWithInterceptors<string>("refresh_materialized_view", {
    connectionId,
    driver,
    schema,
    view,
    objectType,
    concurrently,
  });
}

export const tableService = {
  createTableExportId,
  previewTablePage,
  previewTableDataTransfer,
  previewTableDataTransferBatchPlan,
  executeTableDataTransferBatch,
  previewTableDataTransferTarget,
  createTableDataTransferTarget,
  executeTableDataTransfer,
  cancelTableDataTransfer,
  listTableDataTransferReports,
  listenTableDataTransferProgress,
  exportTableData,
  cancelTableExport,
  listenTableExportProgress,
  listTableExportReports,
  previewTableCsvImport,
  previewTableJsonImport,
  previewTableXlsxImport,
  importTableData,
  mutateTableRows,
  createTable,
  createView,
  createMaterializedView,
  addTableColumn,
  dropTableColumn,
  renameTableColumn,
  alterTableColumn,
  createTableIndex,
  dropTableIndex,
  renameTableIndex,
  createTableUniqueConstraint,
  createTablePrimaryKey,
  createTableCheckConstraint,
  createTableForeignKey,
  dropTableConstraint,
  truncateTable,
  dropTable,
  renameTable,
  getTableDdl,
  getViewDefinition,
  getPostgresRoutineDefinitions,
  refreshMaterializedView,
};
