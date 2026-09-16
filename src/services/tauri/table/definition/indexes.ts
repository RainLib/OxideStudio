import { invokeWithInterceptors } from "../../client";
import type { DatabaseDriver, TableIndexChangeResult } from "../../types";

export async function createTableIndex(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  index: string,
  columns: string[],
  unique = false,
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
  index: string,
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
  newName: string,
): Promise<TableIndexChangeResult> {
  return invokeWithInterceptors<TableIndexChangeResult>("rename_table_index", {
    connectionId,
    driver,
    schema,
    table,
    oldName,
    newName,
  });
}

export const tableDefinitionIndexService = {
  createTableIndex,
  dropTableIndex,
  renameTableIndex,
};
