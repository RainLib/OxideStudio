import { invokeWithInterceptors } from "../../client";
import type {
  AlterTableColumn,
  CreateTableColumn,
  DatabaseDriver,
  TableColumnChangeResult,
} from "../../types";

export async function addTableColumn(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  column: CreateTableColumn,
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
  cascade = false,
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
  newName: string,
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
    },
  );
}

export async function alterTableColumn(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  changes: AlterTableColumn,
): Promise<TableColumnChangeResult> {
  return invokeWithInterceptors<TableColumnChangeResult>("alter_table_column", {
    connectionId,
    driver,
    schema,
    table,
    changes,
  });
}

export const tableDefinitionColumnService = {
  addTableColumn,
  dropTableColumn,
  renameTableColumn,
  alterTableColumn,
};
