import { invokeWithInterceptors } from "../client";
import type {
  ColumnInfo,
  ConstraintInfo,
  ForeignKeyReferenceInfo,
  FunctionInfo,
  IndexInfo,
} from "../types";

export async function getGeneratedColumns(
  connectionId: string,
  schema: string,
  table: string
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("get_generated_columns", {
    connectionId,
    schema,
    table,
  });
}

export async function getDatabaseColumns(
  connectionId: string,
  database: string,
  schema: string,
  table: string
): Promise<ColumnInfo[]> {
  return invokeWithInterceptors<ColumnInfo[]>("get_database_columns", {
    connectionId,
    database,
    schema,
    table,
  });
}

export async function getDatabaseGeneratedColumns(
  connectionId: string,
  database: string,
  schema: string,
  table: string
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("get_database_generated_columns", {
    connectionId,
    database,
    schema,
    table,
  });
}

export async function getIndexes(
  connectionId: string,
  schema: string,
  table: string
): Promise<IndexInfo[]> {
  return invokeWithInterceptors<IndexInfo[]>("get_indexes", {
    connectionId,
    schema,
    table,
  });
}

export async function getDatabaseIndexes(
  connectionId: string,
  database: string,
  schema: string,
  table: string
): Promise<IndexInfo[]> {
  return invokeWithInterceptors<IndexInfo[]>("get_database_indexes", {
    connectionId,
    database,
    schema,
    table,
  });
}

export async function getConstraints(
  connectionId: string,
  schema: string,
  table: string
): Promise<ConstraintInfo[]> {
  return invokeWithInterceptors<ConstraintInfo[]>("get_constraints", {
    connectionId,
    schema,
    table,
  });
}

export async function getFunctions(
  connectionId: string,
  schema: string
): Promise<FunctionInfo[]> {
  return invokeWithInterceptors<FunctionInfo[]>("get_functions", {
    connectionId,
    schema,
  });
}

export async function getDatabaseConstraints(
  connectionId: string,
  database: string,
  schema: string,
  table: string
): Promise<ConstraintInfo[]> {
  return invokeWithInterceptors<ConstraintInfo[]>(
    "get_database_constraints",
    {
      connectionId,
      database,
      schema,
      table,
    }
  );
}

export async function getReferencingForeignKeys(
  connectionId: string,
  schema: string,
  table: string
): Promise<ForeignKeyReferenceInfo[]> {
  return invokeWithInterceptors<ForeignKeyReferenceInfo[]>(
    "get_referencing_foreign_keys",
    { connectionId, schema, table }
  );
}

export async function getDatabaseReferencingForeignKeys(
  connectionId: string,
  database: string,
  schema: string,
  table: string
): Promise<ForeignKeyReferenceInfo[]> {
  return invokeWithInterceptors<ForeignKeyReferenceInfo[]>(
    "get_database_referencing_foreign_keys",
    { connectionId, database, schema, table }
  );
}

export async function getDatabaseFunctions(
  connectionId: string,
  database: string,
  schema: string
): Promise<FunctionInfo[]> {
  return invokeWithInterceptors<FunctionInfo[]>("get_database_functions", {
    connectionId,
    database,
    schema,
  });
}

/**
 * 设置当前 schema
 * @param connectionId - 连接 ID
 * @param schema - schema 名称
 * @returns Promise<string> - 设置成功消息
 */
export async function setCurrentSchema(
  connectionId: string,
  schema: string
): Promise<string> {
  return invokeWithInterceptors<string>("set_current_schema", {
    connectionId,
    schema,
  });
}
