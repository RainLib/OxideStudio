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
  TableExportResult,
  TableFilter,
  TableSort,
  TablePageResult,
  TableColumnChangeResult,
  TableIndexChangeResult,
  TableConstraintChangeResult,
} from "./types";

export async function previewTablePage(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  page = 0,
  pageSize = 500,
  filterSql?: string,
  filters?: TableFilter[],
  sort?: TableSort
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
  filterSql?: string,
  filters?: TableFilter[],
  sort?: TableSort,
  pageSize = 5000,
  maxRows?: number
): Promise<TableExportResult> {
  return invokeWithInterceptors<TableExportResult>("export_table_data", {
    connectionId,
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
  deletes: TableRowDelete[] = []
): Promise<TableMutationResult> {
  return invokeWithInterceptors<TableMutationResult>("mutate_table_rows", {
    connectionId,
    driver,
    schema,
    table,
    inserts,
    updates,
    deletes,
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
  objectType?: string | null
): Promise<string> {
  return invokeWithInterceptors<string>("get_table_ddl", {
    connectionId,
    driver,
    schema,
    table,
    objectType,
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
  previewTablePage,
  exportTableData,
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
  refreshMaterializedView,
};
