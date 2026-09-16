import { invokeWithInterceptors } from "../../client";
import type { DatabaseDriver, TableConstraintChangeResult } from "../../types";

export async function createTableUniqueConstraint(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  constraint: string,
  columns: string[],
): Promise<TableConstraintChangeResult> {
  return invokeWithInterceptors<TableConstraintChangeResult>(
    "create_table_unique_constraint",
    { connectionId, driver, schema, table, constraint, columns },
  );
}

export async function createTablePrimaryKey(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  constraint: string,
  columns: string[],
): Promise<TableConstraintChangeResult> {
  return invokeWithInterceptors<TableConstraintChangeResult>(
    "create_table_primary_key",
    { connectionId, driver, schema, table, constraint, columns },
  );
}

export async function createTableCheckConstraint(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  constraint: string,
  expression: string,
): Promise<TableConstraintChangeResult> {
  return invokeWithInterceptors<TableConstraintChangeResult>(
    "create_table_check_constraint",
    { connectionId, driver, schema, table, constraint, expression },
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
  onUpdate?: string | null,
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
    },
  );
}

export async function dropTableConstraint(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  constraint: string,
): Promise<TableConstraintChangeResult> {
  return invokeWithInterceptors<TableConstraintChangeResult>(
    "drop_table_constraint",
    { connectionId, driver, schema, table, constraint },
  );
}

export const tableDefinitionConstraintService = {
  createTableUniqueConstraint,
  createTablePrimaryKey,
  createTableCheckConstraint,
  createTableForeignKey,
  dropTableConstraint,
};
