import { invokeWithInterceptors } from "../../client";
import type {
  CreateTableColumn,
  CreateTableResult,
  DatabaseDriver,
  TableMutationResult,
  TableRowDelete,
  TableRowUpdate,
} from "../../types";

export async function renameTable(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  oldName: string,
  newName: string,
  objectType?: string | null,
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
  databaseName?: string,
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
  columns: CreateTableColumn[],
): Promise<CreateTableResult> {
  return invokeWithInterceptors<CreateTableResult>("create_table", {
    connectionId,
    driver,
    schema,
    table,
    columns,
  });
}

export async function previewCreateTable(
  driver: DatabaseDriver,
  schema: string,
  table: string,
  columns: CreateTableColumn[],
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("preview_create_table", {
    driver,
    schema,
    table,
    columns,
  });
}

export const tableDefinitionTableService = {
  renameTable,
  mutateTableRows,
  createTable,
  previewCreateTable,
};
